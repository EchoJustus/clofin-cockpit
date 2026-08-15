/**
 * The only place in this repository that makes a network request.
 *
 * The cockpit is allowed to reach exactly one origin — `https://api.github.com`
 * — and nothing else: no analytics, no telemetry, no font service, no CDN, no
 * error reporter. That is enforced three times over, deliberately, because a
 * single reviewer's attention is not a control:
 *
 * 1. **Here, at runtime.** {@link getJson} parses the URL and refuses any
 *    origin but the allowed one before `fetch` is reached. A caller that
 *    passes an attacker-influenced or simply wrong URL gets an exception, not
 *    a request.
 * 2. **In the browser, by policy.** The built page carries a
 *    `Content-Security-Policy` of `default-src 'none'; connect-src
 *    https://api.github.com`, so the browser itself blocks anything else —
 *    including anything this module might do wrong.
 * 3. **At build time.** `tools/guard-network.mjs` refuses to emit a site whose
 *    output calls `fetch` anywhere but here, weakens that policy, carries an
 *    off-origin subresource, or contains a form element or any credential
 *    storage. The build fails; there is no site to publish.
 *
 * **No credential is ever handled.** The GitHub Releases API is read without
 * authentication. There is no token field, no authorisation header, and no
 * browser storage of any kind — `credentials: "omit"` says so to the browser
 * as well as to the reader. (The header name is spelled the other way and does
 * not appear anywhere in the built output; the build guard checks for it.) Unauthenticated GitHub API access is rate limited by IP;
 * that is a real limitation and {@link RateLimited} exists so the interface
 * can say so plainly rather than showing an empty list.
 */

/** The one origin this application may contact. */
export const ALLOWED_ORIGIN = "https://api.github.com";

/** The request was refused before it was made. */
export class BlockedOriginError extends Error {
  constructor(attempted: string) {
    super(
      `Refused to request ${attempted}: this application may only contact ` +
        `${ALLOWED_ORIGIN}. See src/net.ts.`,
    );
    this.name = "BlockedOriginError";
  }
}

/** GitHub answered, but refused to serve this request. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, url: string) {
    super(`GitHub answered ${status} ${statusText} for ${url}`);
    this.name = "HttpError";
    this.status = status;
  }
}

/** The unauthenticated rate limit is spent. Distinguished so the page can say so. */
export class RateLimited extends Error {
  /** When the limit resets, if GitHub said. */
  readonly resetAt: Date | null;

  constructor(resetAt: Date | null) {
    super(
      "GitHub's unauthenticated rate limit for this network is spent. " +
        "The cockpit holds no token to raise it — by design.",
    );
    this.name = "RateLimited";
    this.resetAt = resetAt;
  }
}

function resetTime(response: Response): Date | null {
  const header = response.headers.get("x-ratelimit-reset");
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/**
 * GET a JSON document from the GitHub API.
 *
 * @throws {BlockedOriginError} if `url` is not on {@link ALLOWED_ORIGIN}.
 * @throws {RateLimited} when the unauthenticated quota is exhausted.
 * @throws {HttpError} for any other non-2xx answer.
 */
export async function getJson(url: string): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedOriginError(url);
  }

  if (parsed.origin !== ALLOWED_ORIGIN) {
    throw new BlockedOriginError(parsed.origin);
  }

  const response = await fetch(parsed.toString(), {
    method: "GET",
    // `Accept` and nothing else, on purpose. It is a CORS-safelisted request
    // header, so this stays a *simple* request and the browser sends it
    // straight out. Adding any custom header — `X-GitHub-Api-Version` is the
    // tempting one — would make the browser send a `OPTIONS` preflight first,
    // and api.github.com answers preflights with 405 Method Not Allowed. The
    // whole release browser would then fail with an opaque "Failed to fetch"
    // that looks like a network problem and is not. Checked against the live
    // API: GET returns `Access-Control-Allow-Origin: *`, OPTIONS returns 405.
    headers: { Accept: "application/vnd.github+json" },
    // Nothing about this application is authenticated, and saying so to the
    // browser is cheaper than being trusted about it.
    credentials: "omit",
    mode: "cors",
    redirect: "follow",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });

  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if ((response.status === 403 || response.status === 429) && remaining === "0") {
      throw new RateLimited(resetTime(response));
    }
    throw new HttpError(response.status, response.statusText, parsed.toString());
  }

  return (await response.json()) as unknown;
}
