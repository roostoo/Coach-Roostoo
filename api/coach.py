"""
Coach Roostoo —  serverless function (Groq / OpenAI-compatible).
Lives at api/coach.py -> serves POST /api/coach automatically.
Same logic as the old FastAPI server.py: build prompt -> call model ->
screen output -> return text. Returns the full answer (no streaming).

Env vars (set in the Vercel dashboard, NOT in code):
  API_KEY  - your Groq API key
  API_URL  - chat-completions endpoint (optional; defaults to Groq)
  MODEL    - model name (optional; defaults to Groq's gpt-oss-20b)
"""

import os
import re
import json
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler

KEY = os.environ.get("API_KEY")
API_URL = os.environ.get("API_URL", "https://api.groq.com/openai/v1/chat/completions")
MODEL = os.environ.get("MODEL", "openai/gpt-oss-20b")

# ============================================================================
# LAYER 3 — OUTPUT GUARDRAIL (identical to server.py)
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


def crosses_line(text):
    if not text:
        return False
    for s in re.split(r"(?<=[.!?\n])\s+", text):
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


class handler(BaseHTTPRequestHandler):
    def _send(self, code, text, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # GET /api/coach -> health check
    def do_GET(self):
        self._send(
            200,
            json.dumps({"ok": True, "model": MODEL, "keySet": bool(KEY)}),
            "application/json",
        )

    # POST /api/coach -> the coach
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or "{}")
        except Exception:
            self._send(400, "Invalid request body")
            return

        system = body.get("system")
        message = body.get("message")
        if not message:
            self._send(400, "Missing message")
            return
        if not KEY:
            self._send(500, "Server has no API key configured.")
            return

        # OpenAI-compatible request: a "messages" array (system + user).
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": message})

        payload = json.dumps({
            "model": MODEL,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 2000,
            "stream": False,
        }).encode("utf-8")

        req = urllib.request.Request(
            API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + KEY,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                detail = e.read()[:300]
            except Exception:
                detail = b""
            print("[coach] provider error:", e.code, detail)
            self._send(502, "[error contacting model provider]")
            return
        except Exception as e:
            print("[coach] error:", str(e))
            self._send(500, "[server error]")
            return

        # OpenAI-style response: answer is at choices[0].message.content.
        try:
            full = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            full = ""

        # ---- LAYER 3: screen the complete answer ----
        release = full.strip()
        if crosses_line(release):
            print("[coach][guardrail] directive-on-real-asset detected — replacing response.")
            release = SAFE_REDIRECT

        self._send(200, release or "(no response)")
