import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 8788;
const KEY = process.env.GEMINI_API_KEY;
// Gemini free-tier model. Flash is fast and free.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const app = express();
app.use(cors());
app.use(express.json());

// Serve the coach UI (public/index.html) so the whole thing is one link.
app.use(express.static("public"));

if (!KEY) {
  console.warn("\n[Coach Roostoo] No GEMINI_API_KEY set yet.");
  console.warn("Copy .env.example to .env and paste your free key, then restart.\n");
}

/* ============================================================================
 * LAYER 3 — OUTPUT GUARDRAIL
 * ----------------------------------------------------------------------------
 * The model is instructed (Layer 2, in the system prompt) to educate, not
 * prescribe. This layer is the SAFETY NET for when the model slips anyway.
 *
 * It inspects the COMPLETE model response and decides whether it crossed from
 * education into directive real-world advice. Two possible interventions:
 *   - PASS    → release the text unchanged
 *   - REWRITE → replace with a safe, on-brand redirect (the same move the
 *               prototype's built-in fallback already makes)
 *
 * NOTE ON STREAMING: a guardrail must see the whole answer to judge it — you
 * cannot reliably classify a half-finished sentence. So we BUFFER the model
 * output server-side, screen it, then send it. This trades the token-by-token
 * typing effect for safety. The client still receives plain text the same way;
 * it simply arrives in fewer, larger chunks. If you want the typing effect
 * back, you can re-chunk the released text below (see "release" comment).
 * ========================================================================== */

// Patterns that signal a DIRECTIVE about REAL markets (not the simulator).
// These are intentionally conservative — they look for real-world action
// directives, not mere mentions of assets. Tuned against false positives:
// "in the sandbox/simulator" context is allowed by the system prompt, and the
// model is told to redirect those, so this layer mainly catches leakage.
const REAL_ASSET = /\b(bitcoin|btc|ethereum|eth|crypto|stock|stocks|shares?|tesla|tsla|apple|aapl|s&p|sp500|nasdaq|forex|gold|real money|your portfolio|your money|your account)\b/i;

const DIRECTIVE = /\b(you should (buy|sell|short|long|hold|invest|put|allocate)|i (recommend|suggest|advise) (you )?(buy|sell|short|investing|allocating)|buy now|sell now|go (all in|long|short)|the best (coin|stock|asset|investment) (is|to)|put your money|invest in)\b/i;

// A response is flagged when it pairs a real-world-action directive with a
// real asset OR money reference. Simulator-scoped teaching is NOT flagged.
function crossesLine(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  // Allow-list: if the directive is explicitly scoped to the sim, it's fine.
  // We check sentence-by-sentence so one safe sentence can't excuse a bad one.
  const sentences = t.split(/(?<=[.!?\n])\s+/);
  for (const s of sentences) {
    const hasDirective = DIRECTIVE.test(s);
    if (!hasDirective) continue;
    const simScoped = /(sandbox|simulator|sim|training|agent|episode|backtest|in roostoo|the feed)/i.test(s);
    if (simScoped) continue; // directive is about the sim → allowed
    const realRef = REAL_ASSET.test(s);
    if (realRef) return true; // real-world directive about a real asset/money
  }
  return false;
}

// The safe replacement when the guardrail fires. Mirrors the prototype's own
// voice and the "education, not advice" principle. Kept config-agnostic so the
// server doesn't need to know the user's settings.
const SAFE_REDIRECT =
  "I can't tell you what to do with real money or real assets — Coach Roostoo is here to help you learn inside the Roostoo simulator, where nothing is real. " +
  "What I can do is explain the concept behind your question and how an agent configured like yours might handle it in the sandbox, so you can test the idea safely. " +
  "Want me to break down the mechanics or the risks instead?";

/**
 * POST /api/coach
 * body: { system: string, message: string }
 * Buffers Gemini's reply, screens it (Layer 3), then sends plain text.
 * The API key never leaves this server.
 */
app.post("/api/coach", async (req, res) => {
  const { system, message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing message" });
  if (!KEY) return res.status(500).json({ error: "Server has no GEMINI_API_KEY configured." });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${KEY}`;

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
      res.status(502).end("[error contacting Gemini]");
      return;
    }

    // ---- Read the ENTIRE upstream body first, THEN parse ----
    // We buffer anyway (Layer 3 needs the whole answer), so there's no reason
    // to parse incrementally. Reading to completion first avoids the bug where
    // the final SSE chunk — often the end of the answer — was left stranded in
    // a leftover buffer when the stream closed, truncating the reply.
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
        /* ignore any non-JSON keep-alive lines */
      }
    }

    // ---- LAYER 3: screen the complete answer ----
    let release = full.trim();
    if (crossesLine(release)) {
      console.warn("[coach][guardrail] directive-on-real-asset detected — replacing response.");
      console.warn("[coach][guardrail] original (first 200 chars):", release.slice(0, 200));
      release = SAFE_REDIRECT;
    }

    // ---- Release to client ----
    // Sent in one write (buffered). To restore a typing effect, you could
    // re-chunk `release` here, e.g. split on words and write with small delays.
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
