/**
 * The batch-runs page: what the scenario runner is, and where to run one.
 *
 * ## Why this page asks for nothing
 *
 * Dispatching a workflow is a write. A page that offered a button for it would
 * need a token, and this phase of the cockpit holds none — so the page says
 * plainly that running a scenario is something you do **on github.com**, and
 * links to the workflow there. That is not a limitation being apologised for;
 * it is the same decision the rest of this repository makes, which is that a
 * credential is not collected until there is a phase whose whole subject is how
 * it will be handled.
 *
 * Reading is the other half. A public repository serves its job summaries to
 * anybody with the link and no credential, and that is where a scenario run's
 * evidence goes. The list of recent runs below is an extra: it is fetched
 * anonymously, and if the anonymous API does not serve it, this page **says so
 * and shows what GitHub answered** rather than rendering an empty box or asking
 * for a token. `runs.ts` has no path that could ask for one.
 *
 * ## The rules it states are the ones the runner keeps
 *
 * Everything in *What a batch run does, and what it refuses to do* is a
 * property something enforces — the one runner, the playbook, the figures
 * module, the halting rule — rather than an intention. The page says which
 * thing enforces which, so a reader can go and check rather than believe.
 */

import { COCKPIT_REPO, SCENARIO_WORKFLOW_FILE, SCENARIO_WORKFLOW_URL } from "./cockpit-repo.js";
import { CORE_REPO } from "./core-repo.js";
import { el } from "./dom.js";
import { describeConclusion, type RunsResult, type ScenarioRun } from "./runs.js";

/** One promise, and the thing that keeps it. */
const RULES: readonly { readonly claim: string; readonly kept: string }[] = [
  {
    claim: "It drives the same runner these screens do.",
    kept:
      "The headless entry point calls src/bootstrap.ts — the same reader, the same four-state " +
      "vocabulary, the same actor gate and the same figures module. There is no second engine: " +
      "a batch run that re-implemented the halting rule would be re-implementing it where " +
      "nobody is watching.",
  },
  {
    claim: "Every choice is declared before the run, in a file you can read first.",
    kept:
      "A run has nobody at the keyboard, so the answers a person would click live in a " +
      "versioned playbook in playbooks/, committed and diffable. The summary renders each one " +
      "as declared, then performed, then what the instance answered.",
  },
  {
    claim: "A choice the playbook does not answer stops the run.",
    kept:
      "The run halts in the same waiting state you would see here, and the job fails naming " +
      "the step. It never picks an option: what a simulated scheme does next is a fact about " +
      "the world, and a batch that chose one would be manufacturing the thing the flow exists " +
      "to show.",
  },
  {
    claim: "Every figure is minor units exactly as the instance sent them.",
    kept:
      "Projected by src/figures.ts, which has no arithmetic in it — and the run then checks " +
      "each one again, requiring its text to appear character for character in the response " +
      "body it came from. A figure that failed that would fail the job.",
  },
  {
    claim: "The steps CloFin has no endpoint for are run by the workflow and confirmed by the instance.",
    kept:
      "The workflow is the operator there, so it runs the SQL the runner generated — and the " +
      "step still advances only when the API answers, as the same request asked by the same " +
      "actor. The summary shows both halves.",
  },
  {
    claim: `It reads ${CORE_REPO.name} and never writes to it.`,
    kept:
      "The job checks that repository out at the commit you name, holds read permission only, " +
      "and keeps no credential in either checkout. Its release audit is the reason: this " +
      "repository may drive the audit subject and may not change it.",
  },
];

function ruleList(): HTMLElement {
  return el(
    "ul",
    { class: "rules" },
    RULES.map((rule) =>
      el("li", { class: "rules__item" }, [
        el("p", { class: "rules__claim" }, [rule.claim]),
        el("p", { class: "rules__kept" }, [rule.kept]),
      ]),
    ),
  );
}

function runItem(run: ScenarioRun): HTMLElement {
  return el("li", { class: "release" }, [
    el("div", { class: "release__head" }, [
      el("a", { class: "release__tag", href: run.htmlUrl, rel: "noopener noreferrer" }, [
        `#${run.runNumber}`,
      ]),
      el("span", { class: "chip" }, [describeConclusion(run)]),
      el("span", { class: "release__sha" }, [run.event]),
    ]),
    el("p", { class: "release__name" }, [run.title]),
    el("p", { class: "card__note" }, [
      run.createdAt ? `Dispatched ${run.createdAt}.` : "GitHub did not state when it started.",
      " The evidence is in the run's job summary, which GitHub serves to anybody with the link.",
    ]),
    el("a", { class: "release__more", href: run.htmlUrl, rel: "noopener noreferrer" }, [
      "Open this run on GitHub →",
    ]),
  ]);
}

function recentRuns(runs: RunsResult | null): HTMLElement {
  if (runs === null) {
    return el("div", { class: "card" }, [
      el("h2", {}, ["Recent runs"]),
      el("p", {}, ["Asking the public GitHub API…"]),
    ]);
  }

  if (runs.kind === "absent") {
    return el("div", { class: "card" }, [
      el("h2", {}, ["Recent runs"]),
      // The whole point of this branch: it says what happened, in GitHub's own
      // words, and offers nothing that would require a credential.
      el("p", { class: "error" }, [runs.reason]),
      el("p", { class: "card__note" }, [
        "This page holds no token and does not ask for one, so there is nothing to retry with. ",
        "The runs are listed on github.com, where you are signed in, and each run's summary is ",
        "public whether or not this list renders.",
      ]),
      el("p", {}, [
        el("a", { href: SCENARIO_WORKFLOW_URL, rel: "noopener noreferrer" }, [
          "This workflow's runs on GitHub →",
        ]),
      ]),
    ]);
  }

  if (runs.runs.length === 0) {
    return el("div", { class: "card" }, [
      el("h2", {}, ["Recent runs"]),
      el("p", {}, [
        `The public API answered, and ${SCENARIO_WORKFLOW_FILE} has no runs on it yet.`,
      ]),
    ]);
  }

  return el("div", { class: "card" }, [
    el("h2", {}, ["Recent runs"]),
    el("p", { class: "card__note" }, [
      "Read from the public GitHub API without any credential, in this browser, when this page ",
      "loaded. The words below are GitHub's own — nothing here renames a status.",
    ]),
    el("ul", { class: "releases" }, runs.runs.map(runItem)),
  ]);
}

/** The batch-runs view. */
export function batchRunsView(runs: RunsResult | null): HTMLElement {
  return el("section", { class: "panel" }, [
    el("h1", {}, ["Batch runs"]),
    el("p", { class: "panel__lede" }, [
      "The walk on the Instances tab needs you, a local stack and twenty minutes. The same walk ",
      "runs as a batch on a GitHub Actions runner: it checks ",
      `${CORE_REPO.owner}/${CORE_REPO.name} out at a commit you name, starts it against a real `,
      "PostgreSQL, runs a scenario through this cockpit's own runner, and writes every step — ",
      "the actor, the raw status, and every figure in minor units — into the run's job summary.",
    ]),

    el("div", { class: "card" }, [
      el("h2", {}, ["Running one"]),
      el("p", { class: "card__note" }, [
        "Dispatching a workflow is a write, and a write needs a credential. ",
        "This cockpit holds none — so running a scenario is a ",
        el("strong", {}, ["github.com"]),
        " action: you press the button there, signed in as yourself, and this page links you ",
        "to it. There is no token field here and nothing on this page asks for one.",
      ]),
      el("p", {}, [
        el("a", { class: "release__more", href: SCENARIO_WORKFLOW_URL, rel: "noopener noreferrer" }, [
          "Run it on github.com →",
        ]),
      ]),
      el("p", { class: "card__requirements" }, [
        "Three inputs: the ",
        el("code", {}, ["clofin-core"]),
        " tag or commit to run against, which scenario to run, and which seed profile ",
        "bootstraps the instance. Everything the scenario depends on runs first, in order.",
      ]),
    ]),

    el("div", { class: "card" }, [
      el("h2", {}, ["What a batch run does, and what it refuses to do"]),
      ruleList(),
    ]),

    recentRuns(runs),

    el("div", { class: "card" }, [
      el("h2", {}, ["What a batch run cannot show you"]),
      el("ul", { class: "rules" }, [
        el("li", { class: "rules__item" }, [
          el("p", { class: "rules__kept" }, [
            "That a person watched it. Nobody did — that is what makes it a batch. The evidence " +
              "for what happened is the summary, which is why the summary carries every request " +
              "and every raw answer rather than a verdict about them.",
          ]),
        ]),
        el("li", { class: "rules__item" }, [
          el("p", { class: "rules__kept" }, [
            "That the instance behaves the same way in a browser. A run on a server is not " +
              "subject to the rule that limits which response headers a page may read, so its " +
              "summary can show headers these screens cannot. That is a difference in what the " +
              "reader is, not in what CloFin did.",
          ]),
        ]),
        el("li", { class: "rules__item" }, [
          el("p", { class: "rules__kept" }, [
            "Anything about a commit other than the one it names. The summary opens with the " +
              "resolved commit in full, and with that release's release-audit coverage when the " +
              "commit is a published tag's — read out of the release body, never assumed.",
          ]),
        ]),
        el("li", { class: "rules__item" }, [
          el("p", { class: "rules__kept" }, [
            `Anything at all about ${COCKPIT_REPO.owner}'s private state. Everything a run reads ` +
              "and everything it publishes is served to anybody with the link.",
          ]),
        ]),
      ]),
    ]),
  ]);
}
