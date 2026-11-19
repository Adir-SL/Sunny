/**
 * Optional proxy so a Google Maps Platform key never ships in the static site.
 *
 * Deploy with Wrangler (or paste this into a Cloudflare Worker):
 *   wrangler secret put API_KEY
 *   wrangler deploy
 *
 * Set ALLOWED_ORIGINS to a comma-separated list, for example
 * https://adir-sl.github.io,http://localhost:8080
 * Then put the worker origin in Sunny settings (or config.public.json).
 * The browser calls this worker; the worker adds the key and forwards:
 *   /v1/...                         -> https://weather.googleapis.com/v1/...
 *   /places/v1/...                  -> https://places.googleapis.com/v1/...
 *   POST /places/v1/places:searchNearby
 *                                   -> Places API (New) Nearby Search
 *   /geocode/json                   -> https://maps.googleapis.com/maps/api/geocode/json
 */

export function routeUpstream(url, method) {
  const incoming = new URL(url, "https://proxy.local");
  if (method === "GET" && incoming.pathname.startsWith("/v1/")) {
    return `https://weather.googleapis.com${incoming.pathname}${incoming.search}`;
  }
  if ((method === "GET" || method === "POST") && incoming.pathname.startsWith("/places/v1/")) {
    return `https://places.googleapis.com${incoming.pathname.slice("/places".length)}${incoming.search}`;
  }
  if (method === "GET" && incoming.pathname === "/geocode/json") {
    return `https://maps.googleapis.com/maps/api/geocode/json${incoming.search}`;
  }
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!allowed.includes(origin)) {
      return new Response("Origin is not allowed.", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (!env.API_KEY) {
      return json({ error: { message: "Worker is missing API_KEY." } }, 500, origin);
    }

    const incoming = new URL(request.url);
    const routed = routeUpstream(incoming.pathname + incoming.search, request.method);
    if (!routed) return json({ error: { message: "Path is not proxied." } }, 404, origin);
    const target = new URL(routed);
    if (!incoming.pathname.startsWith("/places/")) {
      target.searchParams.delete("key");
      target.searchParams.set("key", env.API_KEY);
    }

    const headers = new Headers();
    const mask = request.headers.get("X-Goog-FieldMask");
    const type = request.headers.get("Content-Type");
    if (mask) headers.set("X-Goog-FieldMask", mask);
    if (type) headers.set("Content-Type", type);
    if (incoming.pathname.startsWith("/places/")) headers.set("X-Goog-Api-Key", env.API_KEY);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
    });
    const responseHeaders = cors(origin);
    responseHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};

function cors(origin) {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Goog-FieldMask",
    "Vary": "Origin",
  });
}

function json(body, status, origin) {
  const headers = cors(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}
