/**
 * The runner: one step at a time, halting where it says it halts, and never
 * creating anything twice.
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
 *   because the instance answered.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { runNext, startRun, verifyManualStep, render, unresolved } from "../src/bootstrap.js";
import { forgetCredentials } from "../src/credentials.js";
import { connectOrigin } from "../src/net.js";
import { readProfile, type Profile } from "../src/profiles.js";

const BASE = "http://localhost:8080";
const ORIGIN = "http://localhost:8080";
const ORGANISATION = "3f6b8c2e-1a4d-4b7f-9c0e-2d5a8b1c4e7f";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  forgetCredentials(ORIGIN);
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
  readonly actor: string | null;
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
  formatVersion: 1,
  version: "1.0.0",
  title: "A two-write profile",
  summary: "Enough steps to see the runner stop.",
  source: "written for bootstrap.test.ts",
  actors: [{ key: "sam", displayName: "Sam", roles: ["controller"], limits: [] }],
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
      capture: {},
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

function profile(): Profile {
  const result = readProfile(PROFILE_DOCUMENT, "");
  if (result.kind !== "profile") assert.fail(`the test profile is invalid: ${result.reason}`);
  return result.profile;
}

describe("render", () => {
  it("leaves an unresolved placeholder visible rather than blanking it", () => {
    connectOrigin(ORIGIN);
    const run = startRun(profile(), BASE, ORIGIN);
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

    let run = startRun(profile(), BASE, ORIGIN);
    run = await runNext(run);
    assert.equal(run.outcomes[0]?.status, "done");
    assert.equal(run.variables["organisationId"], ORGANISATION);

    run = await runNext(run);
    assert.equal(run.outcomes[1]?.status, "awaiting-operator");
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

    let run = startRun(profile(), BASE, ORIGIN);
    run = await runNext(run);
    run = await runNext(run);
    run = await verifyManualStep(run);

    assert.equal(run.outcomes[1]?.status, "awaiting-operator");
    assert.equal(run.index, 1, "the run has not moved on");
    assert.match(run.outcomes[1]?.summary ?? "", /Not confirmed/);
  });
});

describe("halting", () => {
  it("stops at the failing step and attempts nothing after it", async () => {
    connectOrigin(ORIGIN);
    const seen = stub(() => ({ status: 503, body: { title: "Service not ready" } }));

    let run = startRun(profile(), BASE, ORIGIN);
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

    let run = startRun(profile(), BASE, ORIGIN);
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
    let run = startRun(profile(), BASE, ORIGIN);
    run = await runNext(run);
    assert.equal(run.outcomes[0]?.status, "failed");
    assert.match(run.outcomes[0]?.summary ?? "", /carries no organisationId/);
    assert.equal(seen.length, 1);
  });
});

describe("re-running", () => {
  it("reports an existing account and does not send the create", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) => {
      if (sent.url.endsWith("/organisations")) return { status: 201, body: { id: ORGANISATION } };
      if (sent.method === "GET") return { status: 200, body: { accounts: [{ code: "1100" }] } };
      return { status: 201, body: { id: "acct" } };
    });

    let run = startRun(profile(), BASE, ORIGIN);
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
  });

  it("reports a declared conflict rather than treating it as an unexpected failure", async () => {
    connectOrigin(ORIGIN);
    stub(() => ({ status: 409, body: { title: "Conflict" } }));
    let run = startRun(profile(), BASE, ORIGIN);
    run = await runNext(run);

    // This profile declares the organisation conflict as *not* recoverable, so
    // it halts — with the profile's own explanation rather than a bare 409.
    assert.equal(run.outcomes[0]?.status, "failed");
    assert.match(run.outcomes[0]?.summary ?? "", /already there/);
    assert.match(run.outcomes[0]?.summary ?? "", /the run stops/);
    assert.equal(run.halted, true);
  });
});

describe("credentials", () => {
  it("sends the minted actor id, and only to the instance's own origin", async () => {
    connectOrigin(ORIGIN);
    const seen = stub((sent) =>
      sent.url.endsWith("/organisations")
        ? { status: 201, body: { id: ORGANISATION } }
        : { status: 200, body: { accounts: [] } },
    );

    let run = startRun(profile(), BASE, ORIGIN);
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
