# Coach Roostoo — live PoC (Google Gemini, free)

A config-aware Training Coach for the Agent Factory, with the training sandbox
below it. Answers are generated **live by Google Gemini's free tier**. A small
server keeps the API key safe (the browser never sees it).

There are two things you can do:

- **Part A — run it on your own computer** to test it (5 minutes).
- **Part B — put it online for free** so coworkers just open a link (10 minutes).

Do Part A first to make sure it works, then Part B to share it.

---

## First: get your free Gemini key (1 minute, no credit card)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with a Google account.
3. Click **Create API key**. Copy the long string it gives you. That's your key.

Keep it somewhere safe. Treat it like a password — don't paste it into the web
page or share it publicly.

---

## Part A — Run it on your computer (to test)

You need **Node.js** installed (https://nodejs.org — get the "LTS" version).

1. Open this folder in a terminal / command prompt.
2. Install the bits it needs:
   ```
   npm install
   ```
3. Make your key file:
   ```
   cp .env.example .env
   ```
   (On Windows, just copy the file and rename the copy to `.env`.)
   Open `.env` and paste your key after `GEMINI_API_KEY=`.
4. Start it:
   ```
   npm start
   ```
5. Open **http://localhost:8788** in your browser. Ask a question — the answer is
   now generated live by Gemini, grounded in the indicators you've selected.

> If you see "(Showing a built-in answer…)", the key isn't set correctly. Check
> `.env` has your real key and restart with `npm start`.

---

## Part B — Put it online for free (to share with coworkers)

We'll use **Render** — a free host. Your coworkers will just open a link; they
install nothing.

### One-time setup

1. Put this folder on **GitHub** (create a free account at github.com if needed,
   make a new repository, and upload these files).
   - *Easiest way if you're new:* on your repo page, click **Add file → Upload
     files**, drag everything in this folder in, and commit.
   - **Do NOT upload your `.env` file.** It's already excluded by `.gitignore`.
     Your key goes in Render's settings instead (next step).

2. Go to **https://render.com**, sign up (free), and click
   **New → Web Service**. Connect your GitHub and pick this repository.

3. Render reads `render.yaml` and fills most settings in for you. Confirm:
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan: **Free**

4. Before deploying, add your key as a secret:
   - In the service's **Environment** section, add a variable:
     - **Key:** `GEMINI_API_KEY`
     - **Value:** *(paste your Gemini key)*

5. Click **Create Web Service**. Wait a couple of minutes while it builds.

6. Render gives you a link like **`https://coach-roostoo.onrender.com`**.
   That's the link you share. Open it — it's the full coach, live.

### That's it

Send the link to your team. Anyone who opens it can use the live coach. No
install, no key on their end.

> **Free-tier note:** Render's free service "sleeps" after a while idle, so the
> first visit after a quiet period may take ~30 seconds to wake up. After that
> it's fast. This is fine for a demo.

---

## Things to know (please read before sharing)

- **Free Gemini limits:** about 1,500 questions per day. A demo won't hit that,
  but if the whole team hammers it, it can pause until the next day.
- **Privacy:** free-tier prompts may be used by Google to improve their models.
  Keep it to made-up trading-sim questions — **do not** put real customer or
  company data through it.
- **The key stays secret:** it lives only on the server (your `.env` locally, or
  Render's Environment settings online). It's never in the web page, so opening
  the link can't leak it.

---

## How this maps to the real Roostoo app

- `public/index.html` — the coach UI. In the real app this becomes a component in
  the Agent Factory; the config it reads would come from the existing app state.
- `systemPrompt()` inside it — the grounding layer (injects the user's selected
  indicators/reward/risk). This is the reusable core of the feature.
- `server.js` — the backend. In production this is a route on Roostoo's own
  backend; swap Gemini for whatever model you choose. Same shape.
- The training section below is the existing simulator UI, included so the coach
  sits in its real context (learn → configure → train).

---

## Files

```
.
├── server.js          # backend: holds the key, calls Gemini, streams answers
├── package.json
├── render.yaml        # tells Render how to run it
├── .env.example       # copy to .env, paste your key
├── .gitignore         # keeps your key + node_modules out of GitHub
└── public/
    └── index.html     # the coach UI + config + training section
```
