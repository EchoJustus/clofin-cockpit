/**
 * A run on screen: the actor switch, the steps, the figures, and the evidence.
 *
 * Split out of `views-instance.ts` when the flows arrived, because the two
 * screens answer different questions. That file renders *what an instance says
 * it is* — a connection, an identity, a disclaimer. This one renders *what an
 * operator did to it*, which is the longer and more dangerous half: it is the
 * part that shows money moving.
 *
 * Three rules govern everything below.
 *
 * **1. Every figure is a projection of a response.** Balances, statuses, counts
 * and totals reach the screen only through `figures.ts`, which parses a
 * response body and re-serialises the value found at a path. This module does
 * no arithmetic — not a sum, not a division by a hundred to make minor units
 * look like money. `SGD 3,750.00` never appears; `{"currency":"SGD",
 * "minorUnits":375000}` does, beside the raw body it was read out of.
 *
 * **2. Every exchange is stamped with who made it.** A step's outcome carries
 * the acting actor's name, roles and id, and the `X-Actor-Id` header is visible
 * in the rendered request beneath it. The frame says the same thing at the same
 * moment. A refusal with no actor beside it is a screenshot of a system being
 * awkward; a refusal with `Priya (operator)` beside it is a control working.
 *
 * **3. Nothing is offered that would act on the operator's behalf.** There is
 * one control per decision. A choice step renders its options as separate
 * buttons and there is no "run the rest", no "play the scheme", no auto-advance
 * after a delay. The word for the thing this repository refuses to build is
 * *macro*, and the reason is in `docs/ADR/0003`.
 */

import {
  awaitingOperator,
  canContinue,
  currentStep,
  runSummary,
  type ReadoutResult,
  type Run,
  type StepOutcome,
} from "./bootstrap.js";
import { describeActing } from "./acting.js";
import { el } from "./dom.js";
import { figureText, type Figure } from "./figures.js";
import { type EvidenceResult } from "./evidence.js";
import type { ChoiceStep, Profile, ProfileStep } from "./profiles.js";
import { callCount } from "./profiles.js";
import { exchangeList } from "./raw-view.js";
import type { Subject } from "./workspace.js";

/** What the run screens need the application to be able to do. */
export interface RunActions {
  readonly runNextStep: () => void;
  readonly confirmManualStep: () => void;
  readonly choose: (optionId: string) => void;
  readonly actAs: (key: string) => void;
  readonly showEvidence: (subject: Subject) => void;
  readonly closeEvidence: () => void;
  readonly restart: () => void;
}

function labelled(label: string, value: string, mono = false): HTMLElement {
  return el("div", { class: "field" }, [
    el("span", { class: "field__label" }, [label]),
    el("span", { class: mono ? "field__value field__value--mono" : "field__value" }, [value]),
  ]);
}

// ---------------------------------------------------------------------------
// The acting actor
// ---------------------------------------------------------------------------

/**
 * The actor switcher.
 *
 * Every actor the instance's bootstrap minted, with their roles, and one button
 * each. Switching is a click and nothing else happens as a result of it: the
 * run does not advance, no request is sent, and the step that was waiting is
 * still waiting until the operator asks for it again. That is the shape the
 * brief's "switching actors is explicit" asks for — a deliberate act with a
 * visible consequence, rather than a side effect of pressing *next*.
 */
export function actorSwitcher(
  run: Run,
  actingKeyNow: string | null,
  actions: RunActions,
): HTMLElement {
  return el("div", { class: "card card--acting" }, [
    el("h3", {}, ["Who you are acting as"]),
    el("p", { class: "card__note" }, [
      "The next request will carry this actor's id in its X-Actor-Id header, and every ",
      "exchange below records which actor made it. Nothing switches on your behalf: a step ",
      "that must be performed by somebody else waits for you to hand over.",
    ]),
    el(
      "ul",
      { class: "switcher" },
      run.actors.map((actor) => {
        const on = actor.key === actingKeyNow;
        const button = el(
          "button",
          {
            type: "button",
            class: on ? "copy copy--chosen" : "copy copy--inline",
            "aria-pressed": on ? "true" : "false",
          },
          [on ? `Acting as ${actor.displayName}` : `Act as ${actor.displayName}`],
        );
        button.addEventListener("click", () => actions.actAs(actor.key));
        return el("li", { class: on ? "switcher__item switcher__item--on" : "switcher__item" }, [
          el("span", { class: "switcher__roles" }, [actor.roles.join(", ")]),
          button,
        ]);
      }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Figures and readouts
// ---------------------------------------------------------------------------

/**
 * One figure.
 *
 * The value as the instance sent it, with the path it was read from beside it,
 * so a reader can find it in the raw body underneath. A figure that was not in
 * the response says so in words rather than showing a zero — "the instance did
 * not say" and "the instance said none" are different facts, and a balance
 * screen that confused them would be the exact defect this whole arrangement
 * exists to make impossible.
 */
function figureView(label: string, figure: Figure): HTMLElement {
  return el("div", { class: figure.text === null ? "figure figure--absent" : "figure" }, [
    el("span", { class: "figure__label" }, [label]),
    el("span", { class: "figure__value" }, [figureText(figure)]),
    el("span", { class: "figure__path" }, [figure.path]),
  ]);
}

/**
 * The readouts a step performed: real requests, and the values in their answers.
 *
 * Rendered together so that "the balances after this action" is one block an
 * operator reads at a glance — and immediately beneath it, the three exchanges
 * that produced it. The heading says re-read rather than *updated*, because
 * nothing was updated: the instance was asked again.
 */
function readoutsView(readouts: readonly ReadoutResult[]): HTMLElement | null {
  if (readouts.length === 0) return null;
  return el("div", { class: "step__readouts" }, [
    el("h4", {}, ["Re-read from the instance, after this step"]),
    el("p", { class: "card__note" }, [
      "Each line below is a value taken from the response beside it, at the path shown. ",
      "Nothing here is computed, converted or scaled — minor units are printed as the ",
      "instance sent them. A balance moves on this screen because the ledger moved and the ",
      "instance was asked again.",
    ]),
    el(
      "div",
      { class: "readouts" },
      readouts.map((readout) =>
        el("div", { class: "readout" }, [
          el("h5", {}, [readout.label]),
          el("p", { class: "readout__why" }, [readout.why]),
          el(
            "div",
            { class: "figures" },
            readout.figures.map((entry) => figureView(entry.label, entry.figure)),
          ),
          el("div", { class: "readout__raw" }, [exchangeList([readout.exchange])]),
        ]),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const STATUS_WORDS: Readonly<Record<StepOutcome["status"], string>> = {
  pending: "not started",
  running: "running",
  done: "done",
  "already-present": "already present",
  "awaiting-operator": "waiting for you",
  failed: "failed",
};

function subjectsView(
  subjects: readonly Subject[],
  auditorAvailable: boolean,
  whyNot: string,
  actions: RunActions,
): HTMLElement | null {
  if (subjects.length === 0) return null;
  return el("div", { class: "step__subjects" }, [
    el("h4", {}, ["Evidence for what this step touched"]),
    auditorAvailable
      ? el("p", { class: "card__note" }, [
          "Reading the trail needs audit/read, which the actors who did the work above do not ",
          "hold. Each button switches you to the auditor and then asks — the frame will name ",
          "them, and both requests are shown.",
        ])
      : el("p", { class: "error" }, [whyNot]),
    el(
      "ul",
      { class: "subjects" },
      subjects.map((subject) => {
        const item = el("li", { class: "subjects__item" }, [
          el("span", { class: "subjects__type" }, [subject.type]),
          el("span", { class: "subjects__label" }, [subject.label]),
          el("span", { class: "subjects__id" }, [subject.id]),
        ]);
        if (auditorAvailable) {
          const button = el("button", { type: "button", class: "copy copy--inline" }, [
            "Switch to the auditor and read the evidence",
          ]);
          button.addEventListener("click", () => actions.showEvidence(subject));
          item.append(button);
        }
        return item;
      }),
    ),
  ]);
}

/**
 * The options of a choice step.
 *
 * One button per option, each carrying the sentence that says what taking it
 * means. An option that sends nothing is labelled as such and is exactly as
 * prominent as the others, because "the scheme said nothing" is one of the
 * outcomes this product exists to handle honestly and burying it would be
 * editorialising.
 */
function choiceView(step: ChoiceStep, actions: RunActions): HTMLElement {
  return el("div", { class: "step__choice" }, [
    el("h4", {}, ["What happens next is yours to decide"]),
    el("p", { class: "card__note" }, [
      "One click sends one request. There is no control here that takes more than one of ",
      "these, and none that takes one for you.",
    ]),
    el(
      "ul",
      { class: "choices" },
      step.options.map((option) => {
        const button = el(
          "button",
          { type: "button", class: option.call === null ? "copy copy--quiet" : "copy" },
          [option.label],
        );
        button.addEventListener("click", () => actions.choose(option.id));
        return el("li", { class: "choices__item" }, [
          button,
          el("p", { class: "choices__why" }, [option.why]),
          option.call
            ? el("p", { class: "choices__call" }, [`${option.call.method} ${option.call.path}`])
            : el("p", { class: "choices__call choices__call--none" }, [
                "sends nothing — no request at all",
              ]),
        ]);
      }),
    ),
  ]);
}

function stepView(
  outcome: StepOutcome,
  step: ProfileStep | undefined,
  index: number,
  isCurrent: boolean,
  waiting: ReturnType<typeof awaitingOperator>,
  auditorAvailable: boolean,
  whyNoAuditor: string,
  actions: RunActions,
): HTMLElement {
  return el("li", { class: `step step--${outcome.status}` }, [
    el("div", { class: "step__head" }, [
      el("span", { class: "step__number" }, [String(index + 1)]),
      el("span", { class: "step__title" }, [outcome.title]),
      el("span", { class: "step__status" }, [STATUS_WORDS[outcome.status]]),
    ]),

    // The stamp. Every step that sent an authenticated request says who sent
    // it, in the step itself — so a screenshot of one step is self-contained.
    outcome.actorStamp
      ? el("p", { class: "step__actor" }, [`Sent as ${outcome.actorStamp}`])
      : null,

    outcome.chosen
      ? el("p", { class: "step__chosen" }, [`You chose: ${outcome.chosen.label}`])
      : null,

    el("p", { class: "step__summary" }, [outcome.summary]),

    // A choice is offered only while this step is the one waiting for it.
    isCurrent && waiting === "choice" && step?.kind === "choice"
      ? choiceView(step, actions)
      : null,

    outcome.statements.length > 0
      ? el("div", { class: "step__sql" }, [
          el("h4", {}, ["Run these against your own instance"]),
          el("pre", { class: "raw__pre" }, [el("code", {}, [outcome.statements.join("\n\n")])]),
          (() => {
            const copy = el("button", { type: "button", class: "copy copy--inline" }, [
              "Copy the statements",
            ]);
            const text = outcome.statements.join("\n\n");
            copy.addEventListener("click", () => {
              void navigator.clipboard
                .writeText(text)
                .then(() => {
                  copy.textContent = "Copied — read it before you run it";
                })
                .catch(() => {
                  copy.textContent = "Copying was blocked; select the text above instead";
                });
            });
            return copy;
          })(),
          // Only while this step is the one waiting. A confirmed step keeps its
          // statements on screen — they are what happened — but offering the
          // button again would invite a click that either does nothing or asks
          // about a different step.
          isCurrent && waiting === "sql"
            ? (() => {
                const confirm = el("button", { type: "button", class: "copy" }, [
                  "I have run them — ask the instance",
                ]);
                confirm.addEventListener("click", () => actions.confirmManualStep());
                return confirm;
              })()
            : null,
        ])
      : null,

    readoutsView(outcome.readouts),

    outcome.unverifiable.length > 0
      ? el("div", { class: "step__unverifiable" }, [
          el("h4", {}, ["What this cannot show"]),
          el(
            "ul",
            {},
            outcome.unverifiable.map((line) => el("li", {}, [line])),
          ),
        ])
      : null,

    subjectsView(outcome.subjects, auditorAvailable, whyNoAuditor, actions),

    outcome.exchanges.length > 0
      ? el("div", { class: "step__raw" }, [exchangeList(outcome.exchanges)])
      : null,
  ]);
}

// ---------------------------------------------------------------------------
// The evidence panel
// ---------------------------------------------------------------------------

/** The evidence for one subject: both answers, raw, with who asked. */
export function evidenceView(result: EvidenceResult, actions: RunActions): HTMLElement {
  const close = el("button", { type: "button", class: "copy copy--quiet" }, ["Close"]);
  close.addEventListener("click", () => actions.closeEvidence());

  return el("div", { class: "card card--evidence" }, [
    el("h2", {}, ["Evidence"]),
    el("div", { class: "fields" }, [
      labelled("Subject", result.subject.label),
      labelled("The flow called it", result.subject.type),
      labelled("Id", result.subject.id, true),
      labelled("Asked as", `${result.askedAs.displayName} — ${result.askedAs.roles.join(", ")}`),
    ]),
    el("p", { class: "card__note card__note--strong" }, [
      "Both answers below are rendered exactly as they arrived. The subject type, the period ",
      "and the truncated flag in the pack are the instance's own; this page does not classify ",
      "a subject, order the events or decide whether the pack is complete.",
    ]),

    el("h3", {}, ["GET /audit/evidence/{subjectId} — the pack"]),
    exchangeList([result.pack]),

    el("h3", {}, ["GET /audit/events?subjectId=… — the trail, filtered"]),
    el("p", { class: "card__note" }, [
      "The second call is not decoration. The pack is the curated answer and relates a payment ",
      "to its approvals; this is the raw trail narrowed to the same id, with its own cap and ",
      "its own truncated flag. Where the two differ, the difference is visible here rather ",
      "than resolved by this page choosing one.",
    ]),
    exchangeList([result.events]),

    close,
  ]);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function inheritedView(run: Run): HTMLElement | null {
  if (run.inherited.length === 0) return null;
  return el("div", { class: "card card--inherited" }, [
    el("h3", {}, ["What this run starts with"]),
    el("p", { class: "card__note" }, [
      "Values earlier runs on this instance captured from its responses, held in this tab ",
      "only. They are shown before anything is sent, because a run whose first request ",
      "contained an id you never saw arrive would be a run with hidden state.",
    ]),
    el(
      "ul",
      { class: "inherited" },
      run.inherited.map((entry) =>
        el("li", {}, [
          el("span", { class: "inherited__name" }, [entry.name]),
          el("span", { class: "inherited__value" }, [entry.value]),
          el("span", { class: "inherited__from" }, [
            `${entry.fromProfileId} · ${entry.fromStepId}`,
          ]),
        ]),
      ),
    ),
  ]);
}

/** The plan: every step, and how many requests each will make. */
export function planView(profile: Profile): HTMLElement {
  const total = profile.steps.reduce((count, step) => count + callCount(step), 0);
  return el("div", { class: "profile" }, [
    el("h3", {}, [profile.title]),
    el("div", { class: "fields" }, [
      labelled("Document", `${profile.id} v${profile.version}`, true),
      labelled("Role", profile.role),
      labelled("Steps", String(profile.steps.length)),
      labelled("Requests, at most", String(total)),
    ]),
    el("p", {}, [profile.summary]),
    el("p", { class: "card__note" }, [`Source: ${profile.source}`]),
    profile.requires.length > 0
      ? el("p", { class: "card__note" }, [
          `Needs from an earlier run: ${profile.requires.join(", ")}.`,
        ])
      : null,
    el(
      "ol",
      { class: "steps steps--plan" },
      profile.steps.map((step) =>
        el("li", {}, [
          el("span", { class: "steps__kind" }, [
            step.kind === "request"
              ? `${step.method} ${step.path}`
              : step.kind === "choice"
                ? `${step.options.length} ways this can go`
                : "run SQL yourself",
          ]),
          el("span", { class: "steps__title" }, [step.title]),
          step.kind !== "manual" && step.readouts.length > 0
            ? el("span", { class: "steps__readouts" }, [
                `+ ${step.readouts.length} re-read(s)`,
              ])
            : null,
        ]),
      ),
    ),
    profile.unverifiable.length > 0
      ? el("div", { class: "step__unverifiable" }, [
          el("h4", {}, ["What this flow cannot show"]),
          el(
            "ul",
            {},
            profile.unverifiable.map((line) => el("li", {}, [line])),
          ),
        ])
      : null,
  ]);
}

/** The run: every step so far, and what happens next. */
export function runView(
  run: Run,
  actingKeyNow: string | null,
  auditorAvailable: boolean,
  whyNoAuditor: string,
  evidence: EvidenceResult | null,
  evidenceRefusal: string | null,
  actions: RunActions,
): HTMLElement {
  const attempted = run.outcomes.filter((outcome) => outcome.status !== "pending");
  const remaining = run.outcomes.length - attempted.length;
  const waiting = awaitingOperator(run);
  const step = currentStep(run);

  return el("div", { class: "card card--run" }, [
    el("h2", {}, [`${run.profile.role === "flow" ? "Flow" : "Bootstrap"}: ${run.profile.title}`]),
    el("div", { class: "fields" }, [
      labelled("Document", `${run.profile.id} v${run.profile.version}`, true),
      labelled("Instance", run.baseUrl, true),
      labelled("Progress", runSummary(run)),
      labelled("Acting as", describeActing(run.origin)),
    ]),

    actorSwitcher(run, actingKeyNow, actions),

    run.profile.role === "bootstrap"
      ? el("p", { class: "card__note" }, [
          `${run.actors.length} synthetic actor id(s) were minted for this run and are held in this `,
          "browser tab only. They are sent to this instance and to nothing else, they are in no ",
          "file this repository ships, and forgetting the instance drops them.",
        ])
      : el("p", { class: "card__note" }, [
          `This flow acts as the ${run.actors.length} actor(s) this instance's bootstrap run `,
          "created. It mints nothing: a second set of ids would match no row in the instance's ",
          "actor table, and every request would be refused.",
        ]),
    el(
      "ul",
      { class: "actors" },
      run.actors.map((actor) =>
        el("li", {}, [
          el("span", { class: "actors__name" }, [actor.displayName]),
          el("span", { class: "actors__roles" }, [actor.roles.join(", ")]),
          el("span", { class: "actors__id" }, [actor.actorId]),
        ]),
      ),
    ),

    inheritedView(run),

    evidenceRefusal ? el("p", { class: "error" }, [evidenceRefusal]) : null,
    evidence ? evidenceView(evidence, actions) : null,

    el(
      "ol",
      { class: "steps" },
      attempted.map((outcome, index) =>
        stepView(
          outcome,
          index === run.index ? (step ?? undefined) : undefined,
          index,
          index === run.index,
          waiting,
          auditorAvailable,
          whyNoAuditor,
          actions,
        ),
      ),
    ),

    run.haltedAt && waiting === null
      ? el("div", { class: "halt" }, [
          el("h3", {}, [`Halted at ${run.haltedAt.stepId}`]),
          el("p", {}, [run.haltedAt.reason]),
          el("p", { class: "card__note" }, [
            `${remaining} later step(s) were not attempted. The run does not continue past a `,
            "failure, and nothing here retries on your behalf.",
          ]),
        ])
      : null,

    run.finished
      ? el("p", { class: "step__summary" }, [
          "Every step completed. What the run captured is held for this instance in this tab, ",
          "so the next flow in the list can use it.",
        ])
      : null,

    // One control, and it is never offered while a choice is on screen: a
    // "next" button beside a decision would be a way to advance without
    // deciding. `canContinue` is what keeps it off a failed run — a halt is
    // not something the interface offers to step over.
    canContinue(run) && waiting !== "choice"
      ? (() => {
          const next = el("button", { type: "button", class: "copy" }, [
            waiting === "actor"
              ? "Run this step, now that you have switched"
              : attempted.length === 0
                ? "Run the first step"
                : "Run the next step",
          ]);
          next.addEventListener("click", () => actions.runNextStep());
          return next;
        })()
      : null,

    (() => {
      const again = el("button", { type: "button", class: "copy copy--quiet" }, [
        "Start a new run",
      ]);
      again.addEventListener("click", () => actions.restart());
      return again;
    })(),
  ]);
}
