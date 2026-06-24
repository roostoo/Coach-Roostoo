import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8788;

/* ============================================================================
 * PROVIDER CONFIG (generic variable names, currently set up for Gemini)
 * ----------------------------------------------------------------------------
 *   API_KEY   - your provider's API key
 *   API_URL   - the provider's endpoint base (without the key)
 *   MODEL     - the model name to call
 *
 * NOTE: this build targets GOOGLE GEMINI specifically. Gemini is NOT
 * OpenAI-compatible — it uses systemInstruction/contents in the request and
 * candidates[].content.parts in the response, plus SSE streaming. Switching to
 * an OpenAI-style provider (DeepSeek, OpenAI, etc.) means changing the request
 * body and response parsing below, not just these values.
 * ========================================================================== */
const KEY     = process.env.API_KEY;
const API_URL = process.env.API_URL || "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL   = process.env.MODEL   || "gemini-2.5-flash";

const app = express();
app.use(cors());
app.use(express.json());

// Serve the coach UI (public/index.html) so the whole thing is one link.
app.use(express.static("public"));

if (!KEY) {
  console.warn("\n[Coach Roostoo] No API key set yet.");
  console.warn("Set API_KEY in your environment and restart.\n");
}

/* ============================================================================
 * LAYER 3 — OUTPUT GUARDRAIL
 * ----------------------------------------------------------------------------
 * Safety net for when the model slips despite the system prompt. It inspects
 * the COMPLETE model response and, if it crossed into directive real-world
 * advice, replaces it with a safe redirect. Provider-agnostic — screens text.
 * ========================================================================== */

const REAL_ASSET = /\b(bitcoin|btc|ethereum|eth|crypto|stock|stocks|shares?|tesla|tsla|apple|aapl|s&p|sp500|nasdaq|forex|gold|real money|your portfolio|your money|your account)\b/i;

const DIRECTIVE = /\b(you should (buy|sell|short|long|hold|invest|put|allocate)|i (recommend|suggest|advise) (you )?(buy|sell|short|investing|allocating)|buy now|sell now|go (all in|long|short)|the best (coin|stock|asset|investment) (is|to)|put your money|invest in)\b/i;

function crossesLine(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const sentences = t.split(/(?<=[.!?\n])\s+/);
  for (const s of sentences) {
    const hasDirective = DIRECTIVE.test(s);
    if (!hasDirective) continue;
    const simScoped = /(sandbox|simulator|sim|training|agent|episode|backtest|in roostoo|the feed)/i.test(s);
    if (simScoped) continue;
    const realRef = REAL_ASSET.test(s);
    if (realRef) return true;
  }
  return false;
}

const SAFE_REDIRECT =
  "I can't tell you what to do with real money or real assets — Coach Roostoo is here to help you learn inside the Roostoo simulator, where nothing is real. " +
  "What I can do is explain the concept behind your question and how an agent configured like yours might handle it in the sandbox, so you can test the idea safely. " +
  "Want me to break down the mechanics or the risks instead?";

/**
 * POST /api/coach
 * body: { system: string, message: string }
 * Calls Gemini, buffers + screens the reply (Layer 3), then sends plain text.
 * The API key never leaves this server.
 */
app.post("/api/coach", async (req, res) => {
  const { system, message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing message" });
  if (!KEY) return res.status(500).json({ error: "Server has no API key configured." });

  // Gemini's streaming endpoint (SSE). URL = base + /MODEL:streamGenerateContent
  const url = `${API_URL}/${MODEL}:streamGenerateContent?alt=sse&key=${KEY}`;

  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: "user", parts: [{ text: message }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 },
  };

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      console.error("[coach] Gemini error:", upstream.status, errText.slice(0, 300));
      res.status(502).end("[error contacting model provider]");
      return;
    }

    // Read the ENTIRE SSE body first, THEN parse (avoids dropping the final
    // chunk — the end of the answer — that a streaming parser can strand).
    const wholeBody = await upstream.text();

    let full = "";
    for (const rawLine of wholeBody.split("\n")) {
      const t = rawLine.trim();
      if (!t.startsWith("data:")) continue;
      const json = t.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const obj = JSON.parse(json);
        const text = obj?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
        if (text) full += text;
      } catch {
        /* ignore non-JSON keep-alive lines */
      }
    }

    // ---- LAYER 3: screen the complete answer ----
    let release = full.trim();
    if (crossesLine(release)) {
      console.warn("[coach][guardrail] directive-on-real-asset detected — replacing response.");
      console.warn("[coach][guardrail] original (first 200 chars):", release.slice(0, 200));
      release = SAFE_REDIRECT;
    }

    res.write(release || "(no response)");
    res.end();
  } catch (err) {
    console.error("[coach] error:", err?.message || err);
    if (!res.headersSent) res.status(500).end("[server error]");
    else res.end("\n[stream error]");
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL, keySet: !!KEY }));

app.listen(PORT, () => {
  console.log(`\n[Coach Roostoo] running on http://localhost:${PORT}`);
  console.log(`[Coach Roostoo] open that link in your browser. Model: ${MODEL}`);
  console.log(`[Coach Roostoo] Layer 3 output guardrail: ACTIVE\n`);
});
