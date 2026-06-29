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

import os
import re

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

PORT           = int(os.environ.get("PORT", "8788"))
KEY            = os.environ.get("API_KEY")
INTERNAL_TOKEN = os.environ.get("COACH_SERVICE_SECRET", "")
# Groq's OpenAI-compatible chat-completions endpoint.
API_URL        = os.environ.get("API_URL", "https://api.groq.com/openai/v1/chat/completions")
MODEL          = os.environ.get("MODEL", "openai/gpt-oss-20b")

if not KEY:
    print("\n[Coach Roostoo] No API key set yet.")
    print("Set API_KEY in your environment and restart.\n")

# System prompt — Python owns this; the Go backend does not send one.
SYSTEM_PROMPT = (
    "You are Coach Roostoo, an expert trading educator inside the Roostoo "
    "paper-trading simulator. You help users understand trading concepts, "
    "strategies, risk management, and how to use the Roostoo platform — but "
    "you never give real-money financial advice or directives. "
    "Keep answers clear, concise, and educational, always grounded in the "
    "Roostoo simulation context."
)

app = FastAPI()

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

    # ── Parse new Go contract: PascalCase keys ────────────────────────────────
    # Go sends: { "Messages": [{"Role": "user", "Content": "...", "Ts": ...}],
    #             "UserContext": {"UserId": 123} }
    incoming     = body.get("Messages", [])
    # user_context = body.get("UserContext", {})  # reserved for future use

    if not incoming:
        return JSONResponse({"error": "Missing Messages"}, status_code=400)
    if not KEY:
        return JSONResponse({"error": "Server has no API key configured."}, status_code=500)

    # Convert PascalCase Go message objects → snake_case for the LLM API.
    messages = [
        {"role": m["Role"], "content": m["Content"]}
        for m in incoming
        if m.get("Role") and m.get("Content")
    ]

    # Prepend system prompt if the history doesn't already start with one.
    if not messages or messages[0]["role"] != "system":
        messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})

    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 2000,
        "stream": False,  # we buffer the full response for the guardrail
    }

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
            print("[coach] LLM provider error:", upstream.status_code, upstream.text[:300])
            return JSONResponse({"error": "error contacting model provider"}, status_code=502)

        # OpenAI-style response: answer is at choices[0].message.content.
        data = upstream.json()
        full = ""
        try:
            full = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            full = ""

        # ---- LAYER 3: screen the complete answer ----
        release = full.strip()
        if crosses_line(release):
            print("[coach][guardrail] directive-on-real-asset detected — replacing response.")
            print("[coach][guardrail] original (first 200 chars):", release[:200])
            release = SAFE_REDIRECT

        # Return JSON so Go can parse Reply + ModelID.
        return JSONResponse({"Reply": release or "(no response)", "ModelID": MODEL})

    except Exception as err:  # noqa: BLE001
        print("[coach] error:", str(err))
        return JSONResponse({"error": "internal server error"}, status_code=500)


@app.get("/api/health")
async def health():
    return {"ok": True, "model": MODEL, "keySet": bool(KEY)}


# Serve the coach UI from ./public (mounted last so /api routes take priority).
app.mount("/", StaticFiles(directory="public", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    print(f"\n[Coach Roostoo] running on http://localhost:{PORT}")
    print(f"[Coach Roostoo] open that link in your browser. Model: {MODEL}")
    print("[Coach Roostoo] Layer 3 output guardrail: ACTIVE\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
