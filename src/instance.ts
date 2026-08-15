/**
 * Connecting to a running instance, and refusing to.
 *
 * Everything on the instance screen comes from two requests — `GET /` and
 * `GET /readyz` — and is the instance's own answer, shown as it arrived. This
 * module does the asking and the refusing; it computes nothing about what the
 * answers mean.
 *
 * ## The honesty gate
 *
 * **An instance whose `GET /` carries no disclaimer field is refused.** Not
 * warned about, not shown with a caveat: refused, with nothing rendered from
 * it and no connection remembered. The cockpit exists to drive *this* system,
 * whose defining property is that it says what it is; an address that answers
 * without saying so is either not CloFin or is a CloFin that has stopped doing
 * the one thing this repository is arranged around, and neither is something to
 * start sending payment instructions to.
 *
 * A disclaimer that is present but **not** the canonical sentence is a
 * different case and is handled differently: the connection proceeds, both
 * texts are shown, and the divergence is named down to the character. Refusing
 * there would hide the more interesting fact — that this instance's statement
 * of scope differs from the one this page quotes — behind an error screen. The
 * canonical statement stays in the frame throughout, so the two are never
 * confusable.
 *
 * ## Tag and coverage: matched, never assumed
 *
 * `sourceCommit` is what the instance says it is running, and `clofin-core`'s
 * contract calls it *self-reported, not attested*, so this page says the same.
 * A tag is rendered beside it **only** when that commit equals the
 * dereferenced SHA of a real `ref-<n>` tag from the GitHub Tags API. Three
 * outcomes, all of them stated:
 *
 * - the commit matches a tag → the tag and that release's audit coverage,
 *   which are the same values the release browser shows, from the same fetch;
 * - the commit matches none → said plainly, with no tag;
 * - the tag list could not be read → *not checked*, which is not the same as
 *   *no match* and must never render as one. That is the fail-closed shape of
 *   `clofin-core`'s standing lessons **L-6** and **L-13**.
 */

import { formatCoverage, type Coverage } from "./coverage.js";
import { curlFor, exchange, parseJson, type Exchange } from "./net.js";
import { decideInstanceUrl, type OriginAccepted } from "./origins.js";
import type { ReleaseRecord } from "./releases.js";
import { SCOPE_STATEMENT } from "./scope.js";

export { curlFor };

/** What `GET /` said, as strings, with nothing inferred. */
export interface InstanceInfo {
  readonly service: string;
  readonly description: string;
  readonly environment: string;
  /** Verbatim, as the instance sent it. */
  readonly disclaimer: string;
  /** Verbatim. `"unknown"` is a real answer and is displayed as one. */
  readonly sourceCommit: string;
  readonly documentation: string | null;
}

/** What `GET /readyz` said, when it answered at all. */
export interface InstanceReadiness {
  readonly status: string;
  readonly schemaVersion: string | null;
  readonly checks: Readonly<Record<string, string>>;
  /** The status code, because a 503 here is a real answer worth showing. */
  readonly httpStatus: number;
}

/** How the instance's disclaimer compares with the sentence this page quotes. */
export type DisclaimerComparison =
  | { readonly kind: "identical" }
  | { readonly kind: "differs"; readonly at: number; readonly detail: string };

/** Whether this instance's commit is a published tag — decided, never assumed. */
export type TagMatch =
  | { readonly kind: "matched"; readonly tag: string; readonly coverage: Coverage }
  | { readonly kind: "no-match"; readonly commit: string }
  | { readonly kind: "not-checked"; readonly reason: string }
  | { readonly kind: "not-a-commit"; readonly reported: string };

export interface ConnectedInstance {
  readonly kind: "connected";
  readonly baseUrl: string;
  readonly origin: string;
  readonly rule: string;
  readonly plainHttp: boolean;
  readonly info: InstanceInfo;
  readonly disclaimer: DisclaimerComparison;
  readonly readiness: InstanceReadiness | null;
  /** Why readiness is absent, when it is. */
  readonly readinessFailure: string | null;
  /** Both requests, in order, exactly as they went out and came back. */
  readonly exchanges: readonly Exchange[];
}

export interface RefusedInstance {
  readonly kind: "refused";
  readonly baseUrl: string;
  readonly reason: string;
  /** Everything that happened before the refusal. A refusal shows its evidence. */
  readonly exchanges: readonly Exchange[];
}

export type ConnectionResult = ConnectedInstance | RefusedInstance;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Name the first character at which two statements diverge.
 *
 * The same reporting `scope-verbatim` uses on the built page, applied to a
 * sentence that arrived over the network. "The disclaimer differs" is not a
 * finding anybody can act on; "character 34, `o` became `m`" is.
 */
export function compareDisclaimer(received: string): DisclaimerComparison {
  if (received === SCOPE_STATEMENT) return { kind: "identical" };

  const limit = Math.min(received.length, SCOPE_STATEMENT.length);
  let index = 0;
  while (index < limit && received[index] === SCOPE_STATEMENT[index]) index += 1;

  const describe = (character: string | undefined) =>
    character === undefined
      ? "end of text"
      : `${JSON.stringify(character)} (U+${character.codePointAt(0)?.toString(16).padStart(4, "0").toUpperCase()})`;

  return {
    kind: "differs",
    at: index,
    detail:
      `first differs at character ${index}: this page quotes ` +
      `${describe(SCOPE_STATEMENT[index])}, the instance sent ${describe(received[index])}`,
  };
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Join the instance's commit to a published tag, or say why not.
 *
 * `records` is what the release browser already fetched: `null` means the Tags
 * API was not read, which is *not-checked* and is deliberately a different
 * answer from *no-match*.
 */
export function matchTag(
  sourceCommit: string,
  records: readonly ReleaseRecord[] | null,
  whyNotChecked = "the published releases could not be read, so this commit was not compared with any tag",
): TagMatch {
  if (!COMMIT_PATTERN.test(sourceCommit)) {
    return { kind: "not-a-commit", reported: sourceCommit };
  }
  if (records === null) {
    return { kind: "not-checked", reason: whyNotChecked };
  }
  const hit = records.find((record) => record.sha === sourceCommit);
  if (!hit) return { kind: "no-match", commit: sourceCommit };
  return { kind: "matched", tag: hit.release.tag, coverage: hit.coverage };
}

/** The one-line label for a tag match. Never blank, and never a bare tag. */
export function formatTagMatch(match: TagMatch): string {
  switch (match.kind) {
    case "matched":
      return `${match.tag} — release-audit coverage: ${formatCoverage(match.coverage)}`;
    case "no-match":
      return "this commit is not any published ref-<n> tag";
    case "not-checked":
      return `not checked — ${match.reason}`;
    case "not-a-commit":
      return `the instance reported ${JSON.stringify(match.reported)}, which is not a commit id`;
  }
}

function readInfo(body: unknown): InstanceInfo | null {
  const raw = asRecord(body);
  if (!raw) return null;
  return {
    service: asString(raw["service"], "(not stated)"),
    description: asString(raw["description"], "(not stated)"),
    environment: asString(raw["environment"], "(not stated)"),
    disclaimer: asString(raw["disclaimer"]),
    // A missing field is not silently "unknown": `clofin-core` always answers
    // one, so its absence means this instance predates the field or is not
    // CloFin, and both are worth saying rather than smoothing over.
    sourceCommit: typeof raw["sourceCommit"] === "string" ? raw["sourceCommit"] : "(not reported)",
    documentation: typeof raw["documentation"] === "string" ? raw["documentation"] : null,
  };
}

function readReadiness(status: number, body: unknown): InstanceReadiness | null {
  const raw = asRecord(body);
  if (!raw) return null;
  const checks: Record<string, string> = {};
  const rawChecks = asRecord(raw["checks"]);
  if (rawChecks) {
    for (const [name, value] of Object.entries(rawChecks)) {
      if (typeof value === "string") checks[name] = value;
    }
  }
  return {
    status: asString(raw["status"], asString(raw["title"], "(not stated)")),
    schemaVersion: typeof raw["schemaVersion"] === "string" ? raw["schemaVersion"] : null,
    checks,
    httpStatus: status,
  };
}

/**
 * Ask an address what it is.
 *
 * Two requests, in order, both recorded. `GET /` decides whether there is a
 * connection at all; `GET /readyz` is asked afterwards and its failure is
 * reported rather than fatal — an instance whose database is down is still an
 * instance, and telling the operator that is more useful than refusing to show
 * them anything.
 */
export async function connectToInstance(rawUrl: string): Promise<ConnectionResult> {
  const decision = decideInstanceUrl(rawUrl);
  if (decision.kind === "refused") {
    return { kind: "refused", baseUrl: rawUrl.trim(), reason: decision.reason, exchanges: [] };
  }
  const accepted: OriginAccepted = decision;

  const infoExchange = await exchange({ method: "GET", url: `${accepted.baseUrl}/` });
  const exchanges: Exchange[] = [infoExchange];

  if (!infoExchange.response) {
    return {
      kind: "refused",
      baseUrl: accepted.baseUrl,
      reason:
        `${accepted.baseUrl}/ did not answer (${infoExchange.failure ?? "no response"}). ` +
        (accepted.plainHttp
          ? "If this page is served over https, a plain-http address other than localhost is " +
            "blocked by the browser as mixed content — and a browser reports that as an " +
            "ordinary network failure. Check the instance is running and the port is right."
          : "Check the instance is running and the address is right."),
      exchanges,
    };
  }

  if (infoExchange.response.status !== 200) {
    return {
      kind: "refused",
      baseUrl: accepted.baseUrl,
      reason:
        `${accepted.baseUrl}/ answered ${infoExchange.response.status} ` +
        `${infoExchange.response.statusText}. A CloFin instance answers 200 there and says ` +
        "what it is.",
      exchanges,
    };
  }

  const info = readInfo(parseJson(infoExchange.response.body));
  if (!info) {
    return {
      kind: "refused",
      baseUrl: accepted.baseUrl,
      reason: `${accepted.baseUrl}/ answered 200 but not with a JSON object.`,
      exchanges,
    };
  }

  // The gate. Everything above this line is about whether there was an answer;
  // this is about whether the answer identifies itself.
  if (info.disclaimer.trim() === "") {
    return {
      kind: "refused",
      baseUrl: accepted.baseUrl,
      reason:
        "Refused: this service's GET / carries no disclaimer field. Every CloFin instance " +
        "states its scope there, and the cockpit does not drive a system that does not say " +
        "what it is. The raw response is below — nothing was read from it beyond this check.",
      exchanges,
    };
  }

  const readyExchange = await exchange({ method: "GET", url: `${accepted.baseUrl}/readyz` });
  exchanges.push(readyExchange);

  const readiness = readyExchange.response
    ? readReadiness(readyExchange.response.status, parseJson(readyExchange.response.body))
    : null;

  return {
    kind: "connected",
    baseUrl: accepted.baseUrl,
    origin: accepted.origin,
    rule: accepted.rule,
    plainHttp: accepted.plainHttp,
    info,
    disclaimer: compareDisclaimer(info.disclaimer),
    readiness,
    readinessFailure: readyExchange.response ? null : readyExchange.failure,
    exchanges,
  };
}
