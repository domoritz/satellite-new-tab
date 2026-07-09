// CORS pass-through for CIRA SLIDER (slider.cira.colostate.edu).
//
// Contract: GET /?<url-encoded slider URL>
// The website calls this because SLIDER sends no CORS headers. The extension does
// NOT use this worker (it fetches SLIDER directly via host_permissions).
//
// Only SLIDER hosts are allowed, so this cannot be abused as an open proxy.

const ALLOWED_HOSTS = new Set([
  "slider.cira.colostate.edu",
  "rammb-slider.cira.colostate.edu",
]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function withCors(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(body, { ...init, headers });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(null, { status: 204 });
    }
    if (request.method !== "GET") {
      return withCors("Method not allowed", { status: 405 });
    }

    const requestUrl = new URL(request.url);
    // Everything after the leading "?" is the (url-encoded) target URL.
    const target = decodeURIComponent(requestUrl.search.slice(1));
    if (!target) {
      return withCors("Usage: /?<url-encoded slider URL>", { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return withCors("Invalid URL", { status: 400 });
    }

    if (targetUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return withCors("Forbidden host", { status: 403 });
    }

    // Tiles are immutable and cache-friendly; latest_times.json changes often.
    const isJson = targetUrl.pathname.endsWith(".json");
    const cacheTtl = isJson ? 60 : 604800;

    const upstream = await fetch(targetUrl.toString(), {
      cf: { cacheEverything: true, cacheTtl },
    });

    const response = withCors(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
    response.headers.set(
      "Cache-Control",
      isJson ? "public, max-age=60" : "public, max-age=604800, immutable",
    );
    return response;
  },
};
