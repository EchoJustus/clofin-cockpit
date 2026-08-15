/**
 * The evidence a batch run publishes.
 *
 * The summary is the only thing most readers of a scenario run will ever see,
 * and it is served to anybody with the link. So the properties asserted here
 * are the ones that make it worth reading:
 *
 * - it **opens with the scope statement, verbatim** — the constant, not a
 *   paraphrase, and above anything interesting enough to be screenshotted;
 * - it carries the **resolved commit in full**, never abbreviated, and that
 *   tag's release-audit coverage read from the release body;
 * - every figure is printed **exactly as the instance sent it** — minor units,
 *   no separators, no decimal point that nobody sent;
 * - a run that stopped **says where it stopped**, in the first line, rather
 *   than looking like one that finished.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clearActing } from "../src/acting.js";
import { forgetCredentials } from "../src/credentials.js";
import { matchTag } from "../src/instance.js";
import { connectOrigin } from "../src/net.js";
import { buildReleaseRecords } from "../src/releases.js";
import { SCOPE_STATEMENT } from "../src/scope.js";
import { readProfile, type Profile } from "../src/profiles.js";
import { forgetWorkspace } from "../src/workspace.js";
import { driveProfile, type DrivenProfile } from "../headless/drive.js";
import { checkFigures } from "../headless/figures-check.js";
import { readPlaybook, type Playbook } from "../headless/playbook.js";
import { refusingRunner } from "../headless/sql.js";
import { renderSummary, type RunReport } from "../headless/summary.js";
import type { AnonymousProbe } from "../headless/anonymous.js";
import type { ConnectedInstance } from "../src/instance.js";
import { REF_1_SHA, releaseJson, tagJson } from "./fixtures.js";

const BASE = "http://localhost:8082";
const ORIGIN = "http://localhost:8082";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  forgetCredentials(ORIGIN);
  clearActing(ORIGIN);
  forgetWorkspace(ORIGIN);
});

/** A real statement body, so the figure has a real source to be checked against. */
const STATEMENT = {
  account: { code: "1300-IN-TRANSIT" },
  closingBalance: { currency: "SGD", minorUnits: 150000 },
};

const DOCUMENT = {
  id: "summarised",
  role: "flow",
  formatVersion: 2,
  version: "1.0.0",
  title: "One request, one readout, one choice",
  summary: "For the tests.",
  source: "the tests",
  unverifiable: ["That anything here is a real payment."],
  actors: [{ key: "sam", displayName: "Sam (controller)", roles: ["controller"], limits: [] }],
  steps: [
    {
      kind: "request",
      id: "read-batch",
      title: "Read the batch",
      why: "the baseline",
      method: "GET",
      path: "/settlement-batches/one",
      as: "sam",
      expect: [200],
      readouts: [
        {
          label: "1300-IN-TRANSIT",
          why: "the clearing exposure",
          method: "GET",
          path: "/accounts/one/statement",
          figures: [{ label: "closingBalance", path: "closingBalance" }],
        },
      ],
    },
    {
      kind: "choice",
      id: "the-choice",
      title: "What does the scheme say",
      why: "not ours to decide",
      as: "sam",
      options: [
        { id: "settle", label: "It settles", why: "one", method: "POST", path: "/responses", body: {}, expect: [200] },
      ],
      readouts: [
        {
          label: "1300-IN-TRANSIT",
          why: "re-read after the response",
          method: "GET",
          path: "/accounts/one/statement",
          figures: [{ label: "closingBalance", path: "closingBalance" }],
        },
      ],
    },
    {
      // A second choice, so a playbook can answer one and not the other — which
      // is the case a summary of a stopped run has to render honestly.
      kind: "choice",
      id: "the-late-answer",
      title: "And what does it say in the end",
      why: "also not ours to decide",
      as: "sam",
      options: [
        { id: "late", label: "It settles late", why: "two", method: "POST", path: "/late", body: {}, expect: [200] },
      ],
    },
  ],
};

/** Answering both choices; the run then finishes. */
const BOTH = [
  { step: "the-choice", option: "settle", why: "because the tests say so" },
  { step: "the-late-answer", option: "late", why: "and so on" },
];

/** Answering the first only; the run stops at the second. */
const FIRST_ONLY = [{ step: "the-choice", option: "settle", why: "because the tests say so" }];

function stub(): void {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/statement") ? STATEMENT : { ok: true };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

function profile(): Profile {
  const result = readProfile(DOCUMENT, JSON.stringify(DOCUMENT));
  assert.equal(result.kind, "profile", JSON.stringify(result));
  return (result as { profile: Profile }).profile;
}

function playbook(answers: readonly Record<string, string>[]): Playbook {
  const document = {
    formatVersion: 1,
    id: "summarised-playbook",
    version: "1.0.0",
    scenario: "summarised",
    title: "A playbook",
    summary: "Declared before the run.",
    source: "the tests",
    notThis: ["It cannot change a request."],
    answers,
  };
  const result = readPlaybook(document, JSON.stringify(document));
  assert.equal(result.kind, "playbook");
  return (result as { playbook: Playbook }).playbook;
}

const CONNECTION: ConnectedInstance = {
  kind: "connected",
  baseUrl: BASE,
  origin: ORIGIN,
  rule: "an instance on your own machine",
  plainHttp: true,
  info: {
    service: "clofin-core",
    description: "…",
    environment: "dev",
    disclaimer: SCOPE_STATEMENT,
    sourceCommit: "(not reported)",
    documentation: null,
  },
  disclaimer: { kind: "identical" },
  readiness: null,
  readinessFailure: null,
  exchanges: [],
};

const PROBE: AnonymousProbe = {
  url: "https://api.github.com/repos/EchoJustus/clofin-cockpit/actions/workflows/scenario-run.yml/runs",
  headersSent: ["Accept"],
  status: 200,
  outcome: "200 OK — 3 run(s) listed",
  consequence: "the page renders the list from this read.",
};

function report(overrides: Partial<RunReport> = {}): RunReport {
  const records = buildReleaseRecords([releaseJson()], [tagJson()]);
  return {
    requestedRef: "ref-1",
    resolvedSha: REF_1_SHA,
    tagMatch: matchTag(REF_1_SHA, records),
    coverageSource: "asked of the public GitHub API with no credential",
    refDisagreement: null,
    bootMethod: "`make up` — the composed stack",
    scenarioId: "summarised",
    seedId: "uat-standard",
    documentOrder: ["summarised"],
    playbookPath: "playbooks/summarised.playbook.json",
    playbook: playbook(BOTH),
    connection: CONNECTION,
    workflowRunUrl: null,
    startedAt: "2026-08-15T18:00:00Z",
    finishedAt: "2026-08-15T18:02:00Z",
    ...overrides,
  };
}

async function driven(answers: readonly Record<string, string>[]): Promise<DrivenProfile> {
  stub();
  connectOrigin(ORIGIN);
  // A flow needs actors on the instance, so the credentials are minted by
  // running the document as a bootstrap first — the same two-run shape the
  // browser has, compressed for the test.
  const bootstrap = await driveProfile({
    profile: { ...profile(), role: "bootstrap", steps: [] } as Profile,
    raw: "{}",
    baseUrl: BASE,
    origin: ORIGIN,
    playbook: null,
    runSql: refusingRunner("no client"),
    log: () => {},
  });
  assert.ok(bootstrap);

  return driveProfile({
    profile: profile(),
    raw: JSON.stringify(DOCUMENT, null, 2),
    baseUrl: BASE,
    origin: ORIGIN,
    playbook: playbook(answers),
    runSql: refusingRunner("no client"),
    log: () => {},
  });
}

async function summaryOf(answers: readonly Record<string, string>[], overrides: Partial<RunReport> = {}) {
  const document_ = await driven(answers);
  return {
    document_,
    text: renderSummary({
      report: report(overrides),
      driven: [document_],
      figures: checkFigures([document_]),
      probe: PROBE,
    }),
  };
}

describe("the summary opens with the frame, not with the interesting part", () => {
  it("quotes the scope statement verbatim, above everything else", async () => {
    const { text } = await summaryOf(BOTH);
    assert.ok(text.includes(`> ${SCOPE_STATEMENT}`), "the statement should be quoted verbatim");

    const statementAt = text.indexOf(SCOPE_STATEMENT);
    const figureAt = text.indexOf("minorUnits");
    assert.ok(statementAt > 0);
    assert.ok(statementAt < figureAt, "the statement must come before the figures");
  });
});

describe("the summary states what it ran against, in full", () => {
  it("prints the resolved commit unabbreviated", async () => {
    const { text } = await summaryOf(BOTH);
    assert.ok(text.includes(REF_1_SHA), "the full 40-character commit belongs in the summary");
  });

  it("reads ref-1's coverage out of the release body rather than assuming it", async () => {
    const { text } = await summaryOf(BOTH);
    assert.match(text, /ref-1 — release-audit coverage: PARTIAL — charter items 1-4 of 8/);
  });

  it("says the coverage was not checked when the releases could not be read", async () => {
    const { text } = await summaryOf(BOTH, {
      tagMatch: matchTag(REF_1_SHA, null, "the releases could not be read"),
    });
    assert.match(text, /not checked — the releases could not be read/);
    // And never toward anything reassuring.
    assert.doesNotMatch(text, /coverage: FULL/);
  });

  it("states how the stack was started, whichever way it went", async () => {
    const { text } = await summaryOf(BOTH, {
      bootMethod: "the 012/013 fallback — the image would not build here",
    });
    assert.match(text, /the 012\/013 fallback/);
  });
});

describe("figures are printed as the instance sent them", () => {
  it("prints minor units with no separator and no decimal point", async () => {
    const { text } = await summaryOf(BOTH);
    assert.ok(text.includes('{"currency":"SGD","minorUnits":150000}'));
    // The two shapes a formatter would have produced.
    assert.doesNotMatch(text, /1,500\.00/);
    assert.doesNotMatch(text, /SGD 1,500/);
  });

  it("shows that each figure was found in the body it came from", async () => {
    const { text, document_ } = await summaryOf(BOTH);
    const figures = checkFigures([document_]);
    assert.equal(figures.length, 2, "one figure from the request's readout and one from the choice's");
    assert.ok(figures.every((figure) => figure.verbatim === true));
    assert.match(text, /yes, verbatim/);
  });
});

describe("a run that stopped says so in its first lines", () => {
  it("names the document and the step, and does not read as a finished run", async () => {
    const { text } = await summaryOf(FIRST_ONLY);
    assert.match(text, /\*\*Result: the run stopped at `summarised` \/ `the-late-answer`/);
    assert.match(text, /does not answer it/);
    assert.doesNotMatch(text, /Result: every document finished/);
  });

  it("renders the halted step in the runner's own four-state word", async () => {
    const { text } = await summaryOf(FIRST_ONLY);
    assert.match(text, /#### 3\. the-late-answer — \*\*waiting for you\*\*/);
  });
});

describe("the playbook is rendered before the results it produced", () => {
  it("prints every declared answer with the reason written beforehand", async () => {
    const { text } = await summaryOf(BOTH);
    assert.match(text, /The playbook, as it was declared before the run/);
    assert.match(text, /because the tests say so/);
    assert.match(text, /declared → performed → answered/i);
  });
});
