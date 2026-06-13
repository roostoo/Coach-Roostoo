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

/**
 * POST /api/coach
 * body: { system: string, message: string }
 * Streams Gemini's reply back as plain text chunks.
 * The API key never leaves this server.
 */
app.post("/api/coach", async (req, res) => {
  const { system, message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing message" });
  if (!KEY) return res.status(500).json({ error: "Server has no GEMINI_API_KEY configured." });

  // Google's streaming endpoint (Server-Sent Events).
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${KEY}`;

  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: "user", parts: [{ text: message }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
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

    // Gemini streams SSE lines like: data: { ...candidates... }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const json = t.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        try {
          const obj = JSON.parse(json);
          const text = obj?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
          if (text) res.write(text);
        } catch {
          /* ignore partial JSON */
        }
      }
    }
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
  console.log(`[Coach Roostoo] open that link in your browser. Model: ${MODEL}\n`);
});
