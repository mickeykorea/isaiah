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
    if (new URL(request.url).pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers });
    }
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
