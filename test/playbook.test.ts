/**
 * The playbook reader, and the thing it must never do.
 *
 * A playbook is the only document in this repository that decides something on
 * an operator's behalf, so it is the one whose validation matters most. Two
 * properties are pinned here:
 *
 * - **it fails closed**, exactly as `profiles.ts` does — a document missing a
 *   field is refused rather than run with an assumption in place of it;
 * - **it does not have to be complete**, and that is deliberate. A playbook
 *   that answers four of six choices is a valid document; the run stops at the
 *   fifth. Requiring completeness here would replace the halting behaviour with
 *   a message about it, and the halting behaviour is the one worth having.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  answerFor,
  checkAgainstProfile,
  coverageOf,
  readPlaybook,
  SUPPORTED_PLAYBOOK_FORMAT_VERSION,
} from "../headless/playbook.js";
import { readProfile, type Profile } from "../src/profiles.js";

const FLOW_DOCUMENT = {
  id: "a-flow",
  role: "flow",
  formatVersion: 2,
  version: "1.0.0",
  title: "A flow with one choice",
  summary: "For the tests.",
  source: "the tests",
  actors: [{ key: "sam", displayName: "Sam", roles: ["controller"], limits: [] }],
  steps: [
    {
      kind: "request",
      id: "read",
      title: "Read something",
      why: "because",
      method: "GET",
      path: "/settlement-batches/x",
      as: "sam",
      expect: [200],
    },
    {
      kind: "choice",
      id: "what-next",
      title: "What happens next",
      why: "not ours to decide",
      as: "sam",
      options: [
        { id: "settle", label: "Settle", why: "one", method: "POST", path: "/x", body: {}, expect: [200] },
        { id: "return", label: "Return", why: "two", method: "POST", path: "/x", body: {}, expect: [200] },
      ],
    },
    {
      kind: "choice",
      id: "and-then",
      title: "And then",
      why: "also not ours",
      as: "sam",
      options: [
        { id: "again", label: "Again", why: "three", method: "POST", path: "/x", body: {}, expect: [200] },
      ],
    },
  ],
};

function profile(): Profile {
  const result = readProfile(FLOW_DOCUMENT, JSON.stringify(FLOW_DOCUMENT));
  assert.equal(result.kind, "profile");
  return (result as { profile: Profile }).profile;
}

function playbookDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: SUPPORTED_PLAYBOOK_FORMAT_VERSION,
    id: "a-playbook",
    version: "1.0.0",
    scenario: "a-flow",
    title: "A playbook",
    summary: "For the tests.",
    source: "the tests",
    notThis: ["It cannot change a request."],
    answers: [{ step: "what-next", option: "settle", why: "because the next step needs it" }],
    ...overrides,
  };
}

function read(document: Record<string, unknown>) {
  return readPlaybook(document, JSON.stringify(document));
}

describe("a playbook is refused rather than interpreted", () => {
  it("reads a complete document", () => {
    const result = read(playbookDocument());
    assert.equal(result.kind, "playbook");
  });

  for (const [what, overrides] of [
    ["a format version this driver does not read", { formatVersion: 2 }],
    ["no answers at all", { answers: [] }],
    ["an answer with no reason", { answers: [{ step: "what-next", option: "settle" }] }],
    ["an answer with an empty reason", { answers: [{ step: "what-next", option: "settle", why: " " }] }],
    ["an answer that is not an object", { answers: ["settle"] }],
    ["no scenario", { scenario: "" }],
    ["no source", { source: undefined }],
    [
      "two answers for one step",
      {
        answers: [
          { step: "what-next", option: "settle", why: "one" },
          { step: "what-next", option: "return", why: "two" },
        ],
      },
    ],
  ] as const) {
    it(`refuses ${what}`, () => {
      const result = read(playbookDocument(overrides as Record<string, unknown>));
      assert.equal(result.kind, "refused", `${what} should have been refused`);
    });
  }

  it("refuses something that is not an object at all", () => {
    assert.equal(readPlaybook("settle-it", '"settle-it"').kind, "refused");
  });
});

describe("a playbook is checked against the flow it claims to answer", () => {
  const flow = profile();

  const accept = (document: Record<string, unknown>) => {
    const result = read(document);
    assert.equal(result.kind, "playbook");
    return (result as { playbook: Parameters<typeof checkAgainstProfile>[0] }).playbook;
  };

  it("passes when every answer names a real option of a real choice", () => {
    assert.deepEqual(checkAgainstProfile(accept(playbookDocument()), flow), []);
  });

  it("objects to a playbook written for another flow", () => {
    const problems = checkAgainstProfile(accept(playbookDocument({ scenario: "another" })), flow);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /answers "another" and this run is "a-flow"/);
  });

  it("objects to an answer for a step that does not exist", () => {
    const problems = checkAgainstProfile(
      accept(playbookDocument({ answers: [{ step: "nope", option: "settle", why: "x" }] })),
      flow,
    );
    assert.match(problems[0] ?? "", /which a-flow does not declare/);
    // The report names the choices there are, so the fix is one edit away.
    assert.match(problems[0] ?? "", /what-next, and-then/);
  });

  it("objects to an answer for a step nobody is being asked anything at", () => {
    const problems = checkAgainstProfile(
      accept(playbookDocument({ answers: [{ step: "read", option: "settle", why: "x" }] })),
      flow,
    );
    assert.match(problems[0] ?? "", /is a request step/);
  });

  it("objects to an option the step does not offer", () => {
    const problems = checkAgainstProfile(
      accept(playbookDocument({ answers: [{ step: "what-next", option: "explode", why: "x" }] })),
      flow,
    );
    assert.match(problems[0] ?? "", /does not offer/);
    assert.match(problems[0] ?? "", /settle, return/);
  });

  it("does NOT object to a choice it says nothing about", () => {
    // The halting case. `and-then` is unanswered and that is a legal document:
    // the run stops there rather than this check pre-empting it.
    assert.deepEqual(checkAgainstProfile(accept(playbookDocument()), flow), []);
    const coverage = coverageOf(accept(playbookDocument()), flow);
    assert.deepEqual([...coverage.answered], ["what-next"]);
    assert.deepEqual([...coverage.unanswered], ["and-then"]);
  });
});

describe("an answer is looked up, never derived", () => {
  const accept = () => {
    const result = read(playbookDocument());
    assert.equal(result.kind, "playbook");
    return (result as { playbook: Parameters<typeof answerFor>[0] }).playbook;
  };

  it("returns the declared answer", () => {
    assert.equal(answerFor(accept(), "what-next")?.option, "settle");
  });

  it("returns null for a step it does not cover, rather than a first option", () => {
    assert.equal(answerFor(accept(), "and-then"), null);
  });

  it("returns null when there is no playbook at all", () => {
    assert.equal(answerFor(null, "what-next"), null);
  });
});
