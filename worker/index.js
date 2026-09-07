// Cloudflare Worker: proxies chat completions to OpenAI so the API key never reaches the browser.
// The model and output cap are pinned here so a leaked proxy URL can't run up the bill on bigger models.
// Deploy: cd worker && wrangler deploy   (secret: wrangler secret put OPENAI_API_KEY)
const MODEL = "gpt-5.4-nano"; // ~5s curation vs ~10s for gpt-5.6-luna at the same price (bench 2026-09-07)
const MAX_OUTPUT_TOKENS = 4000;

const ALLOWED_ORIGINS = [
  "https://isaiahcurate.net",
  "http://localhost",
  "http://127.0.0.1",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
    const path = new URL(request.url).pathname;
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers });
    }

    if (path === "/log") return logSession(body, env, headers);
    if (path !== "/v1/chat/completions") return new Response("Not found", { status: 404, headers });

    body.model = MODEL;
    body.max_completion_tokens = Math.min(body.max_completion_tokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  },
};

// Fire-and-forget record of each finished exhibition. Table is created on first write,
// so there is no migration step. Read with:
//   wrangler d1 execute isaiah-logs --remote --command "SELECT * FROM sessions ORDER BY id DESC LIMIT 20"
async function logSession(body, env, headers) {
  if (!env.DB) return new Response("no db", { status: 501, headers });
  const str = (v, max) => String(v ?? "").slice(0, max);
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        theme TEXT, interview TEXT, title TEXT, picks TEXT)`),
      env.DB.prepare("INSERT INTO sessions (theme, interview, title, picks) VALUES (?, ?, ?, ?)")
        .bind(str(body.theme, 500), str(JSON.stringify(body.qa ?? []), 4000), str(body.title, 300), str(JSON.stringify(body.picks ?? []), 2000)),
    ]);
    return new Response("ok", { status: 200, headers });
  } catch (e) {
    return new Response(String(e), { status: 500, headers });
  }
}
