"""
Coach Roostoo — FastAPI server (Groq / OpenAI-compatible build).

  - POST /api/coach   : build prompt -> call the model -> screen output -> return text
  - GET  /api/health  : { ok, model, keySet }
  - serves the UI from ./public (index.html) so it's one link

PROVIDER CONFIG (generic env names, currently set up for Groq):
  API_KEY  - your provider's API key
  API_URL  - the provider's chat-completions endpoint
  MODEL    - the model name to call

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

PORT = int(os.environ.get("PORT", "8788"))
KEY = os.environ.get("API_KEY")
# Groq's OpenAI-compatible chat-completions endpoint.
API_URL = os.environ.get("API_URL", "https://api.groq.com/openai/v1/chat/completions")
MODEL = os.environ.get("MODEL", "openai/gpt-oss-20b")

if not KEY:
    print("\n[Coach Roostoo] No API key set yet.")
    print("Set API_KEY in your environment and restart.\n")

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
    body = await request.json()
    system = body.get("system")
    message = body.get("message")

    if not message:
        return JSONResponse({"error": "Missing message"}, status_code=400)
    if not KEY:
        return JSONResponse(
            {"error": "Server has no API key configured."}, status_code=500
        )

    # OpenAI-compatible request: a "messages" array (system + user).
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": message})

    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 2000,
        "stream": False,  # we buffer anyway for the guardrail
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
            print("[coach] Groq error:", upstream.status_code, upstream.text[:300])
            return PlainTextResponse(
                "[error contacting model provider]", status_code=502
            )

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

        return PlainTextResponse(release or "(no response)")

    except Exception as err:  # noqa: BLE001
        print("[coach] error:", str(err))
        return PlainTextResponse("[server error]", status_code=500)


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
