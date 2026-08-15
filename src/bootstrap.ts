/**
 * The runner: the one place a step becomes a request.
 *
 * It executes a profile's steps against a connected instance, **strictly in
 * order**, and stops at the first thing that does not go as the profile said it
 * would. Every request it makes is recorded in full and rendered beside the
 * result; the cURL equivalent is one click away. Nothing here computes an
 * outcome — a step's outcome is decided by the status code the instance
 * returned and the statuses the profile declared it expected — and nothing here
 * computes a figure: a balance on screen is projected out of a response by
 * `figures.ts`, which has no arithmetic in it.
 *
 * There is deliberately **one** runner. Phase 3 added operation flows, which
 * are longer, involve four actors and let the operator decide what a simulated
 * scheme does, and the temptation was to write a second engine for them. A
 * second engine is a second place for the halting rule, the four-state
 * vocabulary, the raw-exchange discipline and the actor invariant to be
 * *almost* implemented. So flows are the same documents read by the same reader
 * and executed by this function, and the only difference between a bootstrap
 * and a flow is one branch in {@link startRun}.
 *
 * ## Sequential, and halting means halting
 *
 * {@link runNext} performs **one** step per call. The run holds an index; a
 * failed step sets `halted` and the index does not advance, so nothing after it
 * is attempted. That is a stronger property than a loop with a `break`: there
 * is no code path that continues past a failure, because continuing is a
 * separate call that refuses.
 *
 * The failure is named — step id, title, what was expected, what came back —
 * and everything before it stays on screen. A run that stopped is evidence of
 * where it stopped.
 *
 * ## The four states, and the three ways a run waits
 *
 * The vocabulary ratified by the TASK-012 changelog is `done`,
 * `already present`, `waiting for you` and `failed`, with **`waiting for you`
 * halting exactly as failure does**. Phase 3 gave the run three reasons to
 * wait, and they are the same state because they have the same consequence —
 * nothing happens until a person acts:
 *
 * - `sql` — a step CloFin has no endpoint for. The SQL is generated; the API is
 *   asked afterwards whether it landed, and the answer is shown.
 * - `actor` — the step must be performed by somebody other than whoever is
 *   acting. The runner does **not** switch on the operator's behalf; see below.
 * - `choice` — the step is a decision that is not this page's to make, such as
 *   what a simulated scheme says next.
 *
 * ## The acting-actor invariant
 *
 * > An authenticated request carries the **acting** actor's id, and the acting
 * > actor changes only by an explicit operator action.
 *
 * A step declaring `as: "wei"` while Priya is acting does not send as Wei. It
 * waits. That is deliberate friction at the exact moment the product makes its
 * point: a maker cannot approve their own payment, so a human has to hand the
 * work over, and here that is something you do rather than something that
 * happens to you. It also makes the C-01 demonstration honest — the audience
 * sees who is asking when the 403 arrives, because the frame has been naming
 * them the whole time.
 *
 * ## Re-running must not create anything twice
 *
 * CloFin's `Idempotency-Key` protects payments and approvals; it does **not**
 * apply to `POST /organisations` or `POST /accounts`, which are the writes a
 * bootstrap makes. So the profile's own mechanisms are used, and where there is
 * none the runner detects and reports rather than skipping:
 *
 * - **A precheck.** For accounts the chart is read first (`GET /accounts`), and
 *   a code that is already there produces `already-present` — the request that
 *   would have created it is *not sent*, and the row that already exists is
 *   shown. Detecting is itself a real request with a real response, so this is
 *   not the runner asserting the state, it is the instance reporting it.
 * - **A declared conflict.** `POST /organisations` has no precheck available,
 *   because CloFin has no lookup by short name. So the request is made and the
 *   `409` is the detection, reported as `already-present` with the profile's
 *   own note.
 * - **A minted key.** A call declaring `idempotent` gets a fresh
 *   `Idempotency-Key` per attempt, rendered in the request like any other
 *   header. Fresh rather than stored, because a stored key replays the first
 *   run's answer, and a second walk of the flow is meant to be a second
 *   payment.
 *
 * Neither path ever silently skips. `already-present` is a rendered outcome
 * with its raw exchange attached, not an absence.
 */

import { acting, actingKey } from "./acting.js";
import {
  actorId,
  mintActorId,
  rememberCredentials,
  rememberOrganisation,
  credentialsFor,
  type SyntheticActor,
} from "./credentials.js";
import { readFigure, valueAt, type Figure } from "./figures.js";
import { curlFor, exchange, parseJson, type Exchange } from "./net.js";
import type {
  Call,
  ChoiceOption,
  ChoiceStep,
  ManualStep,
  Profile,
  ProfileStep,
  Readout,
  RequestStep,
} from "./profiles.js";
import * as workspace from "./workspace.js";

export { curlFor };

/** How a step ended. Every one of these renders; none of them is silence. */
export type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "already-present"
  | "awaiting-operator"
  | "failed";

/**
 * The words for those states, in one place.
 *
 * The vocabulary the TASK-012 changelog ratified is `done`, `already present`,
 * `waiting for you` and `failed`, and it is a vocabulary rather than a set of
 * labels: an interface that said "pending approval" where another said "waiting
 * for you" would be two products. It lives here, beside the type it names, so
 * that the run screens and the batch runner's summary render the same word for
 * the same state — the alternative is a second table somewhere else, which is
 * how a vocabulary becomes almost-shared.
 *
 * `pending` and `running` are not part of the four: they are what a step is
 * before it has an outcome, and they are given words here because a summary
 * that printed a raw identifier for them would be printing code at a reader.
 */
export const STATUS_WORDS: Readonly<Record<StepStatus, string>> = {
  pending: "not started",
  running: "running",
  done: "done",
  "already-present": "already present",
  "awaiting-operator": "waiting for you",
  failed: "failed",
};

/** How a status is said, wherever it is said. */
export function statusWord(status: StepStatus): string {
  return STATUS_WORDS[status];
}

/** Why a step is waiting. Three reasons, one state, one consequence. */
export type WaitingFor = "sql" | "actor" | "choice";

/** One readout: a real GET, and the figures projected out of its response. */
export interface ReadoutResult {
  readonly label: string;
  readonly why: string;
  readonly exchange: Exchange;
  readonly figures: readonly { readonly label: string; readonly figure: Figure }[];
}

export interface StepOutcome {
  readonly stepId: string;
  readonly title: string;
  readonly status: StepStatus;
  /** Which of the three waits this is, when the status is `awaiting-operator`. */
  readonly waitingFor: WaitingFor | null;
  /** One sentence saying what happened, in the runner's own words. */
  readonly summary: string;
  /** Every request this step made, in order, raw. */
  readonly exchanges: readonly Exchange[];
  /** The balances and other figures this step re-read, each from a real response. */
  readonly readouts: readonly ReadoutResult[];
  /** The SQL a manual step generated, rendered with this run's values. */
  readonly statements: readonly string[];
  /** What the profile says this step cannot demonstrate. */
  readonly unverifiable: readonly string[];
  /** Variables this step captured from a response. */
  readonly captured: Readonly<Record<string, string>>;
  /** Subjects this step touched, offered to the evidence view from here. */
  readonly subjects: readonly workspace.Subject[];
  /** The actor whose id every request above carried, as text for the step's stamp. */
  readonly actorStamp: string | null;
  /** Which choice option was taken, when this was a choice. */
  readonly chosen: { readonly id: string; readonly label: string } | null;
}

export interface Run {
  readonly profile: Profile;
  readonly baseUrl: string;
  readonly origin: string;
  readonly index: number;
  readonly outcomes: readonly StepOutcome[];
  readonly variables: Readonly<Record<string, string>>;
  /** Whole response bodies an earlier step kept, for a later `bodyFrom`. */
  readonly documents: Readonly<Record<string, string>>;
  readonly halted: boolean;
  /** Set when the run stopped: which step, and why. */
  readonly haltedAt: { readonly stepId: string; readonly reason: string } | null;
  readonly finished: boolean;
  /** The actors this run may act as. Minted by a bootstrap, inherited by a flow. */
  readonly actors: readonly SyntheticActor[];
  /** What this run inherited from earlier runs on the same instance. */
  readonly inherited: readonly workspace.Inherited[];
}

/** A flow cannot start without the actors and the values an earlier run produced. */
export type StartResult =
  | { readonly kind: "run"; readonly run: Run }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Start a run.
 *
 * A **bootstrap** mints one synthetic actor per declared role, before the first
 * request, so the ids exist for the generated SQL and the interface can say
 * what it is holding from the moment the run appears. They go to
 * `credentials.ts`, which is memory for the life of the page.
 *
 * A **flow** mints nothing. It acts as the actors that instance's bootstrap
 * already created, because minting a second set would produce ids no row in the
 * instance's `actor` table matches — every request would be refused, and the
 * screen would be full of 401s that looked like a broken product rather than a
 * missing step. So a flow whose instance holds no credentials is refused before
 * it starts, with the reason.
 */
export function startRun(profile: Profile, baseUrl: string, origin: string): StartResult {
  let actors: readonly SyntheticActor[];

  if (profile.role === "bootstrap") {
    actors = profile.actors.map((actor) => ({
      key: actor.key,
      displayName: actor.displayName,
      roles: actor.roles,
      actorId: mintActorId(),
    }));
    rememberCredentials({ origin, profileId: profile.id, organisationId: null, actors });
  } else {
    const held = credentialsFor(origin);
    if (!held || held.actors.length === 0) {
      return {
        kind: "refused",
        reason:
          "No synthetic actors are held for this instance in this tab. A flow acts as the " +
          "actors a bootstrap run created; run a seed profile first, or — if you bootstrapped " +
          "it in an earlier tab — run one again, because the ids are held in memory for the " +
          "life of a page and are deliberately not stored anywhere.",
      };
    }
    const missing = profile.actors
      .map((actor) => actor.key)
      .filter((key) => !held.actors.some((candidate) => candidate.key === key));
    if (missing.length > 0) {
      return {
        kind: "refused",
        reason:
          `This flow acts as ${missing.join(", ")}, which the profile that bootstrapped this ` +
          `instance (${held.profileId}) did not create. Bootstrap it with a profile that ` +
          "declares those actors, or choose a flow that matches the one you used.",
      };
    }
    actors = held.actors;
  }

  const inheritedValues = workspace.variables(origin);
  const missingRequired = profile.requires.filter((name) => !(name in inheritedValues));
  if (missingRequired.length > 0) {
    return {
      kind: "refused",
      reason:
        `This flow needs ${missingRequired.join(", ")}, which no run on this instance has ` +
        "produced in this tab. The flows are meant to be run in the order they are listed: " +
        "each one captures what the next one needs, and nothing here invents an id.",
    };
  }

  return {
    kind: "run",
    run: {
      profile,
      baseUrl,
      origin,
      index: 0,
      outcomes: profile.steps.map((step) => ({
        stepId: step.id,
        title: step.title,
        status: "pending" as StepStatus,
        waitingFor: null,
        summary: "not started",
        exchanges: [],
        readouts: [],
        statements: [],
        unverifiable: [],
        captured: {},
        subjects: [],
        actorStamp: null,
        chosen: null,
      })),
      variables: { ...inheritedValues },
      documents: {},
      halted: false,
      haltedAt: null,
      finished: false,
      actors,
      inherited: workspace.inherited(origin),
    },
  };
}

/**
 * Substitute a run's values into a template.
 *
 * `{{organisationId}}` and `{{actor:key}}`. An unresolved placeholder is left
 * exactly as written and reported by {@link unresolved} — replacing it with an
 * empty string would produce a request or SQL that runs and does the wrong
 * thing, which is worse in every way than one that visibly still has a hole in
 * it.
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

function emptyOutcome(step: ProfileStep): StepOutcome {
  return {
    stepId: step.id,
    title: step.title,
    status: "pending",
    waitingFor: null,
    summary: "",
    exchanges: [],
    readouts: [],
    statements: [],
    unverifiable: [],
    captured: {},
    subjects: [],
    actorStamp: null,
    chosen: null,
  };
}

/**
 * How a step is stamped with who made it.
 *
 * Name, roles and the id, separated rather than nested: a profile's display
 * name often already carries a parenthetical ("Priya (maker)"), and appending
 * "(operator)" to that produced a stamp with two brackets in a row on the most
 * screenshotted line in the product. The id is included here — unlike in the
 * frame — because a step is the thing somebody quotes on its own, and the
 * `X-Actor-Id` header in the raw request directly below is what it should be
 * checked against.
 */
function stamp(run: Run): string | null {
  const actor = acting(run.origin);
  return actor ? `${actor.displayName} · ${actor.roles.join(", ")} · ${actor.actorId}` : null;
}

function headersFor(run: Run, options: { withBody: boolean; idempotent: boolean }): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.withBody) headers["Content-Type"] = "application/json";
  const actor = acting(run.origin);
  // The acting actor, and never a step's declared one: the step's `as` is a
  // requirement the runner checks *before* getting here, not a second source of
  // identity. One source means the frame cannot be telling the truth about who
  // is acting while a request says somebody else.
  if (actor) headers["X-Actor-Id"] = actor.actorId;
  if (options.idempotent) headers["Idempotency-Key"] = mintActorId();
  return headers;
}

function unauthenticatedHeaders(withBody: boolean, idempotent: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (withBody) headers["Content-Type"] = "application/json";
  if (idempotent) headers["Idempotency-Key"] = mintActorId();
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

function advance(
  run: Run,
  outcome: StepOutcome,
  captured: Record<string, string>,
  documents: Record<string, string> = {},
): Run {
  const outcomes = run.outcomes.map((existing, index) => (index === run.index ? outcome : existing));
  const halted = outcome.status === "failed" || outcome.status === "awaiting-operator";
  const nextIndex = halted ? run.index : run.index + 1;

  return {
    ...run,
    outcomes,
    variables: { ...run.variables, ...captured },
    documents: { ...run.documents, ...documents },
    index: nextIndex,
    halted,
    haltedAt: halted ? { stepId: outcome.stepId, reason: outcome.summary } : null,
    finished: !halted && nextIndex >= run.profile.steps.length,
  };
}

/**
 * Check that the step may be performed by whoever is acting.
 *
 * Returns the outcome that stops the run, or null when the step may proceed.
 */
function actorGate(step: RequestStep | ChoiceStep, run: Run): StepOutcome | null {
  if (step.as === null) return null;
  const current = actingKey(run.origin);
  if (current === step.as) return null;

  const required = run.actors.find((actor) => actor.key === step.as);
  const acting_ = acting(run.origin);
  const requiredName = required ? `${required.displayName} (${required.roles.join(", ")})` : step.as;

  return {
    ...emptyOutcome(step),
    status: "awaiting-operator",
    waitingFor: "actor",
    summary:
      `This step is ${requiredName}'s to perform. ` +
      (acting_
        ? `You are acting as ${acting_.displayName}. `
        : "No actor is selected. ") +
      "Switch actors above, then run this step. Nothing was sent — the cockpit does not " +
      "change who you are on your behalf.",
    unverifiable: step.unverifiable,
  };
}

/** Build the body a call sends: a literal, or a document an earlier step kept. */
function callBody(call: Call, run: Run): { readonly text: string | null; readonly problem: string | null } {
  if (call.bodyFrom !== null) {
    const document_ = run.documents[call.bodyFrom];
    if (document_ === undefined) {
      return {
        text: null,
        problem: `no earlier step kept a document called "${call.bodyFrom}"`,
      };
    }
    const parsed = parseJson(document_);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { text: null, problem: `the document "${call.bodyFrom}" is not a JSON object` };
    }
    // Members are added; nothing is removed and nothing is altered. What goes
    // out is the document the instance sent, plus the organisation id this run
    // already holds — which is what UAT-007 does with `jq`, and the rendered
    // request shows the result either way.
    const merged: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    for (const [member, template] of Object.entries(call.bodyMerge)) {
      merged[member] = render(template, run);
    }
    return { text: JSON.stringify(merged, null, 2), problem: null };
  }

  if (call.body === null || call.body === undefined) return { text: null, problem: null };
  return { text: render(JSON.stringify(call.body, null, 2), run), problem: null };
}

async function performReadouts(
  readouts: readonly Readout[],
  run: Run,
): Promise<readonly ReadoutResult[]> {
  const results: ReadoutResult[] = [];
  for (const readout of readouts) {
    const path = render(readout.path, run);
    const result = await exchange({
      method: readout.method,
      url: `${run.baseUrl}${path}`,
      headers: headersFor(run, { withBody: false, idempotent: false }),
    });
    results.push({
      label: readout.label,
      why: readout.why,
      exchange: result,
      figures: readout.figures.map((figure) => ({
        label: figure.label,
        // The response body, and nothing else. `readFigure` has no arithmetic
        // in it and no access to anything but this string.
        figure: readFigure(result.response?.body ?? null, figure.path),
      })),
    });
  }
  return results;
}

/** Pull the declared captures out of a response, and record the subjects they name. */
function harvest(
  call: Call,
  result: Exchange,
  run: Run,
  stepId: string,
): {
  readonly captured: Record<string, string>;
  readonly missing: readonly string[];
  readonly documents: Record<string, string>;
  readonly subjects: readonly workspace.Subject[];
} {
  const captured: Record<string, string> = {};
  const body = result.response?.body ?? null;

  for (const [name, path] of Object.entries(call.capture)) {
    const value = valueAt(body, path);
    if (typeof value === "string") captured[name] = value;
  }
  const missing = Object.keys(call.capture).filter((name) => !(name in captured));

  const documents: Record<string, string> = {};
  if (call.captureDocument !== null && body !== null) documents[call.captureDocument] = body;

  const merged = { ...run.variables, ...captured };
  const subjects: workspace.Subject[] = [];
  for (const declaration of call.subjects) {
    const id = merged[declaration.variable];
    if (typeof id === "string" && id !== "") {
      subjects.push({
        id,
        type: declaration.type,
        label: declaration.label,
        fromStepId: stepId,
        fromProfileId: run.profile.id,
      });
    }
  }

  return { captured, missing, documents, subjects };
}

function commit(
  run: Run,
  stepId: string,
  captured: Record<string, string>,
  subjects: readonly workspace.Subject[],
): void {
  const entries = Object.entries(captured).map(([name, value]) => ({
    name,
    value,
    fromStepId: stepId,
    fromProfileId: run.profile.id,
  }));
  // Recorded as they are captured rather than when the run finishes: a run that
  // halted still learned what it learned, and the next flow should be able to
  // use it.
  if (entries.length > 0) workspace.remember(run.origin, entries);
  for (const subject of subjects) workspace.rememberSubject(run.origin, subject);
  if (captured["organisationId"]) rememberOrganisation(run.origin, captured["organisationId"]);
}

async function runPrecheck(
  step: RequestStep,
  run: Run,
): Promise<{ readonly exchange: Exchange; readonly present: unknown | null } | null> {
  if (!step.precheck) return null;
  const result = await exchange({
    method: step.precheck.method,
    url: `${run.baseUrl}${render(step.precheck.path, run)}`,
    headers:
      step.precheck.as === null
        ? unauthenticatedHeaders(false, false)
        : headersFor(run, { withBody: false, idempotent: false }),
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

/**
 * Perform one call and turn its answer into an outcome.
 *
 * Shared by request steps and by chosen options, so that an operator's decision
 * is executed by exactly the same code as a scripted step. A choice that had
 * its own execution path would be a place for the expectation rules to drift.
 */
async function performCall(
  call: Call,
  step: RequestStep | ChoiceStep,
  run: Run,
  before: readonly Exchange[],
  extra: { readonly chosen: StepOutcome["chosen"] },
): Promise<Run> {
  const built = callBody(call, run);
  if (built.problem !== null) {
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "failed",
        summary: `This step could not build its request: ${built.problem}. Nothing was sent.`,
        exchanges: before,
        unverifiable: step.unverifiable,
        actorStamp: stamp(run),
        chosen: extra.chosen,
      },
      {},
    );
  }

  const path = render(call.path, run);
  const holes = unresolved(path + (built.text ?? ""));
  if (holes.length > 0) {
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "failed",
        summary:
          `This step still needs ${holes.join(", ")}, which no earlier step produced. ` +
          "Nothing was sent.",
        exchanges: before,
        unverifiable: step.unverifiable,
        actorStamp: stamp(run),
        chosen: extra.chosen,
      },
      {},
    );
  }

  const result = await exchange({
    method: call.method,
    url: `${run.baseUrl}${path}`,
    headers:
      step.as === null
        ? unauthenticatedHeaders(built.text !== null, call.idempotent)
        : headersFor(run, { withBody: built.text !== null, idempotent: call.idempotent }),
    body: built.text,
  });
  const exchanges = [...before, result];
  const status = result.response?.status ?? 0;
  const actorStamp = step.as === null ? null : stamp(run);

  const expected = call.expect.includes(status);
  const conflicted = !expected && (call.conflict?.statuses.includes(status) ?? false);

  if (!expected && !conflicted) {
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "failed",
        summary: result.response
          ? `Expected ${call.expect.join(" or ")}; the instance answered ${describe(result)}.`
          : `The request did not complete: ${result.failure ?? "no response"}.`,
        exchanges,
        unverifiable: step.unverifiable,
        actorStamp,
        chosen: extra.chosen,
      },
      {},
    );
  }

  if (conflicted && !call.conflict!.recoverable) {
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "failed",
        summary: `${describe(result)} — ${call.conflict!.meaning} ${call.conflict!.note}`,
        exchanges,
        unverifiable: step.unverifiable,
        actorStamp,
        chosen: extra.chosen,
      },
      {},
    );
  }

  const harvested = harvest(call, result, run, step.id);
  if (expected && harvested.missing.length > 0) {
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "failed",
        summary:
          `The instance answered ${describe(result)} as expected, but the response carries ` +
          `no ${harvested.missing.join(", ")}, which later steps need.`,
        exchanges,
        unverifiable: step.unverifiable,
        captured: harvested.captured,
        actorStamp,
        chosen: extra.chosen,
      },
      {},
    );
  }

  commit(run, step.id, harvested.captured, harvested.subjects);

  // The readouts run against the run as it now is, so a path naming something
  // this step captured resolves. They are real requests and are rendered as
  // such; the figures they carry are projections of their responses.
  const afterCapture: Run = { ...run, variables: { ...run.variables, ...harvested.captured } };
  const readouts = await performReadouts(step.readouts, afterCapture);

  return advance(
    run,
    {
      ...emptyOutcome(step),
      status: conflicted ? "already-present" : "done",
      summary: conflicted
        ? `${describe(result)} — ${call.conflict!.meaning} ${call.conflict!.note}`
        : `The instance answered ${describe(result)}.`,
      exchanges,
      readouts,
      unverifiable: step.unverifiable,
      captured: harvested.captured,
      subjects: harvested.subjects,
      actorStamp,
      chosen: extra.chosen,
    },
    harvested.captured,
    harvested.documents,
  );
}

async function runRequestStep(step: RequestStep, run: Run): Promise<Run> {
  const gate = actorGate(step, run);
  if (gate) return advance(run, gate, {});

  const exchanges: Exchange[] = [];
  const precheck = await runPrecheck(step, run);
  if (precheck) {
    exchanges.push(precheck.exchange);
    if (precheck.present !== null) {
      // The row the check found carries the id the creation would have
      // captured, so the step's captures are taken from **it** rather than
      // being left empty. Without this, a second run against an instance that
      // already has the chart would report every account "already present" and
      // then leave the later flows with no account id — which would look like
      // the flows being broken rather than like the run having nothing to do.
      // The value still comes from a response the instance sent; it is the
      // answer to the check, which is on screen directly above.
      const foundText = JSON.stringify(precheck.present);
      const captured: Record<string, string> = {};
      for (const [name, path] of Object.entries(step.capture)) {
        const value = valueAt(foundText, path);
        if (typeof value === "string") captured[name] = value;
      }
      const merged: Run = { ...run, variables: { ...run.variables, ...captured } };
      const subjects: workspace.Subject[] = [];
      for (const declaration of step.subjects) {
        const id = merged.variables[declaration.variable];
        if (typeof id === "string" && id !== "") {
          subjects.push({
            id,
            type: declaration.type,
            label: declaration.label,
            fromStepId: step.id,
            fromProfileId: run.profile.id,
          });
        }
      }
      commit(run, step.id, captured, subjects);

      return advance(
        run,
        {
          ...emptyOutcome(step),
          status: "already-present",
          summary:
            `${step.precheck?.presentWhen.equals} is already on this instance, so the ` +
            `${step.method} ${step.path} below was not sent. The instance's own answer to the ` +
            "check is above, and what this step needed was read out of it.",
          exchanges,
          unverifiable: step.unverifiable,
          captured,
          subjects,
          actorStamp: stamp(run),
        },
        captured,
      );
    }
  }

  return performCall(step, step, run, exchanges, { chosen: null });
}

/**
 * Present a choice, and perform nothing.
 *
 * The run stops here until the operator picks an option. There is no default,
 * no highlighted recommendation and no timer — a simulated scheme's behaviour
 * is a fact about the world that this page must not invent, and an interface
 * that nudged towards one answer would be scripting the thing it claims to be
 * letting you drive.
 */
function presentChoiceStep(step: ChoiceStep, run: Run): Run {
  const gate = actorGate(step, run);
  if (gate) return advance(run, gate, {});

  return advance(
    run,
    {
      ...emptyOutcome(step),
      status: "awaiting-operator",
      waitingFor: "choice",
      summary:
        `${step.options.length} things could happen next, and which one does is not this page's ` +
        "to decide. Choose one; each is one request, sent when you click it.",
      unverifiable: step.unverifiable,
      actorStamp: stamp(run),
    },
    {},
  );
}

/**
 * Take one of a choice step's options.
 *
 * One click, one option, one request. There is deliberately no function that
 * takes several.
 */
export async function chooseOption(run: Run, optionId: string): Promise<Run> {
  const step = run.profile.steps[run.index];
  if (!step || step.kind !== "choice") return run;
  if (run.outcomes[run.index]?.waitingFor !== "choice") return run;

  const option: ChoiceOption | undefined = step.options.find(
    (candidate) => candidate.id === optionId,
  );
  if (!option) return run;

  const chosen = { id: option.id, label: option.label };

  if (option.call === null) {
    // Silence. Nothing is sent, and the step says so in the words the profile
    // wrote — never a manufactured outcome. The readouts still run, so the
    // operator can see the balances did not move, because the ledger did not
    // move.
    const readouts = await performReadouts(step.readouts, run);
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "done",
        summary: `You chose: ${option.label}. No request was sent. ${option.nothingNote ?? ""}`,
        readouts,
        unverifiable: step.unverifiable,
        actorStamp: stamp(run),
        chosen,
      },
      {},
    );
  }

  return performCall(option.call, step, run, [], { chosen });
}

function presentManualStep(step: ManualStep, run: Run): Run {
  const statements = step.statements.map((statement) => render(statement, run));
  const holes = unresolved(statements.join("\n"));

  if (holes.length > 0) {
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "failed",
        summary: `The generated SQL still contains ${holes.join(", ")}. It is not safe to run.`,
        statements,
        unverifiable: step.unverifiable,
      },
      {},
    );
  }

  return advance(
    run,
    {
      ...emptyOutcome(step),
      status: "awaiting-operator",
      waitingFor: "sql",
      summary:
        "CloFin has no endpoint for this, deliberately. Run the statements below against your " +
        "own instance, then verify — the cockpit will ask the API whether it landed and show " +
        "you the answer.",
      statements,
      unverifiable: step.unverifiable,
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

  // The verification is an authenticated request like any other, so it obeys
  // the same invariant: it goes out as the acting actor, and if that is not the
  // actor the profile named, nothing is sent. Asking the instance as the wrong
  // person would produce a 403 that looked like the SQL having failed.
  if (step.verify.as !== null && actingKey(run.origin) !== step.verify.as) {
    const required = run.actors.find((actor) => actor.key === step.verify.as);
    return advance(
      run,
      {
        ...emptyOutcome(step),
        status: "awaiting-operator",
        waitingFor: "sql",
        summary:
          `This step is confirmed by asking the instance as ` +
          `${required ? required.displayName : step.verify.as}, and you are not acting as them. ` +
          "Switch actors above, then confirm again. Nothing was sent.",
        exchanges: previous?.exchanges ?? [],
        statements: previous?.statements ?? [],
        unverifiable: step.unverifiable,
      },
      {},
    );
  }

  const result = await exchange({
    method: step.verify.method,
    url: `${run.baseUrl}${render(step.verify.path, run)}`,
    headers:
      step.verify.as === null
        ? unauthenticatedHeaders(false, false)
        : headersFor(run, { withBody: false, idempotent: false }),
  });

  const exchanges = [...(previous?.exchanges ?? []), result];
  const status = result.response?.status ?? 0;
  const ok = step.verify.expect.includes(status);

  return advance(
    run,
    {
      ...emptyOutcome(step),
      status: ok ? "done" : "awaiting-operator",
      waitingFor: ok ? null : "sql",
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
      actorStamp: step.verify.as === null ? null : stamp(run),
    },
    {},
  );
}

/**
 * Perform the next step, and only that one.
 *
 * Refuses to do anything once the run is halted or finished — which is what
 * makes "nothing after the failure is attempted" a property of this function
 * rather than of the caller. The single exception is a step waiting for an
 * actor: the condition it is waiting on is one the operator can satisfy without
 * touching the run, so asking again is meaningful, and the step is re-attempted
 * in place rather than skipped.
 */
export async function runNext(run: Run): Promise<Run> {
  if (run.finished) return run;
  const waiting = run.outcomes[run.index]?.waitingFor ?? null;
  if (run.halted && waiting !== "actor") return run;

  const step: ProfileStep | undefined = run.profile.steps[run.index];
  if (!step) return { ...run, finished: true };

  const running: Run = {
    ...run,
    halted: false,
    haltedAt: null,
    outcomes: run.outcomes.map((outcome, index) =>
      index === run.index ? { ...outcome, status: "running" as StepStatus } : outcome,
    ),
  };

  if (step.kind === "manual") return presentManualStep(step, running);
  if (step.kind === "choice") return presentChoiceStep(step, running);
  return await runRequestStep(step, running);
}

/** Whether the operator may ask for the next step right now. */
export function canContinue(run: Run): boolean {
  if (run.finished) return false;
  if (!run.halted) return true;
  // A step waiting for an actor is retried by the same control, because the
  // operator satisfies it by switching rather than by doing anything to the run.
  return (run.outcomes[run.index]?.waitingFor ?? null) === "actor";
}

/** Whether this run is stopped at a step waiting for the operator, and for what. */
export function awaitingOperator(run: Run): WaitingFor | null {
  const outcome = run.outcomes[run.index];
  return outcome?.status === "awaiting-operator" ? outcome.waitingFor : null;
}

/** The step the run is stopped at, if it is stopped at one. */
export function currentStep(run: Run): ProfileStep | null {
  return run.profile.steps[run.index] ?? null;
}

/** A one-line description of where the run stands, for the interface's heading. */
export function runSummary(run: Run): string {
  const done = run.outcomes.filter(
    (outcome) => outcome.status === "done" || outcome.status === "already-present",
  ).length;
  const total = run.profile.steps.length;
  const waiting = awaitingOperator(run);
  if (run.finished) return `${total} of ${total} steps complete.`;
  if (waiting) {
    return `Waiting at step ${run.index + 1} of ${total} — ${run.profile.steps[run.index]?.id ?? ""}.`;
  }
  if (run.haltedAt) {
    return `Halted at step ${run.index + 1} of ${total} — ${run.haltedAt.stepId}. ` +
      `${done} step(s) completed before it; nothing after it was attempted.`;
  }
  return `${done} of ${total} steps complete.`;
}
