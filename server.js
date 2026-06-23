import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8788;
// Reusing the existing GEMINI_API_KEY env var (now holds a DeepSeek key).
// Falls back to DEEPSEEK_API_KEY if you ever rename it on Render.
const KEY = process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY;
// DeepSeek model. Overridable from Render (set DEEPSEEK_MODEL) so you can
// switch to "deepseek-chat" without editing code if "deepseek-v4-flash"
// is rejected as an unknown model on your account.
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
// DeepSeek's OpenAI-compatible chat-completions endpoint.
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const app = express();
app.use(cors());
app.use(express.json());

// Serve the coach UI (public/index.html) so the whole thing is one link.
app.use(express.static("public"));

if (!KEY) {
  console.warn("\n[Coach Roostoo] No API key set yet.");
  console.warn("Set GEMINI_API_KEY (holding your DeepSeek key) and restart.\n");
}

/* ============================================================================
 * LAYER 3 — OUTPUT GUARDRAIL  (unchanged from the Gemini version)
 * ----------------------------------------------------------------------------
 * The model is instructed (Layer 2, in the system prompt) to educate, not
 * prescribe. This layer is the SAFETY NET for when the model slips anyway.
 * It inspects the COMPLETE model response and, if it crossed into directive
 * real-world advice, replaces it with a safe redirect. Model-agnostic — it
 * screens text, so it works identically with DeepSeek.
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
 * Calls DeepSeek, screens the reply (Layer 3), then sends plain text.
 * The API key never leaves this server.
 */
app.post("/api/coach", async (req, res) => {
  const { system, message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing message" });
  if (!KEY) return res.status(500).json({ error: "Server has no API key configured." });

  // DeepSeek uses the OpenAI-style messages array: a system message + the user
  // message, instead of Gemini's systemInstruction/contents shape.
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: message });

  const body = {
    model: MODEL,
    messages,
    temperature: 0.4,
    max_tokens: 1000,
    stream: false, // we buffer anyway for the guardrail; no need to stream
  };

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`, // DeepSeek/OpenAI-style auth header
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      console.error("[coach] DeepSeek error:", upstream.status, errText.slice(0, 300));
      res.status(502).end("[error contacting DeepSeek]");
      return;
    }

    // Non-streaming JSON response: the answer is at choices[0].message.content.
    const data = await upstream.json();
    const full = data?.choices?.[0]?.message?.content || "";

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
