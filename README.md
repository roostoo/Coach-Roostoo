# Coach Roostoo

An in-app educational coach for the Roostoo Strategy Lab. It helps users understand
how to build and tune a reinforcement-learning trading agent — explaining indicators,
reward functions, decision frequency, training steps, and how the Roostoo platform
works (competitions, fees, tiers, XP, wallets, payouts).

Coach Roostoo **educates, it does not advise**: it explains concepts and platform
mechanics, but never tells a user what to do with real money.

## What's in here

```
.
├── api/
│   └── coach.py          # serverless backend: builds the prompt, calls the model,
│                         # screens the output, returns the answer
├── public/
│   ├── index.html        # the Strategy Lab UI + chat dock
│   └── assets/
│       ├── app.js         # frontend logic, system prompt, chat wiring
│       ├── sim-engine.js  # the backtest replay engine
│       ├── css2           # font stylesheet
│       └── *.png          # coin + agent icons
│   └── brand/
│       ├── roostoo-icon.png
│       └── agents/*.png   # agent avatars
├── vercel.json           # Vercel build + routing config
└── requirements.txt      # empty — the function uses only the Python standard library
```

## How it works

- The **frontend** (`public/`) runs in the browser. When a user asks a question, it
  builds a grounded system prompt (including the user's current agent config and the
  Roostoo platform facts) and sends it to the backend.
- The **backend** (`api/coach.py`) is a Vercel serverless function served at
  `/api/coach`. It holds the API key, calls the model provider, runs an output
  guardrail, and returns the answer. The key never reaches the browser.

### Two safety layers
1. **System prompt** (in `app.js`) — instructs the model to educate, not advise, and
   to never give real-money buy/sell directives.
2. **Output guardrail** (in `api/coach.py`) — screens the model's reply and replaces
   it with a safe redirect if it slips into a real-world financial directive.

## Model provider

The backend targets **Groq** (OpenAI-compatible: a `messages` array in, the answer at
`choices[0].message.content` out, Bearer auth). Any OpenAI-compatible provider
(DeepSeek, OpenAI, etc.) works by changing the env vars below — no code change.
Switching to Gemini *would* require code changes, since its request/response format
differs.

## Environment variables

Set these in the Vercel dashboard (Project -> Settings -> Environment Variables).
Never commit them to the repo.

| Variable  | Required | Default                                             | Purpose                   |
|-----------|----------|-----------------------------------------------------|---------------------------|
| `API_KEY` | yes      | --                                                  | Your provider API key     |
| `API_URL` | no       | `https://api.groq.com/openai/v1/chat/completions`   | Chat-completions endpoint |
| `MODEL`   | no       | `openai/gpt-oss-20b`                                 | Model name to call        |

## Deploying (Vercel)

1. Push this repo to GitHub.
2. Import it into Vercel (or run `vercel` from the CLI).
3. Add `API_KEY` under Environment Variables.
4. Deploy. Vercel serves the static `public/` files and runs `api/coach.py` as a
   serverless function automatically -- no build step, no dependencies to install.

### Verify it's working
- Open the site and ask the coach a question (e.g. "how much to enter a competition?").
- Hit `/api/coach` directly in a browser -- it should return
  `{"ok": true, "model": "...", "keySet": true}`. If `keySet` is `false`, the
  `API_KEY` env var isn't set.

### A note on caching
Browsers cache `app.js` aggressively. After deploying a change, hard-refresh
(Cmd/Ctrl + Shift + R) or you may keep seeing the old version.

## Notes & limitations

- The coach is **stateless** -- it has no memory across messages or sessions. Each
  question is answered on its own.
- Serverless functions cold-start, so the first request after a period of inactivity
  may take an extra second or two.
- The Roostoo platform facts live in the system prompt in `app.js`. When platform
  details change (fees, tiers, etc.), update them there.
