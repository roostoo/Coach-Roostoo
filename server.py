"""
Coach Roostoo — FastAPI server (Groq / OpenAI-compatible build).

  - POST /api/coach   : called by the Go backend — validates X-Internal-Token,
                        builds prompt from history, calls LLM, screens output,
                        returns JSON { Reply, ModelID }
  - GET  /api/health  : { ok, model, keySet }
  - serves the UI from ./public (index.html) so it's one link

PROVIDER CONFIG (generic env names, currently set up for Groq):
  API_KEY              - your provider's API key
  API_URL              - the provider's chat-completions endpoint
  MODEL                - the model name to call
  COACH_SERVICE_SECRET - shared secret validated via X-Internal-Token header

NOTE: this build targets GROQ, which is OpenAI-compatible — it uses a
"messages" array in the request and choices[0].message.content in the response,
with a Bearer auth header. This is the SAME shape as DeepSeek/OpenAI, and is
DIFFERENT from Gemini's native format.

Run locally:
  pip install fastapi uvicorn httpx python-dotenv
  uvicorn server:app --host 0.0.0.0 --port 8788
"""

import asyncio
import os
import re

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (PlainTextResponse, JSONResponse, FileResponse,
                               RedirectResponse)
from fastapi.staticfiles import StaticFiles

load_dotenv()

PORT           = int(os.environ.get("PORT", "8788"))
KEY            = os.environ.get("API_KEY")
INTERNAL_TOKEN = os.environ.get("COACH_SERVICE_SECRET", "")
# Groq's OpenAI-compatible chat-completions endpoint.
API_URL        = os.environ.get("API_URL", "https://api.groq.com/openai/v1/chat/completions")
# TEMP (2026-08-10): default to the 8B model — it has a much larger free-tier
# daily budget (RPD 14.4K / TPD 500K vs 70B's 1K / 100K), so testing isn't
# blocked by the daily cap. Revert to "llama-3.3-70b-versatile" for best quality
# once on a paid Groq tier. (A MODEL env var, if set in Vercel, still overrides.)
MODEL          = os.environ.get("MODEL", "llama-3.1-8b-instant")

if not KEY:
    print("\n[Coach Roostoo] No API key set yet.")
    print("Set API_KEY in your environment and restart.\n")

# System prompt — Python owns this; the Go backend does not send one.
# The platform-registry section is imported from the compiler package so this
# chat surface and the intent compiler describe the SAME product (same signal
# families, strategy variants, indicators, and knobs) — one source of truth.
from coach_compiler.prompt import registry_brief as _registry_brief  # noqa: E402
from coach_compiler.prompt import PLATFORM_RULES as _PLATFORM_RULES  # noqa: E402
from coach_compiler.prompt import platform_facts_for as _platform_facts_for  # noqa: E402
from coach_compiler.prompt import FORMATTING as _FORMATTING  # noqa: E402
# The behavioral policy the chat was previously missing — it lived only in the
# compiler's create/explain prompts, so the browser chat leaked internal codes,
# skipped the honest-backtest framing, and had no envelope/refusal discipline.
# Import the same sections here so the chat and the compiler behave identically.
from coach_compiler.prompt import ENVELOPE as _ENVELOPE  # noqa: E402
from coach_compiler.prompt import BACKTESTING as _BACKTESTING  # noqa: E402
from coach_compiler.prompt import CONTEXT_POLICY as _CONTEXT_POLICY  # noqa: E402
from coach_compiler.prompt import NUMBERS as _NUMBERS  # noqa: E402
from coach_compiler.prompt import TONE as _TONE  # noqa: E402

# Header + closing (tool discipline) wrap the per-request body. The heavy
# platform-fact tables are NOT baked in here — they're attached per request by
# build_system_prompt() based on what the user actually asked, so a greeting or
# a build request doesn't carry ~2.9k tokens of competition/fee/XP tables it
# will never use (that was tripping the provider's free-tier per-minute cap).
_SYS_HEADER = (
    "You are Coach Roostoo, an expert trading educator inside the Roostoo "
    "platform. You help users understand trading concepts, the agents, "
    "signal families and strategy variants, risk, and how to use the Roostoo "
    "platform — but you never give real-money financial advice or directives. "
    "Keep answers clear, concise, and educational, always grounded in the "
    "Roostoo context. When a user asks how to create an agent, walk them "
    "through the Mint Agent wizard (My Agents -> Mint Agent) using the exact "
    "facts below — never invent parameters the wizard doesn't have."
)
# Tool discipline — used ONLY on the Go tool-calling path, where action tools
# (create_trading_agent, join_competition) are actually attached to the request.
_SYS_TOOLS = (
    "You have access to tools that let you act on the platform on the user's behalf. "
    "IMPORTANT: before calling any action tool (create_trading_agent, join_competition), "
    "you MUST first describe exactly what you are about to do and ask the user to confirm. "
    "Only call a tool after the user explicitly agrees (e.g. 'yes', 'go ahead', 'do it'). "
    "For read-only tools (get_my_portfolio) you may call them immediately without asking."
)
# The browser chat has NO tools wired. Say so plainly so the model never claims
# it is creating an agent or acting on the user's behalf — it advises, and sends
# the user to the Mint Agent wizard to actually build.
_SYS_NO_ACTIONS = (
    "You are a conversational coach only. You CANNOT place trades, create or launch "
    "agents, join competitions, or change anything on the user's account from this "
    "chat, and you have no tools here. Never say you are creating an agent, doing it "
    "'on their behalf', or ask them to confirm an action you cannot perform. When a "
    "user wants to build an agent, help them decide by explaining the choices, then "
    "tell them to open the Mint Agent wizard (My Agents -> Mint Agent) to build it there."
)


def _rag_facts(message):
    """Fetch platform facts via RAG (rag.retrieve). Returns "" if RAG is
    unavailable — deps not installed or index not built (e.g. on the current
    Vercel serverless deploy) — so build_system_prompt() falls back to the
    hard-coded _platform_facts_for() and nothing breaks."""
    if not message:
        return ""
    try:
        import rag
        chunks = rag.retrieve(message, k=3)
        return ("=== ROOSTOO FACTS ===\n" + chunks) if chunks else ""
    except Exception:
        return ""


async def _facts_for(message):
    """Resolve the platform-fact block off the event loop.

    `_rag_facts` embeds the question and queries Chroma — a synchronous,
    CPU-bound step. Called directly inside the async request handler it would
    block the single event loop for its whole duration, so under load requests
    (and the health check) queue behind each other and the load balancer starts
    returning 502s. Running it in a worker thread keeps the loop free to accept
    other requests while the embedding runs. Falls back to the hard-coded tables
    when RAG returns nothing, exactly as before."""
    rag_facts = await asyncio.to_thread(_rag_facts, message)
    return rag_facts or _platform_facts_for(message)


def build_system_prompt(message="", with_tools=False, facts=None):
    """Assemble the /api/coach system prompt for one turn. The agent registry and
    the short PLATFORM_RULES are always present; the bulky platform-fact sections
    are attached only when `message` is about them. The behavioral policy
    (envelope, honest-backtest, numbers, tone/refusals) mirrors the compiler so
    both surfaces behave the same. `with_tools` selects the tool discipline (Go
    tool-calling path) vs the no-actions clause (browser chat, no tools).

    `facts` may be precomputed by the async caller via `_facts_for` (which runs
    RAG off the event loop); when omitted they are resolved inline — used at
    import time and by any synchronous caller."""
    parts = [_SYS_HEADER, _registry_brief(), _ENVELOPE, _PLATFORM_RULES]
    # RAG first (facts retrieved from the cards); if RAG is unavailable, fall
    # back to the hard-coded platform-fact tables so behaviour never regresses.
    if facts is None:
        facts = _rag_facts(message) or _platform_facts_for(message)
    if facts:
        parts.append(facts)
    parts += [_BACKTESTING, _CONTEXT_POLICY, _NUMBERS, _FORMATTING, _TONE]
    parts.append(_SYS_TOOLS if with_tools else _SYS_NO_ACTIONS)
    return "\n\n".join(parts)


# Back-compat: a lean default build (no message -> no fact tables).
SYSTEM_PROMPT = build_system_prompt("")

app = FastAPI()

# Allow browser clients on any origin (e.g. the published Roostoo design, or a
# static export hosted elsewhere) to call this stateless proxy. No cookies or
# credentials are used, so "*" is safe; the Groq key stays server-side. Handles
# the CORS preflight (OPTIONS) automatically for the JSON POST from the UI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _warm_rag() -> None:
    """Preload the embedding model + Chroma index into THIS worker before it
    serves traffic. Uvicorn runs startup handlers before it accepts requests, so
    a freshly started (or autoscaled) task only becomes healthy once RAG is warm
    — avoiding the ~20-30s cold-start latency the first real requests would
    otherwise pay while each worker loads the model. Best-effort: any failure is
    swallowed (RAG then falls back to the hard-coded facts, exactly as before)."""
    try:
        await asyncio.to_thread(_rag_facts, "warmup")
    except Exception:
        pass

# ============================================================================
# LAYER 3 — OUTPUT GUARDRAIL (provider-agnostic — screens text)
# ============================================================================

REAL_ASSET = re.compile(
    r"\b(bitcoin|btc|ethereum|eth|crypto|stock|stocks|shares?|tesla|tsla|apple|aapl|s&p|sp500|nasdaq|forex|gold|real money|your portfolio|your money|your account)\b",
    re.IGNORECASE,
)

DIRECTIVE = re.compile(
    r"\b(you should (buy|sell|short|long|hold|invest|put|allocate)|i (recommend|suggest|advise) (you )?(buy|sell|short|investing|allocating)|buy now|sell now|go (all in|long|short)|the best (coin|stock|asset|investment) (is|to)|put your money|invest in)\b",
    re.IGNORECASE,
)

SIM_SCOPED = re.compile(
    r"(sandbox|simulator|sim|training|agent|episode|backtest|in roostoo|the feed)",
    re.IGNORECASE,
)


def crosses_line(text: str) -> bool:
    if not text:
        return False
    sentences = re.split(r"(?<=[.!?\n])\s+", text)
    for s in sentences:
        if not DIRECTIVE.search(s):
            continue
        if SIM_SCOPED.search(s):
            continue  # directive scoped to the sim -> allowed
        if REAL_ASSET.search(s):
            return True  # real-world directive about a real asset/money
    return False


SAFE_REDIRECT = (
    "I can't tell you what to do with real money or real assets — Coach Roostoo "
    "is here to help you learn inside the Roostoo simulator, where nothing is real. "
    "What I can do is explain the concept behind your question and how an agent "
    "configured like yours might handle it in the sandbox, so you can test the idea "
    "safely. Want me to break down the mechanics or the risks instead?"
)


@app.post("/api/coach")
async def coach(request: Request):
    # ── Auth: validate shared secret from Go backend ──────────────────────────
    if INTERNAL_TOKEN:
        token = request.headers.get("X-Internal-Token", "")
        if token != INTERNAL_TOKEN:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)

    body = await request.json()

    # Two supported contracts:
    #   * This app's UI (public/assets/app.js): {"system": "...", "message": "..."}
    #     -> respond with PLAIN TEXT (app.js reads res.text()).
    #   * Go backend: {"Messages": [{"Role","Content","ToolCallId"?,"ToolName"?}],
    #                  "UserContext": {...}, "Tools": [...]}
    #     -> respond with JSON {"Reply", "ModelID"} or {"ToolCall": {...}, "ModelID"}.
    frontend_message = body.get("message")
    go_messages      = body.get("Messages", [])
    go_tools         = body.get("Tools", [])   # tool definitions from Go

    if frontend_message:
        # UI / design chat path. Always apply the server-side coach persona +
        # guardrail behaviour (so the browser can't opt out of them). An optional
        # client `system` (e.g. runtime config context) is layered on top, and an
        # optional `history` array carries prior turns for multi-turn memory.
        mode = "text"
        # Attach only the platform facts this message is about (keeps the
        # common case well under the provider's per-minute token cap). RAG runs
        # in a worker thread so the embedding never blocks the event loop.
        facts = await _facts_for(frontend_message)
        messages = [{"role": "system", "content": build_system_prompt(frontend_message, facts=facts)}]
        if body.get("system"):
            messages.append({"role": "system", "content": body["system"]})
        for m in (body.get("history") or [])[-12:]:
            role = (m.get("role") or "").lower()
            content = m.get("content") or ""
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": frontend_message})
    elif go_messages:
        mode = "json"
        # Build the OpenAI message list, handling all role types:
        #   user / assistant (text) — standard
        #   assistant (tool_call)   — ToolCallId + ToolName set, no content
        #   tool                    — ToolCallId + ToolName set, content = result
        _last_user = next((m.get("Content") or "" for m in reversed(go_messages)
                           if (m.get("Role") or "").lower() == "user"), "")
        facts = await _facts_for(_last_user)
        messages = [{"role": "system", "content": build_system_prompt(_last_user, with_tools=True, facts=facts)}]
        for m in go_messages:
            role = (m.get("Role") or "").lower()
            if not role:
                continue

            if role == "tool":
                # Tool result message — must include tool_call_id for OpenAI
                messages.append({
                    "role":         "tool",
                    "tool_call_id": m.get("ToolCallId", "call_unknown"),
                    "content":      m.get("Content") or "",
                })
            elif role == "assistant" and m.get("ToolCallId"):
                # Assistant message that requested a tool call (no text content)
                messages.append({
                    "role":    "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id":   m["ToolCallId"],
                        "type": "function",
                        "function": {
                            "name":      m.get("ToolName", ""),
                            "arguments": "{}",
                        },
                    }],
                })
            else:
                content = m.get("Content") or ""
                if content:
                    messages.append({"role": role, "content": content})
    else:
        return JSONResponse({"error": "Missing message"}, status_code=400)

    if not KEY:
        return JSONResponse({"error": "Server has no API key configured."}, status_code=500)

    # Convert Go tool definitions → OpenAI function-calling format
    oai_tools = [
        {
            "type": "function",
            "function": {
                "name":        t["Name"],
                "description": t["Description"],
                "parameters":  t["Parameters"],
            },
        }
        for t in go_tools
        if t.get("Name")
    ]

    payload = {
        "model":       MODEL,
        "messages":    messages,
        "temperature": 0.4,
        "max_tokens":  2000,
        "stream":      False,  # buffer full response for guardrail + tool detection
    }
    if oai_tools and mode == "json":
        payload["tools"] = oai_tools

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream = await client.post(
                API_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {KEY}",
                },
                json=payload,
            )

        if upstream.status_code != 200:
            print("[coach] LLM provider error:", upstream.status_code,
                  upstream.text[:400])  # detail stays in server logs
            rate = upstream.status_code == 429 or "rate limit" in upstream.text.lower()
            msg = ("The coach is briefly rate-limited — try again in a few seconds."
                   if rate else "The coach couldn't reach the model provider right now.")
            if mode == "text":
                return PlainTextResponse(msg, status_code=502)
            return JSONResponse({"error": msg}, status_code=502)

        data   = upstream.json()
        choice = data["choices"][0]
        finish = choice.get("finish_reason", "")

        # ── Tool call path: LLM wants Go to execute a tool ────────────────────
        if finish == "tool_calls" and mode == "json":
            tc_list = choice["message"].get("tool_calls", [])
            if tc_list:
                tc   = tc_list[0]  # handle one tool call per turn
                import json as _json
                try:
                    args = _json.loads(tc["function"].get("arguments") or "{}")
                except Exception:
                    args = {}
                print(f"[coach][tool] LLM requested tool: {tc['function']['name']} args={args}")
                return JSONResponse({
                    "ToolCall": {
                        "ToolCallId": tc["id"],
                        "Name":       tc["function"]["name"],
                        "Params":     args,
                    },
                    "ModelID": MODEL,
                })

        # ── Normal text response path ──────────────────────────────────────────
        try:
            full = choice["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            full = ""

        # ---- LAYER 3: screen the complete answer ----
        release = full.strip()
        if crosses_line(release):
            print("[coach][guardrail] directive-on-real-asset detected — replacing response.")
            release = SAFE_REDIRECT

        if mode == "text":
            return PlainTextResponse(release or "(no response)")
        return JSONResponse({"Reply": release or "(no response)", "ModelID": MODEL})

    except Exception as err:  # noqa: BLE001
        print("[coach] error:", str(err))  # detail stays in server logs
        if mode == "text":
            return PlainTextResponse("The coach hit a server error — please try again.",
                                     status_code=500)
        return JSONResponse({"error": "internal server error"}, status_code=500)


@app.get("/api/health")
async def health():
    return {"ok": True, "model": MODEL, "keySet": bool(KEY)}


# ============================================================================
# VOICE INPUT — POST /api/transcribe (Groq Whisper, OpenAI-compatible)
# ============================================================================
# The browser records a short clip (MediaRecorder) and POSTs the raw bytes here
# with the audio Content-Type. We forward it to Groq's audio/transcriptions
# endpoint and return { text }. The frontend then feeds that text through the
# normal chat path — so voice is just another way to produce a message; nothing
# downstream (prompt, guardrail, model) changes.
STT_URL   = os.environ.get("TRANSCRIBE_URL",
                           "https://api.groq.com/openai/v1/audio/transcriptions")
STT_MODEL = os.environ.get("STT_MODEL", "whisper-large-v3")
MAX_AUDIO_BYTES = 25 * 1024 * 1024   # Groq's per-file limit

# Map an incoming audio Content-Type to a filename extension Groq accepts.
_AUDIO_EXT = [("webm", "webm"), ("ogg", "ogg"), ("mp4", "mp4"), ("m4a", "m4a"),
              ("mpeg", "mp3"), ("mp3", "mp3"), ("wav", "wav"), ("flac", "flac")]


@app.post("/api/transcribe")
async def transcribe(request: Request):
    # Same optional shared-secret gate as /api/coach (no-op unless the secret is set).
    if INTERNAL_TOKEN and request.headers.get("X-Internal-Token", "") != INTERNAL_TOKEN:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not KEY:
        return JSONResponse({"error": "Server has no API key configured."}, status_code=500)

    audio = await request.body()
    if not audio:
        return JSONResponse({"error": "empty audio"}, status_code=400)
    if len(audio) > MAX_AUDIO_BYTES:
        return JSONResponse({"error": "audio too large (max 25 MB)"}, status_code=413)

    ctype = (request.headers.get("content-type") or "audio/webm").split(";")[0].strip()
    ext = next((e for key, e in _AUDIO_EXT if key in ctype), "webm")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream = await client.post(
                STT_URL,
                headers={"Authorization": f"Bearer {KEY}"},
                files={"file": ("audio.%s" % ext, audio, ctype or "audio/webm")},
                data={"model": STT_MODEL, "response_format": "json"},
            )
        if upstream.status_code != 200:
            print("[transcribe] provider error:", upstream.status_code, upstream.text[:300])
            rate = upstream.status_code == 429 or "rate limit" in upstream.text.lower()
            msg = ("Transcription is briefly rate-limited — try again in a few seconds."
                   if rate else "Couldn't transcribe the audio right now.")
            return JSONResponse({"error": msg}, status_code=502)
        data = upstream.json()
        return JSONResponse({"text": (data.get("text") or "").strip()})
    except Exception as err:  # noqa: BLE001
        print("[transcribe] error:", str(err))
        return JSONResponse({"error": "internal server error"}, status_code=500)


# ============================================================================
# INTENT COMPILER — "Rules to Rewards" Create mode (coach_compiler package)
# ============================================================================
# POST /api/compile { messages: [{role, content}, ...] }
#   -> {type: "chat"|"gene_card"|"error", text, card?, errors?}
# Plain `def` endpoints: FastAPI runs them in a threadpool, so the blocking
# urllib call inside the orchestrator doesn't stall the event loop.

from coach_compiler import exemplars as _exemplars  # noqa: E402
from coach_compiler.orchestrator import run_coach as _run_coach  # noqa: E402
from coach_compiler.schema import MAX_AGENTS_PER_BATCH as _MAX_BATCH  # noqa: E402
from coach_compiler.validator import validate_config as _validate_config  # noqa: E402


@app.post("/api/compile")
def compile_intent(body: dict):
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return JSONResponse({"type": "error", "text": "Missing messages"}, status_code=400)
    ui_context = body.get("context")  # optional live Strategy Lab config snapshot
    try:
        # run_coach routes: pure questions -> cheap Explain path; build intents
        # -> full Create path (tool schema + exemplars).
        return JSONResponse(_run_coach(messages[-20:], ui_context=ui_context))
    except Exception as err:  # noqa: BLE001
        print("[compile] error:", str(err))  # full detail stays in server logs
        e = str(err).lower()
        if any(s in e for s in ("rate limit", "429", "too large", "tpm", "quota")):
            text = ("The model provider is rate-limiting (free-tier tokens/minute "
                    "cap). Wait a few seconds and try again, or raise the provider tier.")
        else:
            text = "The compiler backend hit an error contacting the model provider."
        return JSONResponse({"type": "error", "text": text}, status_code=502)


@app.get("/api/compile/health")
def compile_health():
    selftest = all(_validate_config(cfg)["valid"]
                   for _, _, _, cfg, _, _ in _exemplars.WORKED_EXAMPLES)
    return {"ok": True, "model": MODEL, "keySet": bool(KEY),
            "validator_selftest": "pass" if selftest else "FAIL"}


# ── Stage / launch: the "Coach picks, user taps Launch" step ────────────────
# POST /api/launch -> re-validates (defense in depth) and stages agent(s) for
# training. Accepts a single { config } (back-compat) OR a batch { configs:[...] }
# for a fan-out (several agents from one strategy). There is no real training
# backend in this build yet, so this confirms the staged config(s) and returns
# id(s); wire the marked section to the Roostoo factory/training API when it exists.
@app.post("/api/launch")
def launch_agent(body: dict):
    import uuid
    configs = body.get("configs")
    single = configs is None
    if single:
        one = body.get("config")
        configs = [one] if isinstance(one, dict) else None
    if not isinstance(configs, list) or not configs:
        return JSONResponse({"ok": False, "error": "missing config"}, status_code=400)
    if len(configs) > _MAX_BATCH:
        return JSONResponse({"ok": False,
                             "error": "too many agents (max %d per launch)" % _MAX_BATCH},
                            status_code=400)

    staged = []
    for c in configs:
        verdict = _validate_config(c if isinstance(c, dict) else {})
        if not verdict["valid"]:   # never launch an unvalidated config
            return JSONResponse({"ok": False, "errors": verdict["errors"]}, status_code=400)
        cfg = verdict["config"]
        agent_id = "agent_" + uuid.uuid4().hex[:8]
        # >>> WIRE HERE: POST cfg to the Roostoo training/factory API to start
        #     real training, and keep its job id instead of this staged stub.
        print("[launch] staged", agent_id, cfg.get("name"))
        staged.append({"agent_id": agent_id, "name": cfg.get("name"), "config": cfg})

    if single:
        s = staged[0]
        return JSONResponse({
            "ok": True,
            "agent_id": s["agent_id"],
            "staged": True,
            "config": s["config"],
            "note": ("Staged for training. Connect the Roostoo factory API to start "
                     "real training; for now this loads into the Strategy Lab and "
                     "runs a backtest preview."),
        })
    return JSONResponse({
        "ok": True,
        "staged": True,
        "count": len(staged),
        "agents": staged,
        "note": ("%d agents staged for training. Connect the Roostoo factory API "
                 "to start real training." % len(staged)),
    })


# Serve the coach UI from ./public (mounted last so /api routes take priority).
# Resolve public/ relative to THIS file, not the process CWD: on Vercel the
# function runs from /var/task and a bare "public" fails to resolve. Guard the
# mount so a missing directory can never crash import (which would take the
# whole app — and every /api route — down with it).
_PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")


# Explicit root route: StaticFiles(html=True) serves /index.html but its
# bare-"/" index resolution doesn't fire under Vercel's routing, so serve the
# landing page here. Defined before the mount so it takes priority for GET /.
@app.get("/")
def _root():
    # On Render the file is on disk → serve it directly (clean URL). On Vercel
    # public/ is served by the CDN and isn't in the function bundle, so fall
    # back to redirecting to /index.html, which the CDN serves.
    index = os.path.join(_PUBLIC_DIR, "index.html")
    if os.path.isfile(index):
        return FileResponse(index)
    return RedirectResponse(url="/index.html")


if os.path.isdir(_PUBLIC_DIR):
    app.mount("/", StaticFiles(directory=_PUBLIC_DIR, html=True), name="static")
else:
    print(f"[Coach Roostoo] static dir not found at {_PUBLIC_DIR}; "
          "serving API only (static assets will 404).")


if __name__ == "__main__":
    import uvicorn

    print(f"\n[Coach Roostoo] running on http://localhost:{PORT}")
    print(f"[Coach Roostoo] open that link in your browser. Model: {MODEL}")
    print("[Coach Roostoo] Layer 3 output guardrail: ACTIVE\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
