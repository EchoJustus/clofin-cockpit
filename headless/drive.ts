/**
 * The headless driver: the operator's hands, and nothing else.
 *
 * ## What this is not
 *
 * It is **not a second runner**. It contains no request, no expectation rule,
 * no status vocabulary and no figure. Every step it advances is advanced by
 * `bootstrap.ts` — `startRun`, `runNext`, `chooseOption`, `verifyManualStep` —
 * against profiles read by `profiles.ts`, with figures projected by
 * `figures.ts` and identity held by `acting.ts`. ADR-0003 spent a page
 * explaining why there is one runner; a batch entry point that reimplemented
 * the halting rule "just for CI" would be that second engine wearing a
 * different hat, and CI is precisely where nobody is watching the screen.
 *
 * What this module supplies is the part a browser gets from a person: it
 * switches actors when a step belongs to somebody else, runs a manual step's
 * SQL, and answers a choice from the playbook. Three operator actions, each one
 * explicit, each one recorded.
 *
 * ## The four states are the runner's, and they still mean what they meant
 *
 * `done`, `already present`, `waiting for you` and `failed` come out of the
 * runner unchanged. The driver's whole logic is what it does with
 * `waiting for you`, which has the same three reasons here as on screen:
 *
 * | Waiting for | What a browser does | What this does |
 * |---|---|---|
 * | `actor` | the operator switches, then asks again | {@link handOver} switches through `acting.ts`, then asks again |
 * | `sql` | the operator runs the statements, then confirms | the workflow runs them, then confirms through the same API request |
 * | `choice` | the operator clicks an option | the playbook's declared answer is taken — or, if it has none, **the run stops here** |
 *
 * That last cell is the one that matters. A choice the playbook does not answer
 * is not defaulted, guessed or skipped: the run stays in `waiting for you` and
 * the driver reports a failure naming the step. A batch that invented a scheme
 * response would be manufacturing the fact the whole product is about.
 *
 * ## Halting still means halting
 *
 * The driver never continues past a failed step, and it cannot: `runNext`
 * refuses to do anything once a run is halted for any reason but an actor wait,
 * so "nothing after the failure was attempted" remains a property of the runner
 * rather than a discipline of this loop. The loop additionally carries a step
 * budget, so a state neither it nor the runner expected ends as a named failure
 * rather than as a job that runs until the runner kills it.
 */

import { actAs, acting, actingKey } from "../src/acting.js";
import {
  awaitingOperator,
  chooseOption,
  currentStep,
  runNext,
  startRun,
  statusWord,
  verifyManualStep,
  type Run,
  type StepOutcome,
} from "../src/bootstrap.js";
import type { Profile } from "../src/profiles.js";
import { answerFor, checkAgainstProfile, type Playbook, type PlaybookAnswer } from "./playbook.js";
import { applied, describeExecution, type SqlExecution, type SqlRunner } from "./sql.js";

/** One explicit change of who is acting, and what required it. */
export interface ActorHandover {
  readonly from: string | null;
  readonly to: string;
  readonly why: string;
}

/** What the driver did at one step, beside what the runner did. */
export interface StepAnnotation {
  readonly handovers: readonly ActorHandover[];
  /** The statements this step's SQL was run with, when it was a manual step. */
  readonly sql: SqlExecution | null;
  /** The playbook answer taken, when it was a choice. */
  readonly declared: PlaybookAnswer | null;
}

export type FailureKind =
  | "refused-to-start"
  | "playbook-mismatch"
  | "step-failed"
  | "unanswered-choice"
  | "sql-not-applied"
  | "not-confirmed"
  | "no-actor"
  | "no-progress";

export interface DriveFailure {
  readonly kind: FailureKind;
  /** The step the run stopped at, when it reached one. */
  readonly stepId: string | null;
  readonly reason: string;
}

export interface DrivenProfile {
  readonly profile: Profile;
  /** The document as it is in the repository, for the summary to show. */
  readonly raw: string;
  /** The run, in whatever state it ended — finished, halted or waiting. */
  readonly run: Run | null;
  readonly annotations: ReadonlyMap<string, StepAnnotation>;
  readonly handovers: readonly ActorHandover[];
  readonly failure: DriveFailure | null;
}

export interface DriveOptions {
  readonly profile: Profile;
  readonly raw: string;
  readonly baseUrl: string;
  readonly origin: string;
  /** The playbook for this document, or `null` when none was given. */
  readonly playbook: Playbook | null;
  readonly runSql: SqlRunner;
  readonly log: (line: string) => void;
}

function blank(): StepAnnotation {
  return { handovers: [], sql: null, declared: null };
}

function annotate(
  annotations: Map<string, StepAnnotation>,
  stepId: string,
  patch: Partial<StepAnnotation>,
): void {
  const existing = annotations.get(stepId) ?? blank();
  annotations.set(stepId, { ...existing, ...patch });
}

/**
 * The outcome the runner is currently stopped on.
 *
 * Only meaningful while the run is halted or waiting: a step that succeeded
 * advances the index, so this would then be the *next* step's untouched
 * `pending` outcome. {@link outcomeOf} is the one to use afterwards.
 */
function outcomeAt(run: Run): StepOutcome | undefined {
  return run.outcomes[run.index];
}

/** The outcome of a named step, wherever the index has since moved to. */
function outcomeOf(run: Run, stepId: string): StepOutcome | undefined {
  return run.outcomes.find((outcome) => outcome.stepId === stepId);
}

/**
 * Switch the acting actor, explicitly.
 *
 * The same call the browser's actor switcher makes, and it can refuse for the
 * same reason: a key no run on this instance minted is not somebody this
 * process can become. Refusing is reported as a failure rather than worked
 * around, because the alternative is a request going out as whoever happened to
 * be acting — which is the one thing `acting.ts`'s invariant forbids.
 */
function handOver(origin: string, to: string, why: string): ActorHandover | null {
  const from = actingKey(origin);
  if (from === to) return null;
  if (!actAs(origin, to)) return null;
  return { from, to, why };
}

/** How the summary and the log name whoever is acting right now. */
export function actingStamp(origin: string): string {
  const actor = acting(origin);
  return actor ? `${actor.displayName} · ${actor.roles.join(", ")}` : "nobody";
}

/**
 * Drive one profile to the end, or to the first thing that stops it.
 *
 * Returns the run in whatever state it reached. A failure is a sentence naming
 * the step; the run beside it is the evidence for where it stopped, and every
 * step before it stays exactly as the runner left it.
 */
export async function driveProfile(options: DriveOptions): Promise<DrivenProfile> {
  const { profile, raw, baseUrl, origin, playbook, runSql, log } = options;
  const annotations = new Map<string, StepAnnotation>();
  const handovers: ActorHandover[] = [];

  const fail = (kind: FailureKind, stepId: string | null, reason: string, run: Run | null) => {
    log(`  FAILED ${stepId ?? "(before the first step)"}: ${reason}`);
    return { profile, raw, run, annotations, handovers, failure: { kind, stepId, reason } };
  };

  // Checked before the first request, because an answer naming an option that
  // does not exist is a document defect, and finding it four writes into
  // somebody's instance is worse than finding it here.
  if (playbook) {
    const problems = checkAgainstProfile(playbook, profile);
    if (problems.length > 0) {
      return fail(
        "playbook-mismatch",
        null,
        `the playbook ${playbook.id} does not match ${profile.id}: ${problems.join(" ")}`,
        null,
      );
    }
  }

  const started = startRun(profile, baseUrl, origin);
  if (started.kind === "refused") {
    return fail("refused-to-start", null, started.reason, null);
  }

  let run = started.run;
  log(`${profile.id} — ${profile.steps.length} step(s), role ${profile.role}`);
  for (const inherited of run.inherited) {
    log(`  inherited ${inherited.name} from ${inherited.fromProfileId}/${inherited.fromStepId}`);
  }

  // Six passes per step is generous: a step needs at most a hand-over, an
  // attempt, and a confirmation. The budget exists so an unforeseen state ends
  // as a named failure rather than as a job that runs until it is killed.
  const budget = profile.steps.length * 6 + 24;
  let passes = 0;

  while (!run.finished) {
    passes += 1;
    if (passes > budget) {
      return fail(
        "no-progress",
        currentStep(run)?.id ?? null,
        `the driver took ${passes} passes over ${profile.steps.length} step(s) without ` +
          "finishing, so it stopped rather than looping. Nothing after this step was attempted.",
        run,
      );
    }

    const step = currentStep(run);
    if (!step) break;

    // The runner performs the step. Everything below is about what the operator
    // does when it stops and asks for something.
    run = await runNext(run);
    const outcome = outcomeAt(run);
    const waiting = awaitingOperator(run);

    if (waiting === null) {
      if (run.halted) {
        return fail("step-failed", step.id, outcome?.summary ?? "the step failed", run);
      }
      // The step succeeded, so the index has moved on: its outcome is found by
      // name rather than at the index, which now points at the next step.
      const done = outcomeOf(run, step.id);
      log(`  ${done ? statusWord(done.status) : "?"} ${step.id} — ${done?.summary ?? ""}`);
      continue;
    }

    if (waiting === "actor") {
      // `manual` steps do not gate here — their gate is on the confirmation —
      // so this is a request or a choice, and both carry `as`.
      const required = step.kind === "manual" ? step.verify.as : step.as;
      if (required === null) {
        return fail(
          "no-actor",
          step.id,
          "the runner is waiting for an actor and the step names none, which the driver " +
            "cannot resolve without guessing who should act.",
          run,
        );
      }
      const handover = handOver(origin, required, `${step.id} is ${required}'s to perform`);
      if (!handover) {
        return fail(
          "no-actor",
          step.id,
          `this step is ${required}'s to perform and this run holds no actor by that name, so ` +
            "nothing was sent. The runner does not send as somebody else.",
          run,
        );
      }
      handovers.push(handover);
      annotate(annotations, step.id, {
        handovers: [...(annotations.get(step.id)?.handovers ?? []), handover],
      });
      log(`  hand over to ${required} for ${step.id} — acting as ${actingStamp(origin)}`);
      continue;
    }

    if (waiting === "sql") {
      // The statements the runner generated, rendered with this run's values.
      // The driver runs *these* — it does not compose SQL of its own.
      const statements = outcome?.statements ?? [];
      const execution = runSql(statements);
      annotate(annotations, step.id, { sql: execution });
      log(`  ran ${statements.length} statement(s) for ${step.id} — ${describeExecution(execution)}`);

      if (!applied(execution)) {
        return fail(
          "sql-not-applied",
          step.id,
          `the statements this step generated were not applied: ${describeExecution(execution)}. ` +
            `${execution.stderr.trim() || "The client said nothing on standard error."}`,
          run,
        );
      }

      if (step.kind === "manual" && step.verify.as !== null) {
        const handover = handOver(
          origin,
          step.verify.as,
          `${step.id} is confirmed by asking the instance as ${step.verify.as}`,
        );
        if (handover) {
          handovers.push(handover);
          annotate(annotations, step.id, {
            handovers: [...(annotations.get(step.id)?.handovers ?? []), handover],
          });
          log(`  hand over to ${step.verify.as} to confirm ${step.id}`);
        }
      }

      run = await verifyManualStep(run);
      if (awaitingOperator(run) !== null || run.halted) {
        return fail(
          "not-confirmed",
          step.id,
          outcomeAt(run)?.summary ??
            "the instance did not confirm the statements this step generated.",
          run,
        );
      }
      const confirmed = outcomeOf(run, step.id);
      log(`  ${confirmed ? statusWord(confirmed.status) : "?"} ${step.id} — ${confirmed?.summary ?? ""}`);
      continue;
    }

    // waiting === "choice"
    const declared = answerFor(playbook, step.id);
    if (!declared) {
      const offered = step.kind === "choice" ? step.options.map((option) => option.id) : [];
      return fail(
        "unanswered-choice",
        step.id,
        `the run is waiting for you at "${step.id}" and ${
          playbook
            ? `the playbook ${playbook.id} does not answer it`
            : "no playbook was given for this document"
        }. It offers ${offered.join(", ") || "no options"}. Nothing was sent: which of these a ` +
          "scheme does is a fact about the world, and a batch run that picked one would be " +
          "manufacturing the thing this flow exists to show.",
        run,
      );
    }

    annotate(annotations, step.id, { declared });
    log(`  declared ${declared.option} for ${step.id} — taking it`);
    run = await chooseOption(run, declared.option);

    if (run.halted && awaitingOperator(run) === null) {
      return fail(
        "step-failed",
        step.id,
        outcomeAt(run)?.summary ?? "the chosen option failed",
        run,
      );
    }
    if (awaitingOperator(run) !== null) {
      return fail(
        "step-failed",
        step.id,
        `the declared option ${declared.option} left the run waiting: ` +
          `${outcomeAt(run)?.summary ?? "no reason given"}`,
        run,
      );
    }
    const chosen = outcomeOf(run, step.id);
    log(`  ${chosen ? statusWord(chosen.status) : "?"} ${step.id} — ${chosen?.summary ?? ""}`);
  }

  log(`${profile.id} — finished, ${run.outcomes.length} step(s) recorded`);
  return { profile, raw, run, annotations, handovers, failure: null };
}
