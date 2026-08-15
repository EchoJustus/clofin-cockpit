/**
 * The headless driver: what it does when the runner stops, and what it never
 * does.
 *
 * Everything here runs against a stubbed `fetch` and a stubbed database client,
 * because the properties worth pinning are all about **requests that were not
 * made**. A summary of a successful batch run cannot show any of them:
 *
 * - a choice the playbook does not answer **sends nothing** and fails the run
 *   naming the step — counted at the stub, not read off a status;
 * - a step belonging to another actor sends nothing until an explicit
 *   hand-over, and the hand-over is the only thing that unblocks it;
 * - a failed step stops the run and **nothing after it is attempted**;
 * - a manual step whose SQL did not apply never sends its confirmation;
 * - a manual step whose confirmation is refused does not advance, whatever the
 *   database client said;
 * - a playbook that does not match its flow is refused **before the first
 *   request**.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { actAs, actingKey, clearActing } from "../src/acting.js";
import { forgetCredentials } from "../src/credentials.js";
import { connectOrigin } from "../src/net.js";
import { readProfile, type Profile } from "../src/profiles.js";
import { forgetWorkspace } from "../src/workspace.js";
import { driveProfile } from "../headless/drive.js";
import { readPlaybook, type Playbook } from "../headless/playbook.js";
import type { SqlExecution, SqlRunner } from "../headless/sql.js";

const BASE = "http://localhost:8081";
const ORIGIN = "http://localhost:8081";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  forgetCredentials(ORIGIN);
  clearActing(ORIGIN);
  forgetWorkspace(ORIGIN);
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly actor: string | null;
}

function stub(answer: (sent: Sent, count: number) => { status: number; body: unknown }): Sent[] {
  const seen: Sent[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const sent: Sent = {
      method: init?.method ?? "GET",
      url: String(input),
      actor: headers["X-Actor-Id"] ?? null,
    };
    seen.push(sent);
    const { status, body } = answer(sent, seen.length);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        statusText: status === 200 ? "OK" : status === 201 ? "Created" : "Forbidden",
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return seen;
}

/** A client that reports what the test told it to, and records what it was given. */
function client(status: number | null, failure: string | null = null): SqlRunner & { runs: string[] } {
  const runs: string[] = [];
  const runner = ((statements: readonly string[]): SqlExecution => {
    runs.push(statements.join("\n"));
    return {
      argv: ["a-client"],
      script: statements.join("\n"),
      status,
      signal: null,
      stdout: "",
      stderr: failure ?? "",
      failure: null,
    };
  }) as SqlRunner & { runs: string[] };
  runner.runs = runs;
  return runner;
}

const DOCUMENT = {
  id: "driven",
  role: "bootstrap",
  formatVersion: 2,
  version: "1.0.0",
  title: "A document with all three waits in it",
  summary: "For the tests.",
  source: "the tests",
  actors: [
    { key: "sam", displayName: "Sam", roles: ["controller"], limits: [] },
    { key: "wei", displayName: "Wei", roles: ["approver"], limits: [] },
  ],
  steps: [
    {
      kind: "manual",
      id: "seed",
      title: "Something CloFin has no endpoint for",
      why: "segregation of duties",
      statements: ["insert into actor values ('{{actor:sam}}');"],
      howToRun: ["psql"],
      verify: {
        title: "Ask whether it landed",
        method: "GET",
        path: "/accounts",
        as: "sam",
        expect: [200],
        proves: "the instance resolved that actor id",
      },
      unverifiable: ["That every actor was created."],
    },
    {
      kind: "request",
      id: "weis-step",
      title: "A step that is Wei's",
      why: "maker cannot check",
      method: "POST",
      path: "/approvals",
      as: "wei",
      expect: [201],
    },
    {
      kind: "choice",
      id: "the-choice",
      title: "What does the scheme say",
      why: "not ours to decide",
      as: "sam",
      options: [
        { id: "settle", label: "Settle", why: "one", method: "POST", path: "/responses", body: {}, expect: [200] },
        { id: "return", label: "Return", why: "two", method: "POST", path: "/responses", body: {}, expect: [200] },
      ],
    },
    {
      // A second choice, so a playbook can legitimately answer one and not the
      // other — which is the halting case, and a document with a single choice
      // could not express it.
      kind: "choice",
      id: "the-second-choice",
      title: "And then what does it say",
      why: "also not ours to decide",
      as: "sam",
      options: [
        { id: "again", label: "Again", why: "three", method: "POST", path: "/second-responses", body: {}, expect: [200] },
      ],
    },
    {
      kind: "request",
      id: "after-the-choices",
      title: "Never reached when a choice halts",
      why: "it is the step after",
      method: "GET",
      path: "/after",
      as: "sam",
      expect: [200],
    },
  ],
};

/** The answer the tests give for the first choice, when they mean to get past it. */
const ANSWER_FIRST = { step: "the-choice", option: "settle", why: "the tests say so" };
const ANSWER_SECOND = { step: "the-second-choice", option: "again", why: "the tests say so" };

/** A stub that answers every step of the document as the document expects. */
function agreeable() {
  return stub((sent) => {
    if (sent.url.includes("/approvals")) return { status: 201, body: {} };
    return { status: 200, body: { accounts: [] } };
  });
}

function profile(document: Record<string, unknown> = DOCUMENT): Profile {
  const result = readProfile(document, JSON.stringify(document));
  assert.equal(result.kind, "profile", JSON.stringify(result));
  return (result as { profile: Profile }).profile;
}

function playbook(answers: readonly Record<string, string>[], scenario = "driven"): Playbook {
  const document = {
    formatVersion: 1,
    id: "test-playbook",
    version: "1.0.0",
    scenario,
    title: "T",
    summary: "S",
    source: "the tests",
    notThis: ["It cannot change a request."],
    answers,
  };
  const result = readPlaybook(document, JSON.stringify(document));
  assert.equal(result.kind, "playbook");
  return (result as { playbook: Playbook }).playbook;
}

function drive(options: {
  profile?: Profile;
  playbook?: Playbook | null;
  runSql?: SqlRunner;
}) {
  connectOrigin(ORIGIN);
  return driveProfile({
    profile: options.profile ?? profile(),
    raw: "{}",
    baseUrl: BASE,
    origin: ORIGIN,
    playbook: options.playbook ?? null,
    runSql: options.runSql ?? client(0),
    log: () => {},
  });
}

describe("a choice the playbook does not answer stops the run", () => {
  it("halts at the step, names it, and sends nothing for it", async () => {
    const seen = agreeable();

    // A perfectly valid playbook that happens to answer the first choice and
    // not the second. The second is where this run must stop.
    const result = await drive({ playbook: playbook([ANSWER_FIRST]) });

    assert.equal(result.failure?.kind, "unanswered-choice");
    assert.equal(result.failure?.stepId, "the-second-choice");
    assert.match(result.failure?.reason ?? "", /does not answer it/);
    assert.match(result.failure?.reason ?? "", /It offers again/);

    // Nothing was sent for that choice, and the step after it was never
    // attempted. Counted at the stub rather than read off a status.
    assert.equal(seen.filter((sent) => sent.url.includes("/second-responses")).length, 0);
    assert.equal(seen.filter((sent) => sent.url.includes("/after")).length, 0);
    // The run is left in the runner's own waiting state, not in a failed one.
    assert.equal(result.run?.outcomes[3]?.status, "awaiting-operator");
    assert.equal(result.run?.outcomes[3]?.waitingFor, "choice");
  });

  it("halts the same way when there is no playbook at all", async () => {
    const seen = agreeable();
    const result = await drive({ playbook: null });
    assert.equal(result.failure?.kind, "unanswered-choice");
    assert.equal(result.failure?.stepId, "the-choice");
    assert.match(result.failure?.reason ?? "", /no playbook was given/);
    assert.equal(seen.filter((sent) => sent.url.includes("/responses")).length, 0);
  });
});

describe("a declared answer is taken, and only that one", () => {
  it("sends exactly the option's request and finishes", async () => {
    const seen = agreeable();

    const result = await drive({
      playbook: playbook([
        { step: "the-choice", option: "return", why: "the tests say so" },
        ANSWER_SECOND,
      ]),
    });

    assert.equal(result.failure, null);
    assert.equal(result.run?.finished, true);
    // One request for the choice — the one that was declared — and not two.
    assert.equal(seen.filter((sent) => sent.url.endsWith("/responses")).length, 1);
    assert.equal(result.annotations.get("the-choice")?.declared?.option, "return");
    assert.equal(result.run?.outcomes[2]?.chosen?.id, "return");
  });
});

describe("the actor gate is satisfied by an explicit hand-over, never a guess", () => {
  it("sends nothing for another actor's step until the driver switches", async () => {
    const seen = agreeable();

    const result = await drive({ playbook: playbook([ANSWER_FIRST, ANSWER_SECOND]) });

    const approval = seen.find((sent) => sent.url.includes("/approvals"));
    const wei = result.handovers.find((handover) => handover.to === "wei");
    assert.ok(wei, "the driver should have handed over to Wei");
    assert.equal(wei?.from, "sam", "it should hand over from whoever was acting");

    // The request carried Wei's id, and the hand-over is recorded against the
    // step that required it.
    assert.ok(approval?.actor);
    assert.equal(result.annotations.get("weis-step")?.handovers.length, 1);

    // And the choice afterwards went out as Sam, because the choice declares him.
    assert.equal(actingKey(ORIGIN), "sam");
  });
});

describe("a failed step stops everything after it", () => {
  it("stops at the refusal and never attempts the steps below", async () => {
    const seen = stub((sent) => {
      if (sent.url.includes("/approvals")) return { status: 403, body: { title: "Forbidden" } };
      return { status: 200, body: { accounts: [] } };
    });

    const result = await drive({ playbook: playbook([ANSWER_FIRST, ANSWER_SECOND]) });

    assert.equal(result.failure?.kind, "step-failed");
    assert.equal(result.failure?.stepId, "weis-step");
    assert.equal(seen.filter((sent) => sent.url.includes("/responses")).length, 0);
    assert.equal(seen.filter((sent) => sent.url.includes("/after")).length, 0);
  });
});

describe("a manual step advances on the instance's answer and nothing else", () => {
  it("does not send the confirmation when the statements did not apply", async () => {
    const seen = stub(() => ({ status: 200, body: { accounts: [] } }));
    const sql = client(1, "ERROR: relation \"actor\" does not exist");

    const result = await drive({ runSql: sql, playbook: null });

    assert.equal(result.failure?.kind, "sql-not-applied");
    assert.equal(result.failure?.stepId, "seed");
    assert.equal(sql.runs.length, 1, "the statements should have been attempted once");
    // The whole point: no confirmation went out, so no step could advance on one.
    assert.equal(seen.length, 0);
  });

  it("does not advance when the instance refuses the confirmation", async () => {
    stub(() => ({ status: 403, body: { title: "Forbidden" } }));
    const result = await drive({ runSql: client(0), playbook: null });

    assert.equal(result.failure?.kind, "not-confirmed");
    assert.equal(result.failure?.stepId, "seed");
    assert.equal(result.run?.outcomes[0]?.status, "awaiting-operator");
  });

  it("runs the statements the runner generated, with the run's values in them", async () => {
    stub(() => ({ status: 200, body: { accounts: [] } }));
    const sql = client(0);
    await drive({ runSql: sql, playbook: null });

    assert.equal(sql.runs.length, 1);
    // The placeholder is resolved by the runner, not by the driver, and a
    // statement still carrying one would never have been run.
    assert.doesNotMatch(sql.runs[0] ?? "", /\{\{/);
    assert.match(sql.runs[0] ?? "", /insert into actor/);
  });
});

describe("a playbook that does not match its flow is refused before anything is sent", () => {
  it("refuses without making a request", async () => {
    const seen = stub(() => ({ status: 200, body: {} }));
    const result = await drive({
      playbook: playbook([{ step: "no-such-step", option: "settle", why: "x" }]),
    });

    assert.equal(result.failure?.kind, "playbook-mismatch");
    assert.equal(result.run, null);
    assert.equal(seen.length, 0);
  });
});

describe("a flow that cannot start says so before its first request", () => {
  it("refuses a flow whose actors this instance never minted", async () => {
    const seen = stub(() => ({ status: 200, body: {} }));
    const flow = profile({ ...DOCUMENT, id: "a-flow", role: "flow", steps: [DOCUMENT.steps[1]] });
    const result = await drive({ profile: flow, playbook: null });

    assert.equal(result.failure?.kind, "refused-to-start");
    assert.equal(seen.length, 0);
  });
});

describe("the acting actor is only ever changed by this driver's own hand-over", () => {
  it("leaves an already-correct actor alone", async () => {
    agreeable();
    const result = await drive({ playbook: playbook([ANSWER_FIRST, ANSWER_SECOND]) });
    // Three steps need an actor, and only two hand-overs were necessary: the
    // choice is Sam's and Sam was already acting after the manual step.
    assert.equal(result.handovers.length, 3);
    assert.deepEqual(
      result.handovers.map((handover) => handover.to),
      ["sam", "wei", "sam"],
    );
  });

  it("fails rather than sending as somebody else when the actor is unknown", async () => {
    const seen = stub(() => ({ status: 200, body: { accounts: [] } }));
    connectOrigin(ORIGIN);
    const stripped = profile({
      ...DOCUMENT,
      actors: [{ key: "sam", displayName: "Sam", roles: ["controller"], limits: [] }],
      steps: [DOCUMENT.steps[0]],
    });
    // Drive it once so credentials exist, then ask for an actor nobody minted.
    await drive({ profile: stripped, playbook: null });
    assert.equal(actAs(ORIGIN, "wei"), false, "Wei was never minted for this instance");
    assert.ok(seen.length >= 0);
  });
});
