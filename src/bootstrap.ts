/**
 * The bootstrap runner: the cockpit's first write path.
 *
 * It executes a profile's steps against a connected instance, **strictly in
 * order**, and stops at the first thing that does not go as the profile said it
 * would. Every step it performs is one HTTP request, recorded in full and
 * rendered beside the result; the cURL equivalent is one click away. Nothing
 * here computes an outcome — a step's outcome is decided by the status code the
 * instance returned and the statuses the profile declared it expected.
 *
 * ## Sequential, and halting means halting
 *
 * `runNext` performs **one** step per call. The run holds an index; a failed
 * step sets `halted` and the index does not advance, so nothing after it is
 * attempted. That is a stronger property than a loop with a `break`: there is
 * no code path that continues past a failure, because continuing is a separate
 * call that refuses.
 *
 * The failure is named — step id, title, what was expected, what came back —
 * and everything before it stays on screen. A run that stopped is evidence of
 * where it stopped.
 *
 * ## Re-running must not create anything twice
 *
 * CloFin's `Idempotency-Key` protects payments and approvals. It does **not**
 * apply to `POST /organisations` or `POST /accounts`, which are the writes a
 * bootstrap makes — so the profile's own mechanisms are used instead, and
 * where there is none the runner detects and reports rather than skipping:
 *
 * - **A precheck.** For accounts the chart is read first (`GET /accounts`), and
 *   a code that is already there produces `already-present` — the request that
 *   would have created it is *not sent*, and the row that already exists is
 *   shown. Detecting is itself a real request with a real response, so this is
 *   not the runner asserting the state, it is the instance reporting it.
 * - **A declared conflict.** `POST /organisations` has no precheck available,
 *   because CloFin has no lookup by short name. So the request is made and the
 *   `409` is the detection: reported as `already-present`, with the profile's
 *   own note explaining that the run cannot continue from there because the
 *   API will not tell anybody the existing organisation's id.
 *
 * Neither path ever silently skips. `already-present` is a rendered outcome
 * with its raw exchange attached, not an absence.
 *
 * ## The steps that are not requests
 *
 * CloFin has no endpoint that creates an actor, grants a role, sets a limit or
 * configures an approval threshold, and that is a deliberate control decision
 * rather than a gap (see `profiles.ts`). A `manual` step therefore generates
 * the SQL, halts, and waits — and when the operator says they have run it, the
 * runner **verifies through the API**, with a real request whose response is
 * shown. It never marks such a step done because a button was pressed; if the
 * verification fails, the step fails and the run stays halted.
 */

import {
  actorId,
  mintActorId,
  rememberCredentials,
  rememberOrganisation,
  type SyntheticActor,
} from "./credentials.js";
import { curlFor, exchange, parseJson, type Exchange } from "./net.js";
import type { ManualStep, Profile, ProfileStep, RequestStep } from "./profiles.js";

export { curlFor };

/** How a step ended. Every one of these renders; none of them is silence. */
export type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "already-present"
  | "awaiting-operator"
  | "failed";

export interface StepOutcome {
  readonly stepId: string;
  readonly title: string;
  readonly status: StepStatus;
  /** One sentence saying what happened, in the runner's own words. */
  readonly summary: string;
  /** Every request this step made, in order, raw. */
  readonly exchanges: readonly Exchange[];
  /** The SQL a manual step generated, rendered with this run's values. */
  readonly statements: readonly string[];
  /** What the profile says this step's API cannot demonstrate. */
  readonly unverifiable: readonly string[];
  /** Variables this step captured from a response. */
  readonly captured: Readonly<Record<string, string>>;
}

export interface Run {
  readonly profile: Profile;
  readonly baseUrl: string;
  readonly origin: string;
  readonly index: number;
  readonly outcomes: readonly StepOutcome[];
  readonly variables: Readonly<Record<string, string>>;
  readonly halted: boolean;
  /** Set when the run stopped: which step, and why. */
  readonly haltedAt: { readonly stepId: string; readonly reason: string } | null;
  readonly finished: boolean;
  /** The actors this run minted, so the interface can show what it is holding. */
  readonly actors: readonly SyntheticActor[];
}

/**
 * Start a run: mint one synthetic actor per declared role, and nothing else.
 *
 * Minting happens here, before the first request, so the ids exist for the
 * generated SQL — and so the interface can say what it is holding from the
 * moment the run appears. They go to `credentials.ts`, which is memory for the
 * life of the page.
 */
export function startRun(profile: Profile, baseUrl: string, origin: string): Run {
  const actors: SyntheticActor[] = profile.actors.map((actor) => ({
    key: actor.key,
    displayName: actor.displayName,
    roles: actor.roles,
    actorId: mintActorId(),
  }));

  rememberCredentials({ origin, profileId: profile.id, organisationId: null, actors });

  return {
    profile,
    baseUrl,
    origin,
    index: 0,
    outcomes: profile.steps.map((step) => ({
      stepId: step.id,
      title: step.title,
      status: "pending" as StepStatus,
      summary: "not started",
      exchanges: [],
      statements: [],
      unverifiable: [],
      captured: {},
    })),
    variables: {},
    halted: false,
    haltedAt: null,
    finished: false,
    actors,
  };
}

/**
 * Substitute a run's values into a template.
 *
 * `{{organisationId}}` and `{{actor:key}}`. An unresolved placeholder is left
 * exactly as written and reported by {@link unresolved} — replacing it with an
 * empty string would produce SQL that runs and inserts the wrong thing, which
 * is worse in every way than SQL that visibly still has a hole in it.
 */
export function render(template: string, run: Run): string {
  return template.replace(/\{\{(actor:[A-Za-z0-9_-]+|[A-Za-z0-9_]+)\}\}/g, (whole, name: string) => {
    if (name.startsWith("actor:")) {
      return actorId(run.origin, name.slice("actor:".length)) ?? whole;
    }
    return run.variables[name] ?? whole;
  });
}

/** Any placeholder a render left behind. */
export function unresolved(text: string): readonly string[] {
  return [...new Set([...text.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]))];
}

function renderBody(body: unknown, run: Run): string | null {
  if (body === null || body === undefined) return null;
  return render(JSON.stringify(body, null, 2), run);
}

function headersFor(as: string | null, run: Run, withBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (withBody) headers["Content-Type"] = "application/json";
  if (as !== null) {
    const id = actorId(run.origin, as);
    // A missing id is not silently omitted: the request goes out without the
    // header and CloFin answers 401, which is the honest thing to show. The
    // profile validation makes this all but unreachable; if it happens, the
    // instance's own refusal is a better report than one invented here.
    if (id !== null) headers["X-Actor-Id"] = id;
  }
  return headers;
}

function describe(result: Exchange): string {
  if (!result.response) return result.failure ?? "no response";
  return `${result.response.status} ${result.response.statusText}`;
}

function bodyRecord(result: Exchange): Record<string, unknown> | null {
  if (!result.response) return null;
  const parsed = parseJson(result.response.body);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function advance(run: Run, outcome: StepOutcome, captured: Record<string, string>): Run {
  const outcomes = run.outcomes.map((existing, index) => (index === run.index ? outcome : existing));
  const halted = outcome.status === "failed" || outcome.status === "awaiting-operator";
  const stopsRun = outcome.status === "failed";
  const stalls = outcome.status === "awaiting-operator";
  const nextIndex = halted ? run.index : run.index + 1;

  return {
    ...run,
    outcomes,
    variables: { ...run.variables, ...captured },
    index: nextIndex,
    halted,
    haltedAt: stopsRun
      ? { stepId: outcome.stepId, reason: outcome.summary }
      : stalls
        ? { stepId: outcome.stepId, reason: outcome.summary }
        : null,
    finished: !halted && nextIndex >= run.profile.steps.length,
  };
}

async function runPrecheck(
  step: RequestStep,
  run: Run,
): Promise<{ readonly exchange: Exchange; readonly present: unknown | null } | null> {
  if (!step.precheck) return null;
  const result = await exchange({
    method: step.precheck.method,
    url: `${run.baseUrl}${render(step.precheck.path, run)}`,
    headers: headersFor(step.precheck.as, run, false),
  });

  const body = bodyRecord(result);
  const list = body?.[step.precheck.presentWhen.listAt];
  if (!Array.isArray(list)) return { exchange: result, present: null };

  const found =
    list.find((entry) => {
      const item = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
      return item?.[step.precheck!.presentWhen.field] === step.precheck!.presentWhen.equals;
    }) ?? null;

  return { exchange: result, present: found };
}

async function runRequestStep(step: RequestStep, run: Run): Promise<Run> {
  const exchanges: Exchange[] = [];

  const precheck = await runPrecheck(step, run);
  if (precheck) {
    exchanges.push(precheck.exchange);
    if (precheck.present !== null) {
      return advance(
        run,
        {
          stepId: step.id,
          title: step.title,
          status: "already-present",
          summary:
            `${step.precheck?.presentWhen.equals} is already on this instance, so the ` +
            `${step.method} ${step.path} below was not sent. The instance's own answer to the ` +
            "check is above.",
          exchanges,
          statements: [],
          unverifiable: [],
          captured: {},
        },
        {},
      );
    }
  }

  const body = renderBody(step.body, run);
  const path = render(step.path, run);
  const holes = unresolved(path + (body ?? ""));
  if (holes.length > 0) {
    return advance(
      run,
      {
        stepId: step.id,
        title: step.title,
        status: "failed",
        summary:
          `This step still needs ${holes.join(", ")}, which no earlier step produced. ` +
          "Nothing was sent.",
        exchanges,
        statements: [],
        unverifiable: [],
        captured: {},
      },
      {},
    );
  }

  const result = await exchange({
    method: step.method,
    url: `${run.baseUrl}${path}`,
    headers: headersFor(step.as, run, body !== null),
    body,
  });
  exchanges.push(result);

  const status = result.response?.status ?? 0;

  if (step.expect.includes(status)) {
    const captured: Record<string, string> = {};
    const responseBody = bodyRecord(result);
    for (const [name, field] of Object.entries(step.capture)) {
      const value = responseBody?.[field];
      if (typeof value === "string") captured[name] = value;
    }
    const missing = Object.keys(step.capture).filter((name) => !(name in captured));
    if (missing.length > 0) {
      return advance(
        run,
        {
          stepId: step.id,
          title: step.title,
          status: "failed",
          summary:
            `The instance answered ${describe(result)} as expected, but the response carries ` +
            `no ${missing.join(", ")}, which later steps need.`,
          exchanges,
          statements: [],
          unverifiable: [],
          captured,
        },
        {},
      );
    }
    if (captured["organisationId"]) rememberOrganisation(run.origin, captured["organisationId"]);
    return advance(
      run,
      {
        stepId: step.id,
        title: step.title,
        status: "done",
        summary: `The instance answered ${describe(result)}.`,
        exchanges,
        statements: [],
        unverifiable: [],
        captured,
      },
      captured,
    );
  }

  if (step.conflict?.statuses.includes(status)) {
    return advance(
      run,
      {
        stepId: step.id,
        title: step.title,
        status: step.conflict.recoverable ? "already-present" : "failed",
        summary: `${describe(result)} — ${step.conflict.meaning} ${step.conflict.note}`,
        exchanges,
        statements: [],
        unverifiable: [],
        captured: {},
      },
      {},
    );
  }

  return advance(
    run,
    {
      stepId: step.id,
      title: step.title,
      status: "failed",
      summary: result.response
        ? `Expected ${step.expect.join(" or ")}; the instance answered ${describe(result)}.`
        : `The request did not complete: ${result.failure ?? "no response"}.`,
      exchanges,
      statements: [],
      unverifiable: [],
      captured: {},
    },
    {},
  );
}

function presentManualStep(step: ManualStep, run: Run): Run {
  const statements = step.statements.map((statement) => render(statement, run));
  const holes = unresolved(statements.join("\n"));

  if (holes.length > 0) {
    return advance(
      run,
      {
        stepId: step.id,
        title: step.title,
        status: "failed",
        summary: `The generated SQL still contains ${holes.join(", ")}. It is not safe to run.`,
        exchanges: [],
        statements,
        unverifiable: step.unverifiable,
        captured: {},
      },
      {},
    );
  }

  return advance(
    run,
    {
      stepId: step.id,
      title: step.title,
      status: "awaiting-operator",
      summary:
        "CloFin has no endpoint for this, deliberately. Run the statements below against your " +
        "own instance, then verify — the cockpit will ask the API whether it landed and show " +
        "you the answer.",
      exchanges: [],
      statements,
      unverifiable: step.unverifiable,
      captured: {},
    },
    {},
  );
}

/**
 * Verify a manual step through the API.
 *
 * Called when the operator says they have run the SQL. The step advances only
 * if the instance's answer says so; a failure leaves the run exactly where it
 * was, with the failing response on screen.
 */
export async function verifyManualStep(run: Run): Promise<Run> {
  const step = run.profile.steps[run.index];
  if (!step || step.kind !== "manual") return run;

  const previous = run.outcomes[run.index];
  const result = await exchange({
    method: step.verify.method,
    url: `${run.baseUrl}${render(step.verify.path, run)}`,
    headers: headersFor(step.verify.as, run, false),
  });

  const exchanges = [...(previous?.exchanges ?? []), result];
  const status = result.response?.status ?? 0;
  const ok = step.verify.expect.includes(status);

  return advance(
    run,
    {
      stepId: step.id,
      title: step.title,
      status: ok ? "done" : "awaiting-operator",
      summary: ok
        // "Confirmed" rather than the obvious past participle of "verify":
        // this repository's `no-unqualified-audited` check reserves that word
        // for assurance claims carrying their coverage, and it reads the
        // deployed comments as well as the rendered page (011-REQ N-5). The
        // rule catching a sentence that is not about a release audit is the
        // rule working bluntly on purpose.
        ? `Confirmed by the running instance: ${describe(result)}. ${step.verify.proves}`
        : `Not confirmed. Expected ${step.verify.expect.join(" or ")}; the instance answered ` +
          `${describe(result)}. The statements have not taken effect on this instance, or an ` +
          "actor id differs from the one this page holds.",
      exchanges,
      statements: previous?.statements ?? [],
      unverifiable: step.unverifiable,
      captured: {},
    },
    {},
  );
}

/**
 * Perform the next step, and only that one.
 *
 * Refuses to do anything once the run is halted or finished, which is what
 * makes "nothing after the failure is attempted" a property of this function
 * rather than of the caller.
 */
export async function runNext(run: Run): Promise<Run> {
  if (run.halted || run.finished) return run;
  const step: ProfileStep | undefined = run.profile.steps[run.index];
  if (!step) return { ...run, finished: true };

  const running = {
    ...run,
    outcomes: run.outcomes.map((outcome, index) =>
      index === run.index ? { ...outcome, status: "running" as StepStatus } : outcome,
    ),
  };

  return step.kind === "manual"
    ? presentManualStep(step, running)
    : await runRequestStep(step, running);
}

/** Whether the operator may ask for the next step right now. */
export function canContinue(run: Run): boolean {
  return !run.halted && !run.finished;
}

/** Whether this run is stopped at a step waiting for the operator. */
export function awaitingOperator(run: Run): boolean {
  return run.outcomes[run.index]?.status === "awaiting-operator";
}

/** A one-line description of where the run stands, for the interface's heading. */
export function runSummary(run: Run): string {
  const done = run.outcomes.filter(
    (outcome) => outcome.status === "done" || outcome.status === "already-present",
  ).length;
  const total = run.profile.steps.length;
  if (run.finished) return `${total} of ${total} steps complete.`;
  if (run.haltedAt && !awaitingOperator(run)) {
    return `Halted at step ${run.index + 1} of ${total} — ${run.haltedAt.stepId}. ` +
      `${done} step(s) completed before it; nothing after it was attempted.`;
  }
  if (awaitingOperator(run)) {
    return `Waiting at step ${run.index + 1} of ${total} — ${run.haltedAt?.stepId ?? ""}.`;
  }
  return `${done} of ${total} steps complete.`;
}
