/**
 * Which origins this page may contact, and the sentence it says when it will
 * not.
 *
 * Phase 1 had one answer — `https://api.github.com` — and the browser enforced
 * it with a `Content-Security-Policy` naming that single host. Phase 2 has to
 * reach an instance the operator started, whose address this repository cannot
 * know at build time, and a `Content-Security-Policy` is static markup written
 * before the operator has typed anything.
 *
 * That tension is resolved by narrowing rather than by widening. The policy
 * permits the two shapes of address a CloFin reference instance actually has —
 * a port on the operator's own machine, and a forwarded GitHub Codespaces URL
 * — and nothing else. Both are shapes, not hosts: `connect-src` cannot name a
 * port the operator has not chosen yet. What it can do is refuse everything
 * that is not one of those two shapes, which is a great deal narrower than
 * `https:` and is the strongest static statement available.
 *
 * The rules are written **once, here**, and three things are derived from them:
 * the `connect-src` directive the build renders into the page, the runtime
 * refusal in `net.ts`, and the sentence the interface shows an operator whose
 * address was refused. A second copy of a rule like this is a copy that can be
 * relaxed while the first stays strict — the failure `clofin-core`'s standing
 * lesson **L-6** records.
 *
 * **This is not a security boundary and is not offered as one.** It bounds what
 * a mistake or a bug in this page can reach. Anyone who can edit the page can
 * edit this file; the point is that doing so is a visible change to a file
 * whose whole content is the rule, rather than an accident.
 */

/** One permitted shape of instance address, and how to say it in both forms. */
export interface OriginRule {
  /** How the interface names this shape to an operator. */
  readonly label: string;
  /** The `connect-src` sources this shape needs. */
  readonly cspSources: readonly string[];
  /** Whether a parsed URL is this shape. */
  readonly matches: (url: URL) => boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The Codespaces forwarded-port domain.
 *
 * A subdomain wildcard, because a forwarded port's hostname is generated per
 * Codespace and nobody can enumerate them. Written as a suffix match with a
 * leading dot so that a host merely *ending in* the letters — the
 * `evil-app.github.dev.attacker.example` shape — cannot match.
 */
const CODESPACES_SUFFIX = ".app.github.dev";

export const ORIGIN_RULES: readonly OriginRule[] = [
  {
    label: "an instance on your own machine",
    cspSources: [
      "http://localhost:*",
      "http://127.0.0.1:*",
      "https://localhost:*",
      "https://127.0.0.1:*",
    ],
    matches: (url) =>
      (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname),
  },
  {
    label: "a GitHub Codespace's forwarded port",
    cspSources: ["https://*.app.github.dev"],
    matches: (url) => url.protocol === "https:" && url.hostname.endsWith(CODESPACES_SUFFIX),
  },
];

/** The one origin this page reads published releases from. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/**
 * The `connect-src` directive, assembled from the rules above.
 *
 * `'self'` is here for one thing only: the seed profiles, which are JSON
 * documents served beside this page out of the same deployment. It is not a
 * general permission to talk to the host — there is nothing else on it.
 */
export function connectSources(): readonly string[] {
  return ["'self'", GITHUB_API_ORIGIN, ...ORIGIN_RULES.flatMap((rule) => rule.cspSources)];
}

/**
 * The whole `Content-Security-Policy` the built page carries.
 *
 * Assembled here rather than typed into `static/index.html`, for the same
 * reason the scope statement is: one copy. `tools/build.mjs` renders this
 * string into the page, and `tools/guard-network.mjs` compares the page
 * against this same function and additionally asserts the properties below —
 * so widening the policy by editing this file fails the build rather than
 * quietly succeeding.
 *
 * - `default-src 'none'` — nothing loads unless a directive allows it.
 * - `script-src 'self'` — this page's own modules, and no inline script.
 * - `connect-src` — the sources above and nothing else.
 * - `form-action 'none'` — the page has forms now, and none of them may
 *   submit anywhere. Their handlers run in JavaScript; the browser will not
 *   let one navigate even if a handler failed to prevent it.
 * - `base-uri 'none'` — no injected `<base>` can re-point a relative URL.
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${connectSources().join(" ")}`,
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Why an address was refused, in the words the interface shows. */
export interface OriginRefusal {
  readonly kind: "refused";
  readonly reason: string;
}

export interface OriginAccepted {
  readonly kind: "accepted";
  /** The origin, as the browser computes it — scheme, host and port. */
  readonly origin: string;
  /** The base URL with any trailing slash removed, so paths append cleanly. */
  readonly baseUrl: string;
  /** Which rule admitted it, so the interface can say. */
  readonly rule: string;
  /**
   * Whether this address will be blocked as mixed content when the cockpit is
   * itself served over `https`. A plain-`http` loopback address is *not*:
   * browsers treat `localhost` and `127.0.0.1` as potentially trustworthy. Any
   * other plain-`http` address is, and saying so is better than a fetch that
   * fails with nothing in it.
   */
  readonly plainHttp: boolean;
}

export type OriginDecision = OriginAccepted | OriginRefusal;

const RULE_LIST = ORIGIN_RULES.map((rule) => rule.label).join(", or ");

/**
 * Decide whether the cockpit may contact this base URL, and say why not.
 *
 * A refusal is a sentence an operator can act on. "Failed to fetch" is what
 * happens instead if a page lets the browser find out.
 */
export function decideInstanceUrl(raw: string): OriginDecision {
  const text = raw.trim();
  if (text === "") {
    return { kind: "refused", reason: "Enter the base URL of a running CloFin instance." };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      kind: "refused",
      reason:
        `"${text}" is not a URL. Give the whole address including the scheme — ` +
        "for example the address your own instance answers on, port and all.",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "refused", reason: `"${url.protocol}" is not a scheme this page can request.` };
  }

  if (url.username !== "" || url.password !== "") {
    return {
      kind: "refused",
      reason:
        "That URL carries credentials in it. This page holds no credential of any kind and " +
        "will not put one in a request.",
    };
  }

  const rule = ORIGIN_RULES.find((candidate) => candidate.matches(url));
  if (!rule) {
    return {
      kind: "refused",
      reason:
        `This page may only contact ${RULE_LIST}. ${url.origin} is neither, so the request ` +
        "is refused here — and the page's Content-Security-Policy would refuse it in the " +
        "browser as well. See src/origins.ts for the whole rule.",
    };
  }

  return {
    kind: "accepted",
    origin: url.origin,
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    rule: rule.label,
    plainHttp: url.protocol === "http:",
  };
}
