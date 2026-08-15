/**
 * Recent scenario runs, read anonymously — or the reason there is no list.
 *
 * ## The rule this module exists to keep
 *
 * This phase of the cockpit holds **no token**. So the batch-runs page may show
 * a list of recent runs only if the public GitHub API serves that list without
 * one, and the honest way to establish that is to ask and report the answer —
 * not to assume it, and above all not to put a token field on the page when the
 * answer turns out to be no.
 *
 * Hence two outcomes and no third:
 *
 * - **listed** — the API answered `200` and the runs below are what it sent;
 * - **absent** — it did not, and the reason is GitHub's own answer, quoted.
 *
 * There is deliberately no "retry with a token" path, no field to paste one
 * into, and no message suggesting the reader supply one. If the anonymous API
 * stops serving this, the page says so and keeps the link to the workflow, which
 * is where a signed-in person dispatches and reads runs anyway.
 *
 * ## Raw words, not our words
 *
 * A run's `status` and `conclusion` are GitHub's vocabulary and are rendered
 * exactly as they arrive — `completed`, `success`, `failure`, `in_progress`,
 * `cancelled`. This module maps none of them onto friendlier language, for the
 * same reason `SIM-` scheme names are never prettified elsewhere: a word this
 * repository invented for somebody else's state is a word a reader cannot check.
 * A run still going carries no conclusion at all, and that absence is rendered
 * as an absence rather than as a neutral-sounding word.
 */

import { scenarioRunsUrl } from "./cockpit-repo.js";
import { BlockedOriginError, getJson, GITHUB_API_ORIGIN, HttpError, RateLimited } from "./net.js";

/** One workflow run, narrowed to what the page shows. */
export interface ScenarioRun {
  readonly id: number;
  readonly runNumber: number;
  /** GitHub's own word: `queued`, `in_progress`, `completed`. */
  readonly status: string;
  /** GitHub's own word, or `null` while the run has not concluded. */
  readonly conclusion: string | null;
  readonly createdAt: string | null;
  /** What the dispatch was called — the workflow's own display title. */
  readonly title: string;
  /** What triggered it. `workflow_dispatch` is the only one this workflow has. */
  readonly event: string;
  readonly htmlUrl: string;
}

export type RunsResult =
  | { readonly kind: "listed"; readonly runs: readonly ScenarioRun[] }
  | { readonly kind: "absent"; readonly reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Map the API's response to the runs the page shows.
 *
 * Separated from the fetch so the mapping — including the deliberate absence of
 * a conclusion on a run still going — is testable without a network.
 */
export function buildRuns(raw: unknown): readonly ScenarioRun[] {
  const list = asRecord(raw)?.["workflow_runs"];
  if (!Array.isArray(list)) return [];

  const runs: ScenarioRun[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (!record) continue;
    const htmlUrl = asString(record["html_url"]);
    if (htmlUrl === "") continue;
    runs.push({
      id: asNumber(record["id"]),
      runNumber: asNumber(record["run_number"]),
      status: asString(record["status"], "(not stated)"),
      // `null` and "no conclusion yet" are the same fact and are kept as one.
      // Anything that is not a string — including the absent member of a run
      // still in flight — is an absence, never a word.
      conclusion: typeof record["conclusion"] === "string" ? record["conclusion"] : null,
      createdAt: typeof record["created_at"] === "string" ? record["created_at"] : null,
      title: asString(record["display_title"], asString(record["name"], "(not stated)")),
      event: asString(record["event"], "(not stated)"),
      htmlUrl,
    });
  }
  return runs;
}

/** How the page describes a run's outcome. Never a word GitHub did not send. */
export function describeConclusion(run: ScenarioRun): string {
  if (run.conclusion !== null) return run.conclusion;
  return `${run.status} — no conclusion yet`;
}

/**
 * Ask the public API for this workflow's recent runs.
 *
 * Every failure becomes an `absent` with the reason, because the page's job
 * here is to say what happened rather than to show nothing and let the reader
 * guess. The request carries no credential: `net.ts` sends `Accept` and nothing
 * else, and there is no token in this repository to send.
 */
export async function fetchScenarioRuns(): Promise<RunsResult> {
  try {
    const raw = await getJson(scenarioRunsUrl(GITHUB_API_ORIGIN));
    return { kind: "listed", runs: buildRuns(raw) };
  } catch (error) {
    if (error instanceof RateLimited) {
      return {
        kind: "absent",
        reason:
          `${error.message}` +
          (error.resetAt ? ` The limit resets at ${error.resetAt.toISOString()}.` : ""),
      };
    }
    if (error instanceof HttpError) {
      return {
        kind: "absent",
        reason:
          `${error.message}. The list is served to a signed-in reader on github.com; this page ` +
          "holds no credential and does not ask for one, so it shows the link instead.",
      };
    }
    if (error instanceof BlockedOriginError) {
      return { kind: "absent", reason: error.message };
    }
    return {
      kind: "absent",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
