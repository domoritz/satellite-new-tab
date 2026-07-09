// CORS pass-through for the satellite image sources that don't send CORS headers.
//
// Contract: GET /?<url-encoded source URL>
// The website calls this because CIRA SLIDER (tiles/JSON) and the NASA EPIC image
// archive send no CORS headers, so a browser can't fetch them onto a canvas. The
// extension does NOT use this worker (it fetches these hosts directly via
// host_permissions).
//
// Only these hosts are allowed, so this cannot be abused as an open proxy.

const ALLOWED_HOSTS = new Set([
  "slider.cira.colostate.edu",
  "rammb-slider.cira.colostate.edu",
  "epic.gsfc.nasa.gov",
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
    let target: string;
    try {
      target = decodeURIComponent(requestUrl.search.slice(1));
    } catch {
      return withCors("Invalid URL encoding", { status: 400 });
    }
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

    // Redirects are followed; acceptable because only allowlisted SLIDER hosts reach here.
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
