import type { APIRoute } from "astro";

export const prerender = false;

/** Run async tasks with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * POST /api/check-redirects
 * Body: { urls: string[] }
 * Response: { results: Array<{ url: string; redirects: boolean; location?: string }> }
 *
 * Checks each URL for HTTP redirects server-side (no CORS issues).
 * Uses concurrency limiting to avoid overwhelming the server.
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

  // Cap at 20 URLs per request to keep payloads small
  const capped = urls.slice(0, 20);

  async function checkUrl(url: string): Promise<{ url: string; redirects: boolean; location?: string; error?: true }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      // Use GET instead of HEAD — many servers don't return correct
      // redirect status codes for HEAD requests.
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Consume/discard the body so the connection is released
      await response.body?.cancel();

      const status = response.status;
      const isRedirect = status >= 300 && status < 400;
      const location = response.headers.get("location") ?? undefined;

      return { url, redirects: isRedirect, location };
    } catch {
      return { url, redirects: false, error: true };
    }
  }

  // Only 5 outbound fetches at a time to avoid hammering the server
  const firstPass = await mapWithConcurrency(capped, 5, checkUrl);

  // Retry any URLs that failed (timeout/network errors) once more —
  // transient failures are the main cause of inconsistent results.
  const needsRetry = firstPass.filter((r) => r.error);
  if (needsRetry.length > 0) {
    const retried = await mapWithConcurrency(needsRetry, 3, (r) => checkUrl(r.url));
    const retryMap = new Map(retried.map((r) => [r.url, r]));
    for (let i = 0; i < firstPass.length; i++) {
      const updated = retryMap.get(firstPass[i].url);
      if (updated) firstPass[i] = updated;
    }
  }

  const results = firstPass;

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
};
