/**
 * The only place in this repository that makes a network request.
 *
 * Phase 1 could state the rule in one line: one origin, `api.github.com`, and
 * nothing else. Phase 2 drives an instance whose address the operator supplies,
 * so the rule is longer — but it is still a rule, still in one file, and still
 * enforced three times over, because a single reviewer's attention is not a
 * control:
 *
 * 1. **Here, at runtime.** Every request goes through {@link exchange}, which
 *    parses the URL and refuses any origin that is not (a) `api.github.com`,
 *    (b) this page's own origin, or (c) an instance the operator has actually
 *    connected — present in {@link connectedOrigins} because `registry.ts` put
 *    it there. A URL that is merely *shaped* like an instance is not enough:
 *    it has to be one the operator connected.
 * 2. **In the browser, by policy.** The built page's `Content-Security-Policy`
 *    names those sources and no others, assembled from `origins.ts` at build
 *    time so the policy and the runtime check cannot drift.
 * 3. **At build time.** `tools/guard-network.mjs` refuses to emit a site whose
 *    output calls `fetch` anywhere but here, weakens that policy, carries an
 *    off-origin subresource, sends telemetry, or persists anything outside the
 *    instance registry. The build fails; there is no site to publish.
 *
 * **No credential is ever handled.** GitHub is read anonymously; there is no
 * token field and no token storage, and the build guard fails on the header
 * name and on the word for the kind of GitHub token that would carry one.
 * The synthetic actor ids a bootstrap run mints are a different thing and are
 * treated as credentials anyway: `credentials.ts` holds them in memory for the
 * session, and {@link exchange} is what makes "sent only to that instance's
 * origin" true rather than intended — a caller cannot address one instance's
 * headers at another instance's URL, because the caller passes the base URL
 * and this module derives the origin from it.
 *
 * **Every request is recorded.** {@link exchange} returns what it sent and what
 * came back, verbatim, including on failure. That is the transparent-client
 * doctrine in its literal form: the interface shows the exchange, not a
 * summary of it, and `curlFor` renders the same request as a command the
 * operator can run themselves.
 */

import { GITHUB_API_ORIGIN } from "./origins.js";

export { GITHUB_API_ORIGIN };

/** Kept for the release browser, which was written against this name. */
export const ALLOWED_ORIGIN = GITHUB_API_ORIGIN;

/** The request as it was sent. Header values included — there are no secrets in them. */
export interface RawRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string | null;
}

/**
 * The response as the browser let this page see it.
 *
 * Note the qualification. A cross-origin response's headers are readable only
 * if the server named them in `Access-Control-Expose-Headers`; what is shown
 * here is what the page can actually read, which is not always what the server
 * sent. The interface says so rather than presenting a filtered list as a
 * complete one.
 */
export interface RawResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** One request and its outcome, whichever way it went. */
export interface Exchange {
  readonly request: RawRequest;
  readonly response: RawResponse | null;
  /** Set when the request never produced a response at all. */
  readonly failure: string | null;
  readonly durationMs: number;
}

/** The request was refused before it was made. */
export class BlockedOriginError extends Error {
  constructor(attempted: string) {
    super(
      `Refused to request ${attempted}: this page contacts ${GITHUB_API_ORIGIN}, its own ` +
        "origin, and instances you have connected — nothing else. See src/net.ts.",
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

/**
 * The instance origins the operator has connected.
 *
 * A `Set`, in memory, for the life of the page. `registry.ts` is the only
 * module that adds to it — connecting is the act that permits the origin, and
 * forgetting an instance removes it in the same breath as the credentials for
 * it. There is deliberately no way to add an origin without going through a
 * connection, because "an origin this page may contact" and "an instance the
 * operator connected" have to be the same set or the first is a wider
 * permission than anybody granted.
 */
const connectedOrigins = new Set<string>();

/** Permit requests to an instance origin. Called when a connection succeeds. */
export function connectOrigin(origin: string): void {
  connectedOrigins.add(origin);
}

/** Withdraw permission. Called when an instance is forgotten. */
export function disconnectOrigin(origin: string): void {
  connectedOrigins.delete(origin);
}

/** For the interface and the tests: what is currently permitted. */
export function connectedOriginList(): readonly string[] {
  return [...connectedOrigins].sort();
}

function selfOrigin(): string | null {
  return typeof location === "undefined" ? null : location.origin;
}

function permitted(origin: string): boolean {
  return origin === GITHUB_API_ORIGIN || origin === selfOrigin() || connectedOrigins.has(origin);
}

function headerPairs(headers: Headers): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  headers.forEach((value, name) => pairs.push([name, value] as const));
  return pairs.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Make a request and record it.
 *
 * Never throws for an HTTP status: a `409` and a `403` are answers, and on a
 * page whose product is showing what the system said, an answer that is not
 * `2xx` is often the most important thing on the screen. It throws only for
 * {@link BlockedOriginError}, which is this page refusing itself.
 */
export async function exchange(options: {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | null;
}): Promise<Exchange> {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new BlockedOriginError(options.url);
  }
  if (!permitted(parsed.origin)) {
    throw new BlockedOriginError(parsed.origin);
  }

  const headers = { ...(options.headers ?? {}) };
  const body = options.body ?? null;
  const request: RawRequest = {
    method: options.method.toUpperCase(),
    url: parsed.toString(),
    headers: Object.entries(headers).sort((a, b) => a[0].localeCompare(b[0])),
    body,
  };

  const started = performance.now();
  try {
    const response = await fetch(parsed.toString(), {
      method: request.method,
      headers,
      // Only when there is one: a GET with a null body is fine, a GET with a
      // body is a TypeError.
      ...(body === null ? {} : { body }),
      // Nothing about this page is authenticated by the browser. Saying so is
      // cheaper than being trusted about it, and it is what keeps a cookie
      // from riding along to an instance on the operator's own machine.
      credentials: "omit",
      mode: "cors",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    const text = await response.text();
    return {
      request,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: headerPairs(response.headers),
        body: text,
      },
      failure: null,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      request,
      response: null,
      failure: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      durationMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * The exchange as a command the operator can run themselves.
 *
 * The point of rendering it is not convenience. A page that claims to show you
 * what it sent is asking to be taken at its word; a command you can paste into
 * a terminal and compare is how you check.
 */
export function curlFor(request: RawRequest): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -i -X ${request.method} ${quote(request.url)}`];
  for (const [name, value] of request.headers) {
    parts.push(`  -H ${quote(`${name}: ${value}`)}`);
  }
  if (request.body !== null) {
    parts.push(`  --data ${quote(request.body)}`);
  }
  return parts.join(" \\\n");
}

/** Parse a response body as JSON, or `undefined` if it is not JSON at all. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function resetTime(headers: readonly (readonly [string, string])[]): Date | null {
  const header = headers.find(([name]) => name === "x-ratelimit-reset")?.[1];
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/**
 * GET a JSON document from the GitHub API.
 *
 * @throws {BlockedOriginError} if `url` is not on {@link GITHUB_API_ORIGIN}.
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
  if (parsed.origin !== GITHUB_API_ORIGIN) {
    throw new BlockedOriginError(parsed.origin);
  }

  const result = await exchange({
    method: "GET",
    url: parsed.toString(),
    // `Accept` and nothing else, on purpose. It is a CORS-safelisted request
    // header, so this stays a *simple* request and the browser sends it
    // straight out. Adding any custom header — `X-GitHub-Api-Version` is the
    // tempting one — would make the browser send an `OPTIONS` preflight first,
    // and api.github.com answers preflights with 405 Method Not Allowed. The
    // whole release browser would then fail with an opaque "Failed to fetch"
    // that looks like a network problem and is not. Checked against the live
    // API: GET returns `Access-Control-Allow-Origin: *`, OPTIONS returns 405.
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!result.response) {
    throw new Error(result.failure ?? "The request to GitHub did not complete.");
  }

  const { status, statusText, headers, body } = result.response;
  if (status < 200 || status >= 300) {
    const remaining = headers.find(([name]) => name === "x-ratelimit-remaining")?.[1];
    if ((status === 403 || status === 429) && remaining === "0") {
      throw new RateLimited(resetTime(headers));
    }
    throw new HttpError(status, statusText, parsed.toString());
  }

  return parseJson(body);
}

/**
 * GET a document this deployment serves beside the page.
 *
 * Used for the seed profiles, which are JSON files in this repository rather
 * than data compiled into the application. That is deliberate: a profile you
 * can fetch from the deployed site and compare with the file in the repository
 * is a profile you can check, and one embedded in a bundle is one you have to
 * take on trust.
 */
export async function getOwnJson(path: string): Promise<unknown> {
  const origin = selfOrigin();
  if (origin === null) throw new BlockedOriginError(path);
  const result = await exchange({ method: "GET", url: new URL(path, location.href).toString() });
  if (!result.response) {
    throw new Error(result.failure ?? `${path} could not be read.`);
  }
  if (result.response.status !== 200) {
    throw new Error(`${path} answered ${result.response.status} ${result.response.statusText}.`);
  }
  const parsed = parseJson(result.response.body);
  if (parsed === undefined) throw new Error(`${path} is not JSON.`);
  return parsed;
}
