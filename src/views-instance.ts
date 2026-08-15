/**
 * The instance screens: connecting, what an instance says it is, and the
 * bootstrap run.
 *
 * Kept apart from `views.ts` — which renders published releases, a thing that
 * has already happened — because these render a system that is running now.
 * The two tenses are the boundary ADR-0026 draws between the three
 * repositories, and it is worth being able to see, in this repository's own
 * file list, which code is on which side of it.
 *
 * Every value on these screens came from a response and is rendered as text.
 * Nothing is computed about a payment, nothing is simulated, and every claim
 * about what the instance is has the instance's own answer beside it — visible
 * on the same screen, not behind a link.
 */

import {
  awaitingOperator,
  canContinue,
  runSummary,
  type Run,
  type StepOutcome,
} from "./bootstrap.js";
import { CORE_REPO } from "./core-repo.js";
import { el } from "./dom.js";
import {
  formatTagMatch,
  matchTag,
  type ConnectedInstance,
  type RefusedInstance,
} from "./instance.js";
import { ORIGIN_RULES } from "./origins.js";
import type { Profile } from "./profiles.js";
import { exchangeList } from "./raw-view.js";
import type { RegistryEntry } from "./registry.js";
import type { ReleaseRecord } from "./releases.js";
import { SCOPE_STATEMENT } from "./scope.js";

/** What the caller must supply for these views to do anything. */
export interface InstanceActions {
  readonly connect: (baseUrl: string, label: string) => void;
  readonly forget: (baseUrl: string) => void;
  readonly select: (baseUrl: string) => void;
  readonly chooseProfile: (profileId: string) => void;
  /** Create the run and mint its actors. Performs no step — that is deliberate. */
  readonly beginRun: () => void;
  readonly runNextStep: () => void;
  readonly confirmManualStep: () => void;
  readonly restart: () => void;
}

function labelled(label: string, value: string, mono = false): HTMLElement {
  return el("div", { class: "field" }, [
    el("span", { class: "field__label" }, [label]),
    el("span", { class: mono ? "field__value field__value--mono" : "field__value" }, [value]),
  ]);
}

// ---------------------------------------------------------------------------
// The registry and the connect form
// ---------------------------------------------------------------------------

/**
 * The connect form.
 *
 * A real `<form>`, which phase 1's build refused to emit because nothing
 * legitimate needed one. `form-action 'none'` in the page's policy means it can
 * never submit anywhere — the submit handler runs and the browser has no
 * permission to navigate even if it did not.
 */
function connectForm(actions: InstanceActions): HTMLElement {
  const url = el("input", {
    type: "url",
    id: "instance-url",
    name: "instance-url",
    class: "input",
    required: true,
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "the base URL your instance answers on",
  });
  const label = el("input", {
    type: "text",
    id: "instance-label",
    name: "instance-label",
    class: "input",
    autocomplete: "off",
    maxlength: "80",
    placeholder: "a name for it, for your own list",
  });

  const form = el("form", { class: "connect" }, [
    el("div", { class: "connect__row" }, [
      el("label", { class: "connect__label", for: "instance-url" }, ["Instance base URL"]),
      url,
    ]),
    el("div", { class: "connect__row" }, [
      el("label", { class: "connect__label", for: "instance-label" }, ["Label"]),
      label,
    ]),
    el("button", { type: "submit", class: "copy" }, ["Ask this address what it is"]),
  ]);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    actions.connect(url.value, label.value);
  });

  return form;
}

function originRules(): HTMLElement {
  return el("div", { class: "card" }, [
    el("h3", {}, ["Which addresses this page will contact"]),
    el("p", { class: "card__note" }, [
      "Two shapes, and nothing else. The list is one constant in src/origins.ts, and the ",
      "page's Content-Security-Policy is generated from it at build time — so the browser ",
      "refuses anything this page would refuse, and neither can be relaxed without the other.",
    ]),
    el(
      "ul",
      { class: "rules" },
      ORIGIN_RULES.map((rule) =>
        el("li", {}, [
          el("span", { class: "rules__label" }, [rule.label]),
          el("span", { class: "rules__sources" }, [rule.cspSources.join("  ")]),
        ]),
      ),
    ),
    el("p", { class: "card__note" }, [
      "A plain-http address on your own machine works from an https page: browsers treat ",
      "localhost as trustworthy. Any other plain-http address is blocked by the browser as ",
      "mixed content, and a blocked request tells a page nothing — which is why this page ",
      "says so here rather than showing you a failed fetch.",
    ]),
  ]);
}

/** The instances screen: what is remembered, and the form that adds one. */
export function instancesView(
  registry: readonly RegistryEntry[],
  actions: InstanceActions,
  pending: string | null,
): HTMLElement {
  return el("section", { class: "panel" }, [
    el("h1", {}, ["Instances"]),
    el("p", { class: "panel__lede" }, [
      "Connect to a CloFin instance you started yourself — the Compose card on a release ",
      "page prints the commands. This page asks it what it is and shows you its answer; it ",
      "does not deploy anything and cannot reach your machine.",
    ]),

    connectForm(actions),
    pending ? el("p", { class: "connect__pending" }, [pending]) : null,

    registry.length === 0
      ? el("p", { class: "raw__none" }, ["No instance is remembered yet."])
      : el("div", { class: "card" }, [
          el("h3", {}, ["Remembered addresses"]),
          el("p", { class: "card__note" }, [
            "Addresses and labels only. Nothing else about an instance is stored anywhere, ",
            "and the actor ids a bootstrap run mints are held in this tab for as long as it ",
            "is open and are dropped when you forget the instance.",
          ]),
          el(
            "ul",
            { class: "instances" },
            registry.map((entry) => {
              const open = el("button", { type: "button", class: "copy copy--inline" }, [
                "Connect",
              ]);
              open.addEventListener("click", () => actions.select(entry.baseUrl));
              const drop = el("button", { type: "button", class: "copy copy--quiet" }, ["Forget"]);
              drop.addEventListener("click", () => actions.forget(entry.baseUrl));
              return el("li", { class: "instances__item" }, [
                el("span", { class: "instances__url" }, [entry.baseUrl]),
                el("span", { class: "instances__label" }, [entry.label || "(no label)"]),
                open,
                drop,
              ]);
            }),
          ),
        ]),

    originRules(),
  ]);
}

// ---------------------------------------------------------------------------
// A refusal
// ---------------------------------------------------------------------------

export function refusedInstanceView(refusal: RefusedInstance): HTMLElement {
  return el("section", { class: "panel" }, [
    el("p", { class: "breadcrumb" }, [el("a", { href: "#/instances" }, ["← Instances"])]),
    el("h1", {}, ["Refused"]),
    el("p", { class: "field__value field__value--mono" }, [refusal.baseUrl]),
    el("p", { class: "error" }, [refusal.reason]),
    el("h2", {}, ["What was asked, and what came back"]),
    exchangeList(refusal.exchanges),
  ]);
}

// ---------------------------------------------------------------------------
// A connected instance
// ---------------------------------------------------------------------------

function disclaimerCard(instance: ConnectedInstance): HTMLElement {
  const identical = instance.disclaimer.kind === "identical";
  return el("div", { class: identical ? "card" : "card card--divergent" }, [
    el("h2", {}, ["What this instance says it is"]),
    el("p", { class: "card__note" }, [
      "Quoted from this instance's own GET / response, character for character.",
    ]),
    el("blockquote", { class: "quote" }, [instance.info.disclaimer]),
    identical
      ? el("p", { class: "card__note" }, [
          "This is the same sentence this page carries in its frame, byte for byte.",
        ])
      : el("div", {}, [
          el("p", { class: "error" }, [
            "This instance's statement of scope is not the sentence this page quotes: " +
              (instance.disclaimer.kind === "differs" ? instance.disclaimer.detail : ""),
          ]),
          el("p", { class: "card__note" }, [
            "Both are shown, and neither is edited. The statement in the frame above is this ",
            "repository's canonical copy of the CloFin scope statement; the one in the ",
            "blockquote is what this particular instance answered.",
          ]),
          el("blockquote", { class: "quote quote--canonical" }, [SCOPE_STATEMENT]),
        ]),
  ]);
}

function identityCard(
  instance: ConnectedInstance,
  records: readonly ReleaseRecord[] | null,
  whyNotChecked: string,
): HTMLElement {
  const match = matchTag(instance.info.sourceCommit, records, whyNotChecked);

  return el("div", { class: "card" }, [
    el("h2", {}, ["Identity, as reported"]),
    el("div", { class: "fields" }, [
      labelled("Service", instance.info.service),
      labelled("Environment", instance.info.environment),
      labelled(
        "Schema version",
        instance.readiness?.schemaVersion ?? "not reported by /readyz",
        true,
      ),
      labelled("Source commit", instance.info.sourceCommit, true),
    ]),
    el("p", { class: "card__note card__note--strong" }, [
      "The source commit is self-reported by the running process, not attested. It is what ",
      "that process says it was built from; nothing in this exchange demonstrates that the ",
      "bytes answering are the bytes at that commit.",
    ]),
    el("div", { class: match.kind === "matched" ? "coverage" : "coverage coverage--missing" }, [
      el("span", { class: "coverage__label" }, ["Published tag"]),
      el("span", { class: "coverage__value" }, [formatTagMatch(match)]),
      el("p", { class: "coverage__why" }, [
        match.kind === "matched"
          ? `Matched: this commit is the dereferenced SHA of ${match.tag} in ${CORE_REPO.owner}/${CORE_REPO.name}'s Tags API. The coverage beside it is read from that release's own body.`
          : match.kind === "not-checked"
            ? "No tag is claimed. A tag shown without a match would be a guess, and a blank would read as though there were none."
            : "A tag is shown only when the reported commit equals a real tag's commit from the Tags API. It is never inferred from a version, a date or a branch.",
      ]),
    ]),
  ]);
}

function readinessCard(instance: ConnectedInstance): HTMLElement {
  if (!instance.readiness) {
    return el("div", { class: "card" }, [
      el("h2", {}, ["Readiness"]),
      el("p", { class: "error" }, [
        instance.readinessFailure ?? "GET /readyz did not answer, and no reason was given.",
      ]),
    ]);
  }
  const checks = Object.entries(instance.readiness.checks);
  return el("div", { class: "card" }, [
    el("h2", {}, ["Readiness"]),
    el("div", { class: "fields" }, [
      labelled("HTTP status", String(instance.readiness.httpStatus), true),
      labelled("Status", instance.readiness.status),
      ...checks.map(([name, value]) => labelled(name, value)),
    ]),
  ]);
}

function profileCard(
  instance: ConnectedInstance,
  profiles: readonly string[],
  profile: Profile | null,
  profileRefusal: string | null,
  actions: InstanceActions,
): HTMLElement {
  return el("div", { class: "card" }, [
    el("h2", {}, ["Bootstrap a synthetic organisation"]),
    el("p", { class: "card__note" }, [
      "A seed profile is a versioned JSON document in this repository, fetched from this ",
      "deployment and shown below before anything runs. Every request it will make is listed ",
      "in it, one step per request — there is no loop and no expansion, so the steps you read ",
      "are the requests the instance receives.",
    ]),
    el(
      "div",
      { class: "profiles" },
      profiles.map((id) => {
        const button = el(
          "button",
          { type: "button", class: profile?.id === id ? "copy copy--chosen" : "copy copy--inline" },
          [id],
        );
        button.addEventListener("click", () => actions.chooseProfile(id));
        return button;
      }),
    ),
    profileRefusal ? el("p", { class: "error" }, [profileRefusal]) : null,
    profile
      ? el("div", { class: "profile" }, [
          el("h3", {}, [profile.title]),
          el("div", { class: "fields" }, [
            labelled("Profile", `${profile.id} v${profile.version}`, true),
            labelled("Steps", String(profile.steps.length)),
            labelled("Actors it will mint", String(profile.actors.length)),
          ]),
          el("p", {}, [profile.summary]),
          el("p", { class: "card__note" }, [`Seed data source: ${profile.source}`]),
          el(
            "ol",
            { class: "steps steps--plan" },
            profile.steps.map((step) =>
              el("li", {}, [
                el("span", { class: "steps__kind" }, [
                  step.kind === "request" ? `${step.method} ${step.path}` : "run SQL yourself",
                ]),
                el("span", { class: "steps__title" }, [step.title]),
              ]),
            ),
          ),
          (() => {
            // Begins the run and performs nothing. The first request is the
            // operator's next, separate click: a button labelled "start" that
            // silently made a write would be the opposite of what this page is
            // for.
            const start = el("button", { type: "button", class: "copy" }, [
              `Prepare a run against ${instance.baseUrl}`,
            ]);
            start.addEventListener("click", () => actions.beginRun());
            return start;
          })(),
        ])
      : null,
  ]);
}

/** The connected-instance screen. */
export function connectedInstanceView(
  instance: ConnectedInstance,
  records: readonly ReleaseRecord[] | null,
  whyNotChecked: string,
  profiles: readonly string[],
  profile: Profile | null,
  profileRefusal: string | null,
  run: Run | null,
  actions: InstanceActions,
): HTMLElement {
  return el("section", { class: "panel" }, [
    el("p", { class: "breadcrumb" }, [el("a", { href: "#/instances" }, ["← Instances"])]),
    el("h1", {}, [instance.baseUrl]),
    el("p", { class: "panel__lede" }, [
      `Connected as ${instance.rule}. Everything below is this instance's own answer.`,
    ]),

    disclaimerCard(instance),
    identityCard(instance, records, whyNotChecked),
    readinessCard(instance),

    el("div", { class: "card" }, [
      el("h2", {}, ["The two requests this screen is built from"]),
      exchangeList(instance.exchanges),
    ]),

    run
      ? runView(run, actions)
      : profileCard(instance, profiles, profile, profileRefusal, actions),
  ]);
}

// ---------------------------------------------------------------------------
// A run
// ---------------------------------------------------------------------------

const STATUS_WORDS: Readonly<Record<StepOutcome["status"], string>> = {
  pending: "not started",
  running: "running",
  done: "done",
  "already-present": "already present",
  "awaiting-operator": "waiting for you",
  failed: "failed",
};

function stepView(outcome: StepOutcome, index: number, actions: InstanceActions): HTMLElement {
  return el("li", { class: `step step--${outcome.status}` }, [
    el("div", { class: "step__head" }, [
      el("span", { class: "step__number" }, [String(index + 1)]),
      el("span", { class: "step__title" }, [outcome.title]),
      el("span", { class: "step__status" }, [STATUS_WORDS[outcome.status]]),
    ]),
    el("p", { class: "step__summary" }, [outcome.summary]),

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
          outcome.status === "awaiting-operator"
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

    outcome.exchanges.length > 0
      ? el("div", { class: "step__raw" }, [exchangeList(outcome.exchanges)])
      : null,
  ]);
}

/** The run: every step so far, and what happens next. */
export function runView(run: Run, actions: InstanceActions): HTMLElement {
  const attempted = run.outcomes.filter((outcome) => outcome.status !== "pending");
  const remaining = run.outcomes.length - attempted.length;

  return el("div", { class: "card card--run" }, [
    el("h2", {}, [`Bootstrap: ${run.profile.title}`]),
    el("div", { class: "fields" }, [
      labelled("Profile", `${run.profile.id} v${run.profile.version}`, true),
      labelled("Instance", run.baseUrl, true),
      labelled("Progress", runSummary(run)),
    ]),

    el("p", { class: "card__note" }, [
      `${run.actors.length} synthetic actor id(s) were minted for this run and are held in this `,
      "browser tab only. They are sent to this instance and to nothing else, they are in no ",
      "file this repository ships, and forgetting the instance drops them.",
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

    el(
      "ol",
      { class: "steps" },
      attempted.map((outcome, index) => stepView(outcome, index, actions)),
    ),

    run.haltedAt && !awaitingOperator(run)
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
          "Every step completed. Re-running this profile against this instance would not create ",
          "anything twice: the chart is read before each account is opened, and the ",
          "organisation's short name is unique on the instance, which refuses a second one.",
        ])
      : null,

    canContinue(run)
      ? (() => {
          const next = el("button", { type: "button", class: "copy" }, [
            attempted.length === 0 ? "Run the first step" : "Run the next step",
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
