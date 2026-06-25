"""
Coach Roostoo — FastAPI server (Python port of the Node/Express version).

Behaviour is identical to the Node version:
  - POST /api/coach   : build prompt -> call the model -> screen output -> return text
  - GET  /api/health  : { ok, model, keySet }
  - serves the UI from ./public (index.html) so it's one link

PROVIDER CONFIG (generic env names, currently set up for Gemini):
  API_KEY  - your provider's API key
  API_URL  - the provider's endpoint base (without the key)
  MODEL    - the model name to call

NOTE: this build targets GOOGLE GEMINI. Gemini is NOT OpenAI-compatible — it
uses systemInstruction/contents in the request and candidates[].content.parts
in the response (SSE streaming). Switching to an OpenAI-style provider
(DeepSeek, OpenAI, etc.) means changing the request body and response parsing,
not just these values.

Run locally:
  pip install fastapi uvicorn httpx python-dotenv
  uvicorn server:app --host 0.0.0.0 --port 8788
"""

import os
import re
import json

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

PORT = int(os.environ.get("PORT", "8788"))
KEY = os.environ.get("API_KEY")
API_URL = os.environ.get(
    "API_URL", "https://generativelanguage.googleapis.com/v1beta/models"
)
MODEL = os.environ.get("MODEL", "gemini-2.5-flash")

if not KEY:
    print("\n[Coach Roostoo] No API key set yet.")
    print("Set API_KEY in your environment and restart.\n")

app = FastAPI()

# ============================================================================
# LAYER 3 — OUTPUT GUARDRAIL
# ----------------------------------------------------------------------------
# Safety net for when the model slips despite the system prompt. Inspects the
# COMPLETE model response and, if it crossed into directive real-world advice,
# replaces it with a safe redirect. Provider-agnostic — it screens text.
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
    # Split into sentences so one safe sentence can't excuse a bad one.
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

    # Gemini streaming endpoint (SSE): base + /MODEL:streamGenerateContent
    url = f"{API_URL}/{MODEL}:streamGenerateContent?alt=sse&key={KEY}"

    payload = {
        "contents": [{"role": "user", "parts": [{"text": message}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 10000},
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream = await client.post(
                url, headers={"Content-Type": "application/json"}, json=payload
            )

        if upstream.status_code != 200:
            print(
                "[coach] Gemini error:",
                upstream.status_code,
                upstream.text[:300],
            )
            return PlainTextResponse(
                "[error contacting model provider]", status_code=502
            )

        # Read the ENTIRE SSE body, THEN parse (avoids dropping the final chunk).
        full = ""
        for raw_line in upstream.text.split("\n"):
            t = raw_line.strip()
            if not t.startswith("data:"):
                continue
            data_str = t[5:].strip()
            if not data_str or data_str == "[DONE]":
                continue
            try:
                obj = json.loads(data_str)
                parts = (
                    obj.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                text = "".join(p.get("text", "") for p in parts)
                if text:
                    full += text
            except (json.JSONDecodeError, IndexError, KeyError):
                # ignore non-JSON keep-alive lines
                pass

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
