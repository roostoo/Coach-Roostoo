# Coach Roostoo

A config-aware training coach for the Agent Factory. It explains indicators, reward functions, and risk settings in plain language, grounded in whatever the user has selected — and it answers educationally rather than giving real-money advice.

Answers come from Google Gemini. A small Python server holds the API key so the browser never sees it; if the server is unreachable, the UI falls back to built-in sample answers so it never looks broken.

## Running it locally

You need Python 3.10+ installed.

1. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
2. Set your Gemini key (get one free at https://aistudio.google.com/apikey):
   ```
   export API_KEY=your_key_here
   ```
   On Windows: `set API_KEY=your_key_here`
3. Start the server:
   ```
   uvicorn server:app --host 0.0.0.0 --port 8788
   ```
4. Open http://localhost:8788

If the coach shows "(built-in answer)", the key isn't being read — check `API_KEY` is set and restart. You can confirm at http://localhost:8788/api/health, which reports whether the key is loaded.

## Deploying on Render

1. Push this folder to GitHub. Don't commit any key — it goes in Render's settings, not the repo.
2. On Render: New → Web Service, connect the repo. It reads `render.yaml`, which sets:
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn server:app --host 0.0.0.0 --port $PORT`
3. Under Environment, add `API_KEY` with your Gemini key.
4. Deploy. Render gives you a link to share — coworkers just open it, no install.

Render's free tier sleeps when idle, so the first request after a quiet spell takes ~30 seconds to wake. Fine for a demo; a paid tier removes it.

## How it maps to the real app

- `public/index.html` — the coach UI plus the training sandbox. In production this becomes a component in the Agent Factory, reading config from the live app state instead of the demo's controls.
- `systemPrompt()` (in `index.html`) — the grounding and safety layer: injects the user's selected indicators/reward/risk and enforces educate-don't-advise behavior. This is the reusable core.
- `server.py` — the backend: holds the key, calls the model, and screens the output (the guardrail). In production this becomes a route on Roostoo's own backend; the model is swappable.

## A few things worth knowing

- The key lives only on the server (your environment locally, or Render's settings online), never in the page.
- Gemini's free tier has a daily request cap and may use prompts to improve its models — keep it to simulator questions, no real customer or company data.
- The coach is educational by design. It won't give real-world buy/sell advice; for platform facts (fees, rules, scoring) the intended approach is to point users to the official Roostoo docs rather than answer from memory.

## Files

```
.
├── server.py          # backend: holds the key, calls the model, screens output
├── requirements.txt   # Python dependencies
├── render.yaml        # tells Render how to run it
└── public/
    └── index.html     # coach UI + config + training sandbox
```
