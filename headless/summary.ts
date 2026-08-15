/**
 * The evidence, written into the job summary of a public repository.
 *
 * This is the batch run's screen. Nobody watched the run happen, so everything
 * that would have been on a screen has to be here instead, in the one artifact
 * a public repository serves to anybody with the link and no credential at all:
 * the job summary.
 *
 * ## What goes in, and in what order
 *
 * 1. **The scope statement, verbatim, first.** The same constant `src/scope.ts`
 *    holds and the built page renders — one copy, imported, never retyped, so
 *    the `scope-verbatim` check catches a softened second copy here exactly as
 *    it would on the page. It opens the document because a summary is quoted by
 *    people who scroll to the interesting part, and the frame has to be above
 *    the interesting part.
 * 2. **What was run, and against what.** The requested ref, the **resolved full
 *    commit**, and that commit's release-audit coverage — matched from the
 *    published release body by the same modules the cockpit's release browser
 *    uses, never assumed and never typed here.
 * 3. **The playbook, as it was declared before the run.** Every choice, with the
 *    reason written down beforehand, so the answers can be read before the
 *    results.
 * 4. **Every step**: its actor, the runner's own four-state word, every request
 *    with its **raw status**, and every figure **verbatim in minor units**.
 * 5. **The figures, re-checked**, and what the documents say they cannot show.
 *
 * ## Figures, and the discipline that is inherited rather than restated
 *
 * A figure here is `figures.ts`'s projection of a response body, printed as it
 * came. `{"currency":"SGD","minorUnits":150000}` is printed as
 * `{"currency":"SGD","minorUnits":150000}`; it is not turned into `SGD 1,500.00`,
 * because that conversion is arithmetic this repository would be performing on a
 * number it claims not to compute. This module contains no arithmetic and no
 * formatter — it selects strings and joins them.
 *
 * ## Size
 *
 * A job summary is capped by GitHub. The raw exchanges are the bulk, so they
 * are collapsed, individually capped, and — if the whole document would still
 * be too large — dropped **with a sentence saying so and how many were
 * dropped**. A summary that silently lost half its evidence would be worse than
 * one that says it did.
 */

import { statusWord } from "../src/bootstrap.js";
import type { Exchange } from "../src/net.js";
import { curlFor } from "../src/net.js";
import { figureText } from "../src/figures.js";
import { formatTagMatch, type ConnectedInstance, type TagMatch } from "../src/instance.js";
import type { ProfileStep } from "../src/profiles.js";
import { SCOPE_SOURCE, SCOPE_STATEMENT } from "../src/scope.js";
import type { DrivenProfile } from "./drive.js";
import type { FigureAssertion } from "./figures-check.js";
import { describeExecution } from "./sql.js";
import type { Playbook } from "./playbook.js";
import { coverageOf } from "./playbook.js";
import type { AnonymousProbe } from "./anonymous.js";

/** Everything the summary states about the run as a whole. */
export interface RunReport {
  /** The ref as it was asked for — a tag or a commit. */
  readonly requestedRef: string;
  /** The commit the checkout resolved to, in full. Never abbreviated here. */
  readonly resolvedSha: string;
  /** Whether that commit is a published tag, and that release's coverage. */
  readonly tagMatch: TagMatch;
  /** How the release documents behind that coverage were obtained. */
  readonly coverageSource: string;
  /** When the requested ref is a tag name that resolved to a different tag, say so. */
  readonly refDisagreement: string | null;
  /** How the stack was started, in one sentence, whichever way it went. */
  readonly bootMethod: string;
  readonly scenarioId: string;
  readonly seedId: string;
  /** The documents run, in order, including the prerequisites of the scenario. */
  readonly documentOrder: readonly string[];
  readonly playbookPath: string | null;
  readonly playbook: Playbook | null;
  readonly connection: ConnectedInstance;
  readonly workflowRunUrl: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/** The cap on one rendered body, in characters. Truncation is always stated. */
const BODY_CAP = 6000;

/** Roughly GitHub's job-summary limit, less room for the tail this module adds. */
const SUMMARY_CAP = 900_000;

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "‘")}\``;
}

/** A fence long enough that the content cannot close it early. */
function fence(content: string): string {
  const longest = [...content.matchAll(/`+/g)].reduce(
    (best, match) => Math.max(best, match[0].length),
    0,
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function block(content: string, language = ""): string {
  const marker = fence(content);
  return `${marker}${language}\n${content}\n${marker}`;
}

function capped(text: string): string {
  if (text.length <= BODY_CAP) return text;
  const omitted = text.length - BODY_CAP;
  return `${text.slice(0, BODY_CAP)}\n… truncated by the summary writer: ${omitted} more character(s) in the response.`;
}

/** The raw status line, in the instance's own words. */
function statusLine(exchange: Exchange): string {
  if (!exchange.response) return `no response — ${exchange.failure ?? "the request did not complete"}`;
  return `${exchange.response.status} ${exchange.response.statusText}`;
}

function pathOf(exchange: Exchange): string {
  try {
    const url = new URL(exchange.request.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return exchange.request.url;
  }
}

function renderExchange(exchange: Exchange): string {
  const lines: string[] = [];
  lines.push(curlFor(exchange.request));
  lines.push("");
  if (exchange.response) {
    lines.push(`< ${exchange.response.status} ${exchange.response.statusText}`);
    for (const [name, value] of exchange.response.headers) lines.push(`< ${name}: ${value}`);
    lines.push("<");
    lines.push(capped(exchange.response.body));
  } else {
    lines.push(`! ${exchange.failure ?? "the request did not complete"}`);
  }
  return block(lines.join("\n"));
}

function stepOf(document_: DrivenProfile, stepId: string): ProfileStep | undefined {
  return document_.profile.steps.find((step) => step.id === stepId);
}

function heading(report: RunReport): string {
  return [
    `# Scenario run — ${report.scenarioId} against ${report.requestedRef}`,
    "",
    `> ${SCOPE_STATEMENT}`,
    "",
    `Quoted from ${SCOPE_SOURCE.label}. It is one constant in this repository, rendered here`,
    "and into every page of the cockpit; nothing in this summary may soften it.",
    "",
  ].join("\n");
}

function whatWasRun(report: RunReport): string {
  const rows: (readonly [string, string])[] = [
    ["Requested ref", code(report.requestedRef)],
    ["Resolved commit", code(report.resolvedSha)],
    ["Release-audit coverage", cell(formatTagMatch(report.tagMatch))],
    [
      "How that was decided",
      "the resolved commit was compared with the dereferenced SHAs the GitHub Tags API " +
        "reports, and the coverage was read out of that release's own body — the paragraph " +
        "beginning “RELEASE AUDIT:” — by the same two modules the cockpit's release browser " +
        "uses. Neither value is typed in this repository, and a body those modules cannot " +
        "read renders as “coverage statement not found” rather than as anything reassuring.",
    ],
    ["Where those release documents came from", cell(report.coverageSource)],
    ["How the stack was started", cell(report.bootMethod)],
    [
      "The instance's own disclaimer",
      report.connection.disclaimer.kind === "identical"
        ? "identical to the statement above"
        : `differs — ${cell(report.connection.disclaimer.detail)}`,
    ],
    [
      "sourceCommit, as the instance reports it",
      `${code(report.connection.info.sourceCommit)} — self-reported, not attested`,
    ],
    ["Instance", code(report.connection.baseUrl)],
    ["Scenario", code(report.scenarioId)],
    ["Seed profile", code(report.seedId)],
    ["Documents run, in order", report.documentOrder.map((id) => code(id)).join(" → ")],
    [
      "Playbook",
      report.playbook && report.playbookPath
        ? `${code(report.playbookPath)} — ${cell(report.playbook.id)} v${cell(report.playbook.version)}`
        : "none given",
    ],
    ["Started", code(report.startedAt)],
    ["Finished", code(report.finishedAt)],
    ...(report.workflowRunUrl ? ([["This run", report.workflowRunUrl]] as const) : []),
  ];

  const lines = [
    "## What was run, and against what",
    "",
    "| | |",
    "|---|---|",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
  ];

  if (report.refDisagreement !== null) {
    lines.push(`**${report.refDisagreement}**`, "");
  }

  if (report.connection.info.sourceCommit !== report.resolvedSha) {
    lines.push(
      "The commit above is the one this job checked out and resolved with " +
        "`git rev-parse`, which is what the coverage line is about. The instance's own " +
        "`sourceCommit` is printed beside it unchanged: `clofin-core` calls that field " +
        "self-reported rather than attested, and a release old enough not to carry the field " +
        "at all reports it as absent. The two are shown separately rather than reconciled.",
      "",
    );
  }

  return lines.join("\n");
}

function playbookSection(report: RunReport, driven: readonly DrivenProfile[]): string {
  if (!report.playbook) {
    return [
      "## The playbook",
      "",
      "None was given, so any choice this run reaches will stop it. A batch run never " +
        "invents an answer.",
      "",
    ].join("\n");
  }

  const playbook = report.playbook;
  const scenario = driven.find((document_) => document_.profile.id === report.scenarioId);
  const coverage = scenario ? coverageOf(playbook, scenario.profile) : null;

  const lines = [
    "## The playbook, as it was declared before the run",
    "",
    `**${cell(playbook.title)}**`,
    "",
    cell(playbook.summary),
    "",
    `Source: ${cell(playbook.source)}`,
    "",
    "| # | Choice step | Declared answer | Why that one |",
    "|---:|---|---|---|",
    ...playbook.answers.map(
      (answer, index) =>
        `| ${index + 1} | ${code(answer.step)} | ${code(answer.option)} | ${cell(answer.why)} |`,
    ),
    "",
  ];

  if (coverage) {
    lines.push(
      coverage.unanswered.length === 0
        ? `This document answers every choice ${report.scenarioId} declares (${coverage.answered.length}).`
        : `Choices it does **not** answer: ${coverage.unanswered
            .map((id) => code(id))
            .join(", ")}. A run reaching one of those stops there in “waiting for you” and this ` +
            "job fails naming the step.",
      "",
    );
  }

  lines.push("What a playbook is not allowed to do:", "");
  for (const entry of playbook.notThis) lines.push(`- ${cell(entry)}`);
  lines.push("");
  return lines.join("\n");
}

function figuresOf(document_: DrivenProfile, stepId: string): string[] {
  const outcome = document_.run?.outcomes.find((candidate) => candidate.stepId === stepId);
  if (!outcome || outcome.readouts.length === 0) return [];

  const lines = [
    "",
    "| Readout | Figure | Path | Value, as the instance sent it |",
    "|---|---|---|---|",
  ];
  for (const readout of outcome.readouts) {
    for (const entry of readout.figures) {
      lines.push(
        `| ${cell(readout.label)} | ${cell(entry.label)} | ${code(entry.figure.path)} | ` +
          `${code(figureText(entry.figure))} |`,
      );
    }
  }
  lines.push("");
  lines.push("Minor units exactly as they arrived — no formatter and no arithmetic anywhere");
  lines.push("between the response and this table.");
  return lines;
}

function stepSection(
  document_: DrivenProfile,
  index: number,
  withBodies: boolean,
  droppedBodies: { count: number },
): string {
  const outcome = document_.run?.outcomes[index];
  if (!outcome) return "";
  const step = stepOf(document_, outcome.stepId);
  const annotation = document_.annotations.get(outcome.stepId);

  const lines: string[] = [];
  // The runner's own word for the state, from the one table `bootstrap.ts`
  // holds — the same word the run screens render, not a second vocabulary
  // invented for a summary.
  lines.push(`#### ${index + 1}. ${cell(outcome.stepId)} — **${statusWord(outcome.status)}**`);
  lines.push("");
  lines.push(`*${cell(outcome.title)}*`);
  lines.push("");
  lines.push(`- **Performed by:** ${outcome.actorStamp ? cell(outcome.actorStamp) : "no actor — an unauthenticated request"}`);
  lines.push(`- **The runner's own words:** ${cell(outcome.summary)}`);

  for (const handover of annotation?.handovers ?? []) {
    lines.push(
      `- **Handed over:** ${cell(handover.from ?? "nobody")} → ${cell(handover.to)} — ${cell(handover.why)}. ` +
        "The runner sent nothing until this happened.",
    );
  }

  if (annotation?.declared) {
    const chosen = outcome.chosen;
    lines.push(
      `- **Declared → performed → answered:** the playbook declared ${code(annotation.declared.option)} ` +
        `before the run; the runner took ${code(chosen?.id ?? annotation.declared.option)} ` +
        `(${cell(chosen?.label ?? "")}); the instance answered ` +
        `${cell(outcome.exchanges.map(statusLine).join(", ") || "nothing was sent")}.`,
    );
  }

  if (annotation?.sql) {
    lines.push(
      `- **Performed by the workflow, confirmed by the instance.** CloFin has no endpoint for ` +
        "this step, deliberately. The statements the runner generated were run by this job and " +
        "the API was then asked whether they landed; the step advanced on that answer.",
    );
    lines.push("");
    lines.push(`The command, exactly as it was invoked — ${cell(describeExecution(annotation.sql))}:`);
    lines.push("");
    lines.push(block(annotation.sql.argv.join(" ")));
    lines.push("");
    lines.push("The statements, as the runner rendered them:");
    lines.push("");
    lines.push(block(annotation.sql.script.trimEnd(), "sql"));
    if (annotation.sql.stdout.trim() !== "") {
      lines.push("");
      lines.push(block(capped(annotation.sql.stdout.trimEnd())));
    }
    if (annotation.sql.stderr.trim() !== "") {
      lines.push("");
      lines.push("Standard error:");
      lines.push("");
      lines.push(block(capped(annotation.sql.stderr.trimEnd())));
    }
    if (step?.kind === "manual") {
      lines.push("");
      lines.push(
        `The confirmation this step's status rests on is the request the document declares as ` +
          `${code(`${step.verify.method} ${step.verify.path}`)}, asked as ` +
          `${code(step.verify.as ?? "nobody")} — it appears below with its placeholders resolved ` +
          `and its raw answer attached. ${cell(step.verify.proves)}`,
      );
    }
  }

  if (outcome.exchanges.length > 0) {
    lines.push("");
    lines.push("| # | Request | Raw status |");
    lines.push("|---:|---|---|");
    outcome.exchanges.forEach((exchange, at) => {
      lines.push(
        `| ${at + 1} | ${code(`${exchange.request.method} ${pathOf(exchange)}`)} | ${cell(statusLine(exchange))} |`,
      );
    });
  } else {
    lines.push("");
    lines.push("No request was sent at this step.");
  }

  lines.push(...figuresOf(document_, outcome.stepId));

  if (withBodies) {
    const raw: string[] = [];
    for (const exchange of outcome.exchanges) raw.push(renderExchange(exchange));
    for (const readout of document_.run?.outcomes[index]?.readouts ?? []) {
      raw.push(renderExchange(readout.exchange));
    }
    if (raw.length > 0) {
      lines.push("");
      lines.push("<details><summary>Every request this step made, raw, and the command to repeat it</summary>");
      lines.push("");
      lines.push(...raw);
      lines.push("");
      lines.push("</details>");
    }
  } else {
    droppedBodies.count += outcome.exchanges.length + outcome.readouts.length;
  }

  if (outcome.unverifiable.length > 0) {
    lines.push("");
    lines.push("What this step cannot show:");
    lines.push("");
    for (const entry of outcome.unverifiable) lines.push(`- ${cell(entry)}`);
  }

  lines.push("");
  return lines.join("\n");
}

function documentSection(
  document_: DrivenProfile,
  withBodies: boolean,
  droppedBodies: { count: number },
): string {
  const lines: string[] = [];
  lines.push(`### ${cell(document_.profile.id)} — ${cell(document_.profile.title)}`);
  lines.push("");
  lines.push(
    `Role \`${document_.profile.role}\`, document version ${cell(document_.profile.version)}, ` +
      `format ${document_.profile.formatVersion}. Source: ${cell(document_.profile.source)}`,
  );
  lines.push("");

  if (document_.run === null) {
    lines.push("This document was not started.");
    lines.push("");
    return lines.join("\n");
  }

  const attempted = document_.run.outcomes.filter((outcome) => outcome.status !== "pending").length;
  lines.push(
    `${attempted} of ${document_.profile.steps.length} step(s) attempted; ` +
      `${document_.run.finished ? "the document finished" : "the document did not finish"}.`,
  );
  lines.push("");

  for (let index = 0; index < document_.run.outcomes.length; index += 1) {
    if (document_.run.outcomes[index]?.status === "pending") continue;
    lines.push(stepSection(document_, index, withBodies, droppedBodies));
  }

  if (document_.profile.unverifiable.length > 0) {
    lines.push(`What ${cell(document_.profile.id)} says it cannot show, whatever it returns:`);
    lines.push("");
    for (const entry of document_.profile.unverifiable) lines.push(`- ${cell(entry)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function figureCheckSection(assertions: readonly FigureAssertion[]): string {
  const lines = [
    "## Every figure above, re-checked against the body it came from",
    "",
    "This run made the assertion itself, on the responses it received, and fails if one does",
    "not hold: the text of a figure must appear character for character inside the response",
    "body it was projected out of. A value that had been scaled, rounded, summed or localised",
    "would not survive it. `figures.test.ts` makes the same assertion at build time against",
    "recorded bodies; this is the live one.",
    "",
    "| Document | Step | Readout | Figure | Value | In its own body |",
    "|---|---|---|---|---|---|",
  ];

  for (const assertion of assertions) {
    const verdict =
      assertion.verbatim === null
        ? "the instance did not send it"
        : assertion.verbatim
          ? "yes, verbatim"
          : "**NO — this run failed**";
    lines.push(
      `| ${code(assertion.profileId)} | ${code(assertion.stepId)} | ${cell(assertion.readoutLabel)} | ` +
        `${cell(assertion.figureLabel)} | ${code(assertion.text ?? "not in the response")} | ${verdict} |`,
    );
  }

  const checked = assertions.filter((assertion) => assertion.verbatim !== null).length;
  const absent = assertions.length - checked;
  lines.push("");
  lines.push(
    `${checked} figure(s) checked, ${assertions.filter((a) => a.verbatim === true).length} verbatim` +
      (absent > 0
        ? `; ${absent} absent, reported as absent rather than as a zero, which is what \`figures.ts\` does on screen.`
        : "."),
  );
  lines.push("");
  return lines.join("\n");
}

function anonymousSection(probe: AnonymousProbe): string {
  return [
    "## Reading this run's result without any credential",
    "",
    "This phase of the cockpit holds no token, so how a reader gets at these results matters",
    "as much as what is in them. This summary is served by GitHub to anybody with the link.",
    "The site's batch-runs page additionally tries to list recent runs from the public API,",
    "and this job checked whether that read is served without a credential — from a request",
    "this job made with no `Accept` beyond JSON and no credential of any kind:",
    "",
    `- **What was asked:** ${code(probe.url)}`,
    `- **What came back:** ${cell(probe.outcome)}`,
    `- **What that means for the page:** ${cell(probe.consequence)}`,
    "",
  ].join("\n");
}

function resultLine(driven: readonly DrivenProfile[]): string {
  const failed = driven.find((document_) => document_.failure !== null);
  if (!failed) {
    const steps = driven.reduce(
      (total, document_) =>
        total + (document_.run?.outcomes.filter((outcome) => outcome.status !== "pending").length ?? 0),
      0,
    );
    return `**Result: every document finished — ${steps} step(s) across ${driven.length} document(s).**`;
  }
  return (
    `**Result: the run stopped at \`${failed.profile.id}\`` +
    (failed.failure?.stepId ? ` / \`${failed.failure.stepId}\`` : "") +
    `. ${cell(failed.failure?.reason ?? "")}**`
  );
}

/**
 * Assemble the whole summary.
 *
 * Built twice when it has to be: once with every raw exchange, and — only if
 * that would exceed what a job summary may hold — once without them, carrying a
 * sentence that says how many were dropped and why.
 */
export function renderSummary(input: {
  readonly report: RunReport;
  readonly driven: readonly DrivenProfile[];
  readonly figures: readonly FigureAssertion[];
  readonly probe: AnonymousProbe;
}): string {
  const build = (withBodies: boolean): { text: string; dropped: number } => {
    const droppedBodies = { count: 0 };
    const parts = [
      heading(input.report),
      resultLine(input.driven),
      "",
      whatWasRun(input.report),
      playbookSection(input.report, input.driven),
      "## Every step, in order",
      "",
      "Each step carries the actor whose id its requests went out with, the runner's own",
      "four-state word for how it ended, the raw status of every request, and the figures",
      "projected out of the responses. A refusal is rendered as the expected outcome it is:",
      "where a document declares that it expects a `403` or a `409`, that answer is the step",
      "succeeding.",
      "",
      ...input.driven.map((document_) => documentSection(document_, withBodies, droppedBodies)),
      figureCheckSection(input.figures),
      anonymousSection(input.probe),
    ];
    return { text: parts.join("\n"), dropped: droppedBodies.count };
  };

  const full = build(true);
  if (full.text.length <= SUMMARY_CAP) return full.text;

  const trimmed = build(false);
  return [
    trimmed.text,
    "",
    "---",
    "",
    `**${trimmed.dropped} raw request/response block(s) were left out of this summary.** The whole ` +
      `document came to ${full.text.length} characters, which is more than a job summary holds, so ` +
      "the collapsed raw exchanges were dropped and everything else kept. They are in this job's " +
      "log, in full, above. Nothing else was shortened.",
    "",
  ].join("\n");
}
