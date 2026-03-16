import type { APIRoute } from "astro";

export const prerender = false;

/**
 * POST /api/check-redirects
 * Body: { urls: string[] }
 * Response: { results: Array<{ url: string; redirects: boolean; location?: string }> }
 *
 * Checks each URL for HTTP redirects server-side (no CORS issues).
 */
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json()) as { urls?: unknown };
  if (!body || !Array.isArray(body.urls)) {
    return new Response(JSON.stringify({ error: "Expected { urls: string[] }" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const urls: string[] = body.urls.filter(
    (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u),
  );

  if (urls.length === 0) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Cap at 50 URLs per request to prevent abuse
  const capped = urls.slice(0, 50);

  const results = await Promise.all(
    capped.map(async (url) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(url, {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const status = response.status;
        const isRedirect = status >= 300 && status < 400;
        const location = response.headers.get("location") ?? undefined;

        return { url, redirects: isRedirect, location };
      } catch {
        return { url, redirects: false, error: true };
      }
    }),
  );

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
};
