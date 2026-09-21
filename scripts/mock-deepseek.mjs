// scripts/mock-deepseek.mjs
//
// Offline stand-in for api.deepseek.com, useful for exercising the DeepSeek
// integration without spending tokens or reaching the public internet.
//
//   node scripts/mock-deepseek.mjs            # listens on 0.0.0.0:8787
//   PORT=9000 node scripts/mock-deepseek.mjs
//
// Then run the app with:
//   DEEPSEEK_API_KEY=sk-local-mock DEEPSEEK_BASE_URL=http://127.0.0.1:8787 npm run dev

import http from "node:http";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

function lastUserMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return String(messages[index].content || "");
  }
  return "";
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (req.method !== "POST" || !req.url?.startsWith("/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }

    const auth = req.headers.authorization || "";
    if (!auth.toLowerCase().startsWith("bearer ") || auth.length < 12) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Authentication Fails" } }));
      return;
    }

    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
      return;
    }

    const thinking = body.thinking?.type === "enabled";
    const source = lastUserMessage(body);
    const text = source.split("Transcript batch:").pop() || source;
    const systemText = (Array.isArray(body.messages) ? body.messages : [])
      .filter((message) => message?.role === "system")
      .map((message) => String(message.content || ""))
      .join("\n");
    // When the app injects a delivery contract the pass is asking for a
    // structured document, so the stand-in preserves lines and headers instead of
    // flattening everything into one speaker turn. That lets the output guards be
    // exercised end to end without a live model.
    const contractBound = /DELIVERY CONTRACT/i.test(systemText);
    const cleaned = text.replace(/\b(um|uh|you know)\b,?\s*/gi, "");
    const answer = contractBound
      ? cleaned.replace(/[ \t]+$/gm, "").trim()
      : `SPEAKER 1: ${cleaned.replace(/\s+/g, " ").trim()}`;

    console.log(
      `[mock-deepseek] ${body.model} · ${thinking ? "thinking" : "non-thinking"} · ` +
        `${body.messages?.length || 0} message(s) · max_tokens=${body.max_tokens}`
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `chatcmpl-mock-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "deepseek-flash",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: answer,
              ...(thinking ? { reasoning_content: "[mock] normalized speaker turn, restored punctuation." } : {}),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 256, completion_tokens: 128, total_tokens: 384 },
      })
    );
  });
});

server.listen(port, host, () => {
  console.log(`[mock-deepseek] listening on http://${host}:${port}/chat/completions`);
});
