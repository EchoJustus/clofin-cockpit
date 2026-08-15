/**
 * The runner: one step at a time, halting where it says it halts, never
 * creating anything twice, and never sending a request as somebody the operator
 * did not choose to be.
 *
 * Everything here runs against a stubbed `fetch`, so a test can make an
 * instance answer `409` or `503` on demand — which is the point. The
 * behaviours pinned are the ones a screenshot of a successful run would not
 * show:
 *
 * - a failed step stops the run **and nothing after it is attempted**, which is
 *   asserted by counting the requests that reached the stub, not by reading a
 *   status on screen;
 * - a re-run reports `already-present` and **does not send the create**, again
 *   counted at the stub;
 * - a manual step never advances because somebody pressed a button — only
 *   because the instance answered;
 * - a step belonging to another actor **sends nothing at all** until the
 *   operator switches, and the switch is the only thing that unblocks it;
 * - a choice sends exactly one request, the one whose button was pressed, and
 *   an option that declares it sends nothing sends nothing.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { actAs, clearActing } from "../src/acting.js";
import {
  chooseOption,
  runNext,
  startRun,
  verifyManualStep,
  render,
  unresolved,
  type Run,
} from "../src/bootstrap.js";
import { forgetCredentials } from "../src/credentials.js";
import { connectOrigin } from "../src/net.js";
import { readProfile, type Profile } from "../src/profiles.js";
import { forgetWorkspace } from "../src/workspace.js";

const BASE = "http://localhost:8080";
const ORIGIN = "http://localhost:8080";
const ORGANISATION = "3f6b8c2e-1a4d-4b7f-9c0e-2d5a8b1c4e7f";

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
  readonly body: string | null;
  readonly actor: string | null;
  readonly idempotencyKey: string | null;
}

/** A stub that records what it was asked and answers from a script. */
function stub(script: (sent: Sent, count: number) => { status: number; body: unknown }): Sent[] {
  const seen: Sent[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const sent: Sent = {
      method: init?.method ?? "GET",
      url: String(input),
      body: typeof init?.body === "string" ? init.body : null,
      actor: headers["X-Actor-Id"] ?? null,
      idempotencyKey: headers["Idempotency-Key"] ?? null,
    };
    seen.push(sent);
    const answer = script(sent, seen.length);
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        statusText: answer.status === 201 ? "Created" : answer.status === 200 ? "OK" : "Conflict",
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return seen;
}

const PROFILE_DOCUMENT = {
  id: "test",
  role: "bootstrap",
  formatVersion: 2,
  version: "1.0.0",
  title: "A two-write profile",
  summary: "Enough steps to see the runner stop.",
  source: "written for bootstrap.test.ts",
  actors: [
    { key: "sam", displayName: "Sam", roles: ["controller"], limits: [] },
    { key: "wei", displayName: "Wei", roles: ["approver"], limits: [] },
  ],
  thresholds: [{ currency: "SGD", fromMinor: 0, approvalsRequired: 1 }],
  steps: [
    {
      kind: "request",
      id: "create-organisation",
      title: "Register the organisation",
      why: "the one unauthenticated write",
      method: "POST",
      path: "/organisations",
      body: { legalName: "Test Holdings", shortName: "test" },
      expect: [201],
      capture: { organisationId: "id" },
      conflict: {
        statuses: [409],
        recoverable: false,
        meaning: "already there",
        note: "the run stops",
      },
    },
    {
      kind: "manual",
      id: "seed-actors",
      title: "Seed the actors",
      why: "there is no endpoint",
      statements: ["insert into actor (id) values ('{{actor:sam}}'); -- {{organisationId}}"],
      howToRun: ["make db-shell"],
      verify: {
        title: "ask for the chart",
        method: "GET",
        path: "/accounts?organisationId={{organisationId}}",
        as: "sam",
        expect: [200],
        proves: "the actor exists",
      },
      unverifiable: ["the limits"],
    },
    {
      kind: "request",
      id: "account-1100",
      title: "Open 1100",
      why: "a controller right",
      method: "POST",
      path: "/accounts",
      as: "sam",
      body: { organisationId: "{{organisationId}}", code: "1100", name: "n", type: "asset", currency: "SGD" },
      expect: [201],
      capture: { accountClientFunds: "id" },
      precheck: {
        title: "read the chart",
        method: "GET",
        path: "/accounts?organisationId={{organisationId}}",
        as: "sam",
        presentWhen: { listAt: "accounts", field: "code", equals: "1100" },
      },
    },
  ],
};

function profile(document: unknown = PROFILE_DOCUMENT): Profile {
  const result = readProfile(document, "");
  if (result.kind !== "profile") assert.fail(`the test profile is invalid: ${result.reason}`);
  return result.profile;
}

/** Start a run, and fail loudly rather than returning a refusal into a test. */
function begin(document: unknown = PROFILE_DOCUMENT): Run {
  const started = startRun(profile(document), BASE, ORIGIN);
  if (started.kind !== "run") assert.fail(`the run was refused: ${started.reason}`);
  return started.run;
}

/** Start a run and take the identity the scripted steps expect. */
function beginAs(key: string, document: unknown = PROFILE_DOCUMENT): Run {
  const run = begin(document);
  assert.equal(actAs(ORIGIN, key), true, `${key} should be mintable by this profile`);
  return run;
}

describe("render", () => {
  it("leaves an unresolved placeholder visible rather than blanking it", () => {
    connectOrigin(ORIGIN);
    const run = begin();
    const text = render("org={{organisationId}} actor={{actor:sam}}", run);
    assert.match(text, /org=\{\{organisationId\}\}/, "an unknown variable stays a hole");
    assert.doesNotMatch(text, /actor=\{\{/, "a minted actor id resolves");
    assert.deepEqual(unresolved(text), ["{{organisationId}}"]);
  });
});

describe("a run in order", () => {
  it("creates, waits for the operator, confirms, and then opens the account", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) => {
      if (sent.url.endsWith("/organisations")) return { status: 201, body: { id: ORGANISATION } };
      if (sent.url.includes("/accounts?")) return { status: 200, body: { accounts: [] } };
      return { status: 201, body: { id: "acct" } };
    });

    let run = beginAs("sam");
    run = await runNext(run);
    assert.equal(run.outcomes[0]?.status, "done");
    assert.equal(run.variables["organisationId"], ORGANISATION);

    run = await runNext(run);
    assert.equal(run.outcomes[1]?.status, "awaiting-operator");
    assert.equal(run.outcomes[1]?.waitingFor, "sql");
    assert.equal(run.halted, true, "a manual step stops the run until it is confirmed");
    assert.match(run.outcomes[1]?.statements[0] ?? "", new RegExp(ORGANISATION));
    assert.doesNotMatch(run.outcomes[1]?.statements[0] ?? "", /\{\{/);

    const beforeConfirm = seen.length;
    run = await runNext(run);
    assert.equal(seen.length, beforeConfirm, "a halted run performs no request");

    run = await verifyManualStep(run);
    assert.equal(run.outcomes[1]?.status, "done");
    assert.match(run.outcomes[1]?.summary ?? "", /Confirmed by the running instance/);

    run = await runNext(run);
    assert.equal(run.outcomes[2]?.status, "done");
    assert.equal(run.finished, true);
  });

  it("does not advance a manual step when the instance says no", async () => {
    connectOrigin(ORIGIN);
    stub((sent) =>
      sent.url.endsWith("/organisations")
        ? { status: 201, body: { id: ORGANISATION } }
        : { status: 401, body: { title: "Unauthorised" } },
    );

    let run = beginAs("sam");
    run = await runNext(run);
    run = await runNext(run);
    run = await verifyManualStep(run);

    assert.equal(run.outcomes[1]?.status, "awaiting-operator");
    assert.equal(run.index, 1, "the run has not moved on");
    assert.match(run.outcomes[1]?.summary ?? "", /Not confirmed/);
  });
});

describe("the acting actor", () => {
  it("sends nothing for a step belonging to somebody else, and says whose it is", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) => {
      if (sent.url.endsWith("/organisations")) return { status: 201, body: { id: ORGANISATION } };
      if (sent.url.includes("/accounts?")) return { status: 200, body: { accounts: [] } };
      return { status: 201, body: { id: "acct" } };
    });

    // Acting as Wei throughout, while step three is Sam's.
    let run = beginAs("wei");
    run = await runNext(run);
    run = await runNext(run);
    // The manual step's verification is Sam's too, so it refuses to ask.
    run = await verifyManualStep(run);
    assert.equal(run.outcomes[1]?.status, "awaiting-operator");
    assert.match(run.outcomes[1]?.summary ?? "", /Switch actors/);

    actAs(ORIGIN, "sam");
    run = await verifyManualStep(run);
    assert.equal(run.outcomes[1]?.status, "done");

    actAs(ORIGIN, "wei");
    const before = seen.length;
    run = await runNext(run);

    assert.equal(run.outcomes[2]?.status, "awaiting-operator");
    assert.equal(run.outcomes[2]?.waitingFor, "actor");
    assert.equal(seen.length, before, "not one request goes out, not even the precheck");
    assert.match(run.outcomes[2]?.summary ?? "", /Sam/);
    assert.match(run.outcomes[2]?.summary ?? "", /Nothing was sent/);
    assert.equal(run.index, 2, "the run has not moved past it");
  });

  it("re-attempts the same step once the operator has switched, and no other", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) => {
      if (sent.url.endsWith("/organisations")) return { status: 201, body: { id: ORGANISATION } };
      if (sent.url.includes("/accounts?")) return { status: 200, body: { accounts: [] } };
      return { status: 201, body: { id: "acct" } };
    });

    let run = beginAs("sam");
    run = await runNext(run);
    run = await runNext(run);
    run = await verifyManualStep(run);

    actAs(ORIGIN, "wei");
    run = await runNext(run);
    assert.equal(run.outcomes[2]?.waitingFor, "actor");

    actAs(ORIGIN, "sam");
    run = await runNext(run);
    assert.equal(run.outcomes[2]?.status, "done");
    assert.equal(run.finished, true);

    const creates = seen.filter((sent) => sent.method === "POST" && sent.url.endsWith("/accounts"));
    assert.equal(creates.length, 1, "the step ran exactly once, after the switch");
  });

  it("sends the acting actor's id and never a step's declared key as a header", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) =>
      sent.url.endsWith("/organisations")
        ? { status: 201, body: { id: ORGANISATION } }
        : { status: 200, body: { accounts: [] } },
    );

    let run = beginAs("sam");
    const sam = run.actors.find((actor) => actor.key === "sam");
    assert.ok(sam, "the run mints an actor for every declared key");
    assert.match(sam.actorId, /^[0-9a-f-]{36}$/);

    run = await runNext(run);
    assert.equal(seen[0]?.actor, null, "POST /organisations is unauthenticated, deliberately");

    run = await runNext(run);
    run = await verifyManualStep(run);
    const authenticated = seen.filter((sent) => sent.actor !== null);
    assert.ok(authenticated.length > 0);
    for (const sent of authenticated) {
      assert.equal(sent.actor, sam.actorId);
      assert.ok(sent.url.startsWith(`${ORIGIN}/`), `${sent.url} is not this instance`);
    }
  });
});

describe("halting", () => {
  it("stops at the failing step and attempts nothing after it", async () => {
    connectOrigin(ORIGIN);
    const seen = stub(() => ({ status: 503, body: { title: "Service not ready" } }));

    let run = beginAs("sam");
    run = await runNext(run);

    assert.equal(run.outcomes[0]?.status, "failed");
    assert.equal(run.halted, true);
    assert.equal(run.haltedAt?.stepId, "create-organisation");
    assert.match(run.outcomes[0]?.summary ?? "", /Expected 201/);

    const after = seen.length;
    run = await runNext(run);
    run = await runNext(run);
    assert.equal(seen.length, after, "nothing after the failure was attempted");
    assert.equal(run.outcomes[1]?.status, "pending");
    assert.equal(run.outcomes[2]?.status, "pending");
  });

  it("keeps everything before the failure visible", async () => {
    connectOrigin(ORIGIN);
    stub((sent) =>
      sent.url.endsWith("/organisations")
        ? { status: 201, body: { id: ORGANISATION } }
        : { status: 500, body: {} },
    );

    let run = beginAs("sam");
    run = await runNext(run);
    run = await runNext(run);
    run = await verifyManualStep(run);
    assert.equal(run.outcomes[0]?.status, "done");
    assert.equal(run.outcomes[0]?.exchanges.length, 1);
    assert.equal(run.outcomes[0]?.exchanges[0]?.response?.status, 201);
  });

  it("fails rather than sending a request that still has a hole in it", async () => {
    connectOrigin(ORIGIN);
    // The organisation answers 201 but without an id, so nothing is captured.
    const seen = stub(() => ({ status: 201, body: { notAnId: "x" } }));
    let run = beginAs("sam");
    run = await runNext(run);
    assert.equal(run.outcomes[0]?.status, "failed");
    assert.match(run.outcomes[0]?.summary ?? "", /carries no organisationId/);
    assert.equal(seen.length, 1);
  });
});

describe("re-running", () => {
  it("reports an existing account, does not send the create, and still learns its id", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) => {
      if (sent.url.endsWith("/organisations")) return { status: 201, body: { id: ORGANISATION } };
      if (sent.method === "GET") {
        return { status: 200, body: { accounts: [{ code: "1100", id: "already-there" }] } };
      }
      return { status: 201, body: { id: "acct" } };
    });

    let run = beginAs("sam");
    run = await runNext(run);
    run = await runNext(run);
    run = await verifyManualStep(run);
    run = await runNext(run);

    assert.equal(run.outcomes[2]?.status, "already-present");
    assert.equal(
      seen.filter((sent) => sent.method === "POST" && sent.url.endsWith("/accounts")).length,
      0,
      "the create was not sent",
    );
    assert.equal(run.outcomes[2]?.exchanges.length, 1, "the detection is itself a real exchange");
    assert.match(run.outcomes[2]?.summary ?? "", /already on this instance/);
    assert.equal(
      run.variables["accountClientFunds"],
      "already-there",
      "the id is read out of the instance's answer to the check, not left empty",
    );
  });

  it("reports a declared conflict rather than treating it as an unexpected failure", async () => {
    connectOrigin(ORIGIN);
    stub(() => ({ status: 409, body: { title: "Conflict" } }));
    let run = beginAs("sam");
    run = await runNext(run);

    // This profile declares the organisation conflict as *not* recoverable, so
    // it halts — with the profile's own explanation rather than a bare 409.
    assert.equal(run.outcomes[0]?.status, "failed");
    assert.match(run.outcomes[0]?.summary ?? "", /already there/);
    assert.match(run.outcomes[0]?.summary ?? "", /the run stops/);
    assert.equal(run.halted, true);
  });
});

// ---------------------------------------------------------------------------
// Flows: choices, readouts, captured documents, and what a flow may not do
// ---------------------------------------------------------------------------

const FLOW_DOCUMENT = {
  id: "test-flow",
  role: "flow",
  formatVersion: 2,
  version: "1.0.0",
  title: "A flow with a decision in it",
  summary: "One choice, one readout, one document carried forward.",
  source: "written for bootstrap.test.ts",
  requires: ["organisationId"],
  actors: [{ key: "sam", displayName: "Sam", roles: ["controller"], limits: [] }],
  thresholds: [],
  steps: [
    {
      kind: "request",
      id: "read-statement",
      title: "Ask for the statement",
      why: "so the next step can post it back",
      method: "GET",
      path: "/settlement-statements?organisationId={{organisationId}}",
      as: "sam",
      expect: [200],
      capture: {},
      captureDocument: "statement",
    },
    {
      kind: "choice",
      id: "what-does-the-scheme-say",
      title: "What does the scheme say?",
      why: "not this page's decision",
      as: "sam",
      options: [
        {
          id: "settle",
          label: "It settles",
          why: "resolves the item",
          method: "POST",
          path: "/scheme-responses",
          body: { kind: "settled" },
          expect: [200],
          capture: {},
        },
        {
          id: "silence",
          label: "It says nothing",
          sends: false,
          why: "silence is a real outcome",
          nothingNote: "No request was sent.",
        },
      ],
      readouts: [
        {
          label: "1300-IN-TRANSIT",
          why: "re-read after the response",
          method: "GET",
          path: "/accounts/x/statement?organisationId={{organisationId}}",
          figures: [{ label: "closingBalance", path: "closingBalance" }],
        },
      ],
    },
    {
      kind: "request",
      id: "post-it-back",
      title: "Post the statement back",
      why: "the document the instance sent, unchanged",
      method: "POST",
      path: "/reconciliation-statements",
      as: "sam",
      bodyFrom: "statement",
      bodyMerge: { organisationId: "{{organisationId}}" },
      expect: [200],
      capture: {},
    },
  ],
};

/** Bootstrap first, so the flow has actors and an organisation id to inherit. */
async function bootstrapThenFlow(): Promise<Run> {
  const seen = stub((sent) => {
    if (sent.url.endsWith("/organisations")) return { status: 201, body: { id: ORGANISATION } };
    if (sent.url.includes("/accounts?")) return { status: 200, body: { accounts: [] } };
    return { status: 201, body: { id: "acct" } };
  });
  void seen;
  let run = beginAs("sam");
  run = await runNext(run);
  run = await runNext(run);
  run = await verifyManualStep(run);
  run = await runNext(run);
  assert.equal(run.finished, true, "the bootstrap has to complete for the flow to inherit");

  const started = startRun(profile(FLOW_DOCUMENT), BASE, ORIGIN);
  if (started.kind !== "run") assert.fail(`the flow was refused: ${started.reason}`);
  return started.run;
}

describe("flows", () => {
  it("refuses to start when the instance holds no actors, and says why", () => {
    connectOrigin(ORIGIN);
    const started = startRun(profile(FLOW_DOCUMENT), BASE, ORIGIN);
    assert.equal(started.kind, "refused");
    if (started.kind === "refused") {
      assert.match(started.reason, /No synthetic actors are held/);
    }
  });

  it("refuses to start when an earlier run has not produced what it requires", async () => {
    connectOrigin(ORIGIN);
    stub(() => ({ status: 201, body: { id: ORGANISATION } }));
    // A bootstrap that is prepared but never run mints the actors and captures
    // nothing, which is exactly the "flows out of order" case.
    beginAs("sam");
    const started = startRun(profile(FLOW_DOCUMENT), BASE, ORIGIN);
    assert.equal(started.kind, "refused");
    if (started.kind === "refused") {
      assert.match(started.reason, /needs organisationId/);
    }
  });

  it("inherits what an earlier run captured, and says where each value came from", async () => {
    connectOrigin(ORIGIN);
    const run = await bootstrapThenFlow();
    assert.equal(run.variables["organisationId"], ORGANISATION);
    const organisation = run.inherited.find((entry) => entry.name === "organisationId");
    assert.ok(organisation, "the value is offered with its provenance");
    assert.equal(organisation.fromStepId, "create-organisation");
    assert.equal(organisation.fromProfileId, "test");
  });

  it("presents a choice, sends nothing until one is taken, then sends exactly one", async () => {
    connectOrigin(ORIGIN);
    let run = await bootstrapThenFlow();

    const seen = stub((sent) => {
      if (sent.url.includes("/settlement-statements")) {
        return { status: 200, body: { statementReference: "SIM-STMT-1", lines: [] } };
      }
      if (sent.url.includes("/statement?")) {
        return { status: 200, body: { closingBalance: { currency: "SGD", minorUnits: 375000 } } };
      }
      return { status: 200, body: { status: "submitted" } };
    });

    run = await runNext(run);
    assert.equal(run.outcomes[0]?.status, "done");

    const beforeChoice = seen.length;
    run = await runNext(run);
    assert.equal(run.outcomes[1]?.status, "awaiting-operator");
    assert.equal(run.outcomes[1]?.waitingFor, "choice");
    assert.equal(seen.length, beforeChoice, "presenting a choice sends nothing");

    // `runNext` must not step over a decision.
    run = await runNext(run);
    assert.equal(seen.length, beforeChoice, "asking for the next step does not take the choice");
    assert.equal(run.outcomes[1]?.waitingFor, "choice");

    run = await chooseOption(run, "settle");
    assert.equal(run.outcomes[1]?.status, "done");
    assert.equal(run.outcomes[1]?.chosen?.id, "settle");
    const posts = seen.filter((sent) => sent.method === "POST" && sent.url.includes("/scheme-responses"));
    assert.equal(posts.length, 1, "one option, one request");
  });

  it("sends no request at all for an option that declares it sends nothing", async () => {
    connectOrigin(ORIGIN);
    let run = await bootstrapThenFlow();

    const seen = stub((sent) => {
      if (sent.url.includes("/settlement-statements")) {
        return { status: 200, body: { statementReference: "SIM-STMT-1" } };
      }
      return { status: 200, body: { closingBalance: { currency: "SGD", minorUnits: 375000 } } };
    });

    run = await runNext(run);
    run = await runNext(run);
    const before = seen.filter((sent) => sent.method === "POST").length;

    run = await chooseOption(run, "silence");
    assert.equal(run.outcomes[1]?.status, "done");
    assert.equal(
      seen.filter((sent) => sent.method === "POST").length,
      before,
      "silence sends nothing",
    );
    assert.match(run.outcomes[1]?.summary ?? "", /No request was sent/);
    // The readouts still run, so the operator sees the balance did not move
    // because the ledger did not move.
    assert.equal(run.outcomes[1]?.readouts.length, 1);
  });

  it("projects a readout's figure out of the response it came from", async () => {
    connectOrigin(ORIGIN);
    let run = await bootstrapThenFlow();

    stub((sent) => {
      if (sent.url.includes("/settlement-statements")) {
        return { status: 200, body: { statementReference: "SIM-STMT-1" } };
      }
      if (sent.url.includes("/statement?")) {
        return { status: 200, body: { closingBalance: { currency: "SGD", minorUnits: 375000 } } };
      }
      return { status: 200, body: {} };
    });

    run = await runNext(run);
    run = await runNext(run);
    run = await chooseOption(run, "settle");

    const readout = run.outcomes[1]?.readouts[0];
    assert.ok(readout);
    assert.equal(readout.figures[0]?.figure.text, '{"currency":"SGD","minorUnits":375000}');
    // And the raw response it was read from is on the same outcome.
    assert.match(readout.exchange.response?.body ?? "", /375000/);
  });

  it("posts back the document an earlier step kept, adding members and altering none", async () => {
    connectOrigin(ORIGIN);
    let run = await bootstrapThenFlow();

    const statement = { statementReference: "SIM-STMT-1", lines: [{ lineNo: 1 }], format: "SIM-CLOFIN-RECON-STATEMENT" };
    const seen = stub((sent) => {
      if (sent.url.includes("/settlement-statements")) return { status: 200, body: statement };
      if (sent.url.includes("/statement?")) return { status: 200, body: { closingBalance: {} } };
      return { status: 200, body: { disposition: "applied" } };
    });

    run = await runNext(run);
    run = await runNext(run);
    run = await chooseOption(run, "silence");
    run = await runNext(run);

    assert.equal(run.outcomes[2]?.status, "done");
    const ingest = seen.find((sent) => sent.url.includes("/reconciliation-statements"));
    assert.ok(ingest?.body);
    const posted = JSON.parse(ingest.body) as Record<string, unknown>;
    assert.equal(posted["statementReference"], "SIM-STMT-1");
    assert.deepEqual(posted["lines"], [{ lineNo: 1 }]);
    assert.equal(posted["format"], "SIM-CLOFIN-RECON-STATEMENT");
    assert.equal(posted["organisationId"], ORGANISATION, "the merged member is added");
  });

  it("fails rather than inventing a document that no step kept", async () => {
    connectOrigin(ORIGIN);
    let run = await bootstrapThenFlow();

    stub((sent) => {
      // The statement request answers with something that is not a JSON object,
      // so nothing is kept under `statement`.
      if (sent.url.includes("/settlement-statements")) return { status: 200, body: [] };
      return { status: 200, body: { closingBalance: {} } };
    });

    run = await runNext(run);
    run = await runNext(run);
    run = await chooseOption(run, "silence");
    run = await runNext(run);

    assert.equal(run.outcomes[2]?.status, "failed");
    assert.match(run.outcomes[2]?.summary ?? "", /not a JSON object/);
  });
});

describe("idempotency keys", () => {
  it("mints a fresh key per attempt and sends it only where the profile asks", async () => {
    connectOrigin(ORIGIN);
    const document = {
      ...PROFILE_DOCUMENT,
      steps: [
        { ...PROFILE_DOCUMENT.steps[0], idempotent: true },
        PROFILE_DOCUMENT.steps[1],
        PROFILE_DOCUMENT.steps[2],
      ],
    };
    const seen = stub(() => ({ status: 201, body: { id: ORGANISATION } }));

    let run = beginAs("sam", document);
    run = await runNext(run);
    const first = seen[0]?.idempotencyKey;
    assert.ok(first, "the declared step carries a key");
    assert.match(first, /^[0-9a-f-]{36}$/);

    // A second run of the same profile is a second intended action, so it gets
    // a second key rather than replaying the first.
    forgetCredentials(ORIGIN);
    clearActing(ORIGIN);
    let again = beginAs("sam", document);
    again = await runNext(again);
    assert.notEqual(seen[1]?.idempotencyKey, first);
  });
});
