/**
 * The playbook: every choice a batch run will make, declared before it makes
 * one.
 *
 * ## Why this document exists at all
 *
 * `bootstrap.ts` stops at a `choice` step and performs nothing, because what a
 * simulated scheme says next is a fact about the world rather than something
 * this repository may script. In a browser the operator answers, one deliberate
 * click per response, and ADR-0003 spends a paragraph refusing every shortcut
 * around that.
 *
 * A batch run has nobody at the keyboard. The dishonest resolutions are easy to
 * list — take the first option, take the one the profile mentions first, guess
 * from the step's prose — and they share a shape: the run would answer for the
 * scheme and no reader could tell which answers were chosen and which were
 * fallen into.
 *
 * So a batch does not decide *less* deliberately than a browser; it decides
 * **earlier and in public**. A playbook is a versioned JSON document in
 * `playbooks/`, committed, reviewable and diffable, and the summary renders each
 * answer as *declared → performed → the instance answered*. The declaration is
 * in the repository before the run; what happened is in the summary after it;
 * the two are printed together so nobody has to take either on trust.
 *
 * ## Three things it deliberately cannot do
 *
 * 1. **It cannot invent an answer.** {@link answerFor} returns `null` for a step
 *    it does not cover, and the driver treats that exactly as a browser treats a
 *    choice nobody has clicked: the run stops in `waiting for you` and the job
 *    fails naming the step. There is no default option, no "first one wins", and
 *    no ordering rule to lean on.
 * 2. **It cannot change a request.** An answer is a step id and an option id,
 *    both of which must already exist in the flow document. The method, path,
 *    body, expected statuses and readouts all stay where they are — in
 *    `profiles/`, executed by the one runner.
 * 3. **It cannot reach the browser.** `playbooks/` is not copied into the built
 *    site, so the page cannot fetch one even if a future view tried to. Auto-play
 *    in the browser stays refused; this exists because a batch has no operator,
 *    not because clicking was inconvenient.
 *
 * ## Validation fails closed, for the reason `profiles.ts` gives
 *
 * {@link readPlaybook} returns a playbook or a refusal, with no partial document
 * and no defaulting. {@link checkAgainstProfile} then cross-checks every
 * declared answer against the flow it claims to answer — **before the first
 * request** — because an answer naming an option that does not exist is a
 * document defect, and finding it four writes into somebody's instance is worse
 * than finding it at the start.
 *
 * That cross-check deliberately does **not** require the playbook to cover every
 * choice. A missing answer is not a document defect: it is the case the halting
 * rule exists for, and pre-empting it here would replace the behaviour worth
 * demonstrating with a message about it.
 */

import type { Profile, ProfileStep } from "../src/profiles.js";

/** The playbook format this driver reads. Anything else is refused, not interpreted. */
export const SUPPORTED_PLAYBOOK_FORMAT_VERSION = 1;

/** One declared answer: which step, which of its options, and why that one. */
export interface PlaybookAnswer {
  /** The `choice` step's id, exactly as the flow document declares it. */
  readonly step: string;
  /** The option's id, exactly as that step declares it. */
  readonly option: string;
  /** Why this answer and not another. Rendered in the summary beside the result. */
  readonly why: string;
}

export interface Playbook {
  readonly id: string;
  readonly formatVersion: number;
  readonly version: string;
  /** The flow document id this playbook answers. Checked, never assumed. */
  readonly scenario: string;
  readonly title: string;
  readonly summary: string;
  /** Where the sequence comes from, so it can be compared with its source. */
  readonly source: string;
  /** What this document is not allowed to do. Rendered before the run. */
  readonly notThis: readonly string[];
  readonly answers: readonly PlaybookAnswer[];
}

export type PlaybookResult =
  | { readonly kind: "playbook"; readonly playbook: Playbook; readonly raw: string }
  | { readonly kind: "refused"; readonly reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(raw: Record<string, unknown>, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function requireStrings(raw: Record<string, unknown>, key: string, where: string): string[] {
  const value = raw[key];
  if (!Array.isArray(value)) throw new Error(`${where}: "${key}" must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`${where}: "${key}"[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

/**
 * Read a playbook document, or refuse it with the reason.
 *
 * Every field is required. There is no optional member and no default, because
 * a defaulted playbook is a set of answers nobody wrote down, which is the one
 * thing this document exists to prevent.
 */
export function readPlaybook(document: unknown, raw: string): PlaybookResult {
  try {
    const top = record(document);
    if (!top) throw new Error("the playbook is not a JSON object");

    const formatVersion = top["formatVersion"];
    if (formatVersion !== SUPPORTED_PLAYBOOK_FORMAT_VERSION) {
      throw new Error(
        `formatVersion ${JSON.stringify(formatVersion)} is not the format this driver reads ` +
          `(${SUPPORTED_PLAYBOOK_FORMAT_VERSION})`,
      );
    }

    const rawAnswers = top["answers"];
    if (!Array.isArray(rawAnswers)) throw new Error('playbook: "answers" must be an array');
    if (rawAnswers.length === 0) {
      throw new Error("a playbook with no answers would answer nothing, so it is not one");
    }

    const answers = rawAnswers.map((entry, index) => {
      const answerRaw = record(entry);
      if (!answerRaw) throw new Error(`answers[${index}] must be an object`);
      return {
        step: requireString(answerRaw, "step", `answers[${index}]`),
        option: requireString(answerRaw, "option", `answers[${index}]`),
        // Required, and required to be non-empty. An answer with no stated
        // reason is a decision somebody made and nobody has to defend, which
        // is exactly the kind of decision this file is here to expose.
        why: requireString(answerRaw, "why", `answers[${index}]`),
      };
    });

    const steps = answers.map((answer) => answer.step);
    if (new Set(steps).size !== steps.length) {
      throw new Error(
        "two answers name the same step, so which one governs would be decided by array order",
      );
    }

    return {
      kind: "playbook",
      raw,
      playbook: {
        id: requireString(top, "id", "playbook"),
        formatVersion: SUPPORTED_PLAYBOOK_FORMAT_VERSION,
        version: requireString(top, "version", "playbook"),
        scenario: requireString(top, "scenario", "playbook"),
        title: requireString(top, "title", "playbook"),
        summary: requireString(top, "summary", "playbook"),
        source: requireString(top, "source", "playbook"),
        notThis: requireStrings(top, "notThis", "playbook"),
        answers,
      },
    };
  } catch (error) {
    return { kind: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

function choiceSteps(profile: Profile): readonly ProfileStep[] {
  return profile.steps.filter((step) => step.kind === "choice");
}

/**
 * Cross-check a playbook against the flow it claims to answer.
 *
 * Returns the problems, empty when there are none. Every problem here is a
 * document defect that would otherwise surface partway through a run of writes
 * against a live instance.
 *
 * Note what is **not** a problem: a choice the playbook says nothing about.
 * That is the halting case, and it belongs to the run rather than to this
 * check — see the module note.
 */
export function checkAgainstProfile(playbook: Playbook, profile: Profile): readonly string[] {
  const problems: string[] = [];

  if (playbook.scenario !== profile.id) {
    problems.push(
      `the playbook answers "${playbook.scenario}" and this run is "${profile.id}". A playbook ` +
        "written for one flow cannot answer another's choices, and step ids that happened to " +
        "match would be a coincidence rather than a correspondence.",
    );
  }

  for (const answer of playbook.answers) {
    const step = profile.steps.find((candidate) => candidate.id === answer.step);
    if (!step) {
      problems.push(
        `the playbook answers step "${answer.step}", which ${profile.id} does not declare. ` +
          `Its choices are: ${choiceSteps(profile).map((choice) => choice.id).join(", ") || "none"}.`,
      );
      continue;
    }
    if (step.kind !== "choice") {
      problems.push(
        `the playbook answers step "${answer.step}", which is a ${step.kind} step. Nobody is ` +
          "being asked anything there, so an answer to it would have nowhere to go.",
      );
      continue;
    }
    if (!step.options.some((option) => option.id === answer.option)) {
      problems.push(
        `the playbook answers step "${answer.step}" with option "${answer.option}", which that ` +
          `step does not offer. It offers: ${step.options.map((option) => option.id).join(", ")}.`,
      );
    }
  }

  return problems;
}

/** The declared answer for a step, or `null` — which is the halting case. */
export function answerFor(playbook: Playbook | null, stepId: string): PlaybookAnswer | null {
  if (!playbook) return null;
  return playbook.answers.find((answer) => answer.step === stepId) ?? null;
}

/** Which of the flow's choices this playbook covers, and which it does not. */
export function coverageOf(
  playbook: Playbook | null,
  profile: Profile,
): { readonly answered: readonly string[]; readonly unanswered: readonly string[] } {
  const answered: string[] = [];
  const unanswered: string[] = [];
  for (const step of choiceSteps(profile)) {
    if (answerFor(playbook, step.id)) answered.push(step.id);
    else unanswered.push(step.id);
  }
  return { answered, unanswered };
}
