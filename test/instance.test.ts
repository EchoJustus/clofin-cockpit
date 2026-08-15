/**
 * The honesty gate, and the tag that is matched rather than assumed.
 *
 * `connectToInstance` is exercised against a stubbed `fetch`, because the two
 * behaviours worth pinning are both about what an instance *said*: an answer
 * with no disclaimer field is refused outright, and an answer whose disclaimer
 * is not the canonical sentence connects but is reported down to the character.
 *
 * `matchTag` has four outcomes and three of them are ways of not claiming a
 * tag. The one that matters most is `not-checked`: when the release list could
 * not be read, the answer is *not* "no match", and rendering it as one would be
 * the fail-open shape `clofin-core`'s lessons L-6 and L-13 record.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  compareDisclaimer,
  connectToInstance,
  formatTagMatch,
  matchTag,
} from "../src/instance.js";
import { connectOrigin } from "../src/net.js";
import type { ReleaseRecord } from "../src/releases.js";
import { SCOPE_STATEMENT } from "../src/scope.js";
import { REF_1_BODY, REF_1_SHA } from "./fixtures.js";
import { parseCoverage } from "../src/coverage.js";

const BASE = "http://localhost:8080";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(answers: Readonly<Record<string, { status: number; body: unknown }>>): void {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    const answer = answers[url];
    if (!answer) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(
      new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), {
        status: answer.status,
        statusText: answer.status === 200 ? "OK" : "Error",
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

const READY = { status: "ready", checks: { database: "ok" }, schemaVersion: "0013" };

function info(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    service: "clofin-core",
    description: "Open-source enterprise payments and reconciliation core",
    environment: "dev",
    sourceCommit: "unknown",
    documentation: "https://github.com/EchoJustus/clofin-core",
    ...extra,
  };
}

describe("the honesty gate", () => {
  it("refuses an instance whose GET / carries no disclaimer field", async () => {
    connectOrigin(BASE);
    stubFetch({
      [`${BASE}/`]: { status: 200, body: info({}) },
      [`${BASE}/readyz`]: { status: 200, body: READY },
    });

    const result = await connectToInstance(BASE);
    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.match(result.reason, /no disclaimer field/);
    assert.equal(result.exchanges.length, 1, "readiness is not asked for once it has been refused");
  });

  it("refuses an empty or blank disclaimer as though it were absent", async () => {
    for (const disclaimer of ["", "   ", "\n"]) {
      connectOrigin(BASE);
      stubFetch({
        [`${BASE}/`]: { status: 200, body: info({ disclaimer }) },
        [`${BASE}/readyz`]: { status: 200, body: READY },
      });
      const result = await connectToInstance(BASE);
      assert.equal(result.kind, "refused", JSON.stringify(disclaimer));
    }
  });

  it("shows the refusal's own evidence rather than only an error", async () => {
    connectOrigin(BASE);
    stubFetch({ [`${BASE}/`]: { status: 200, body: info({}) } });
    const result = await connectToInstance(BASE);
    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.equal(result.exchanges[0]?.response?.status, 200);
    assert.match(result.exchanges[0]?.response?.body ?? "", /clofin-core/);
  });

  it("connects when the disclaimer is the canonical sentence", async () => {
    connectOrigin(BASE);
    stubFetch({
      [`${BASE}/`]: { status: 200, body: info({ disclaimer: SCOPE_STATEMENT }) },
      [`${BASE}/readyz`]: { status: 200, body: READY },
    });

    const result = await connectToInstance(BASE);
    assert.equal(result.kind, "connected");
    if (result.kind !== "connected") return;
    assert.equal(result.disclaimer.kind, "identical");
    assert.equal(result.readiness?.schemaVersion, "0013");
    assert.equal(result.exchanges.length, 2);
  });

  it("connects but names the divergence when the disclaimer is not the canonical one", async () => {
    const softened = SCOPE_STATEMENT.replace("data only", "data mostly");
    connectOrigin(BASE);
    stubFetch({
      [`${BASE}/`]: { status: 200, body: info({ disclaimer: softened }) },
      [`${BASE}/readyz`]: { status: 200, body: READY },
    });

    const result = await connectToInstance(BASE);
    assert.equal(result.kind, "connected");
    if (result.kind !== "connected" || result.disclaimer.kind !== "differs") {
      assert.fail("a softened disclaimer must be reported as differing");
    }
    assert.equal(result.disclaimer.at, 34);
    assert.match(result.disclaimer.detail, /character 34/);
    assert.equal(result.info.disclaimer, softened, "the instance's own text is kept verbatim");
  });

  it("reports readiness failing without refusing the instance", async () => {
    connectOrigin(BASE);
    stubFetch({
      [`${BASE}/`]: { status: 200, body: info({ disclaimer: SCOPE_STATEMENT }) },
    });
    const result = await connectToInstance(BASE);
    assert.equal(result.kind, "connected");
    if (result.kind !== "connected") return;
    assert.equal(result.readiness, null);
    assert.match(result.readinessFailure ?? "", /Failed to fetch/);
  });

  it("refuses an address the origin rules do not admit, before any request", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.reject(new Error("should not be reached"));
    }) as typeof fetch;

    const result = await connectToInstance("https://clofin.example.com");
    assert.equal(result.kind, "refused");
    assert.equal(called, false, "a refused address must not produce a request");
  });

  it("refuses a non-200 answer, naming what came back", async () => {
    connectOrigin(BASE);
    stubFetch({ [`${BASE}/`]: { status: 404, body: { error: "nope" } } });
    const result = await connectToInstance(BASE);
    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.match(result.reason, /404/);
  });
});

describe("compareDisclaimer", () => {
  it("names the first differing character by index", () => {
    const comparison = compareDisclaimer("CloFin operates on synthetic data mostly.");
    assert.equal(comparison.kind, "differs");
    if (comparison.kind !== "differs") return;
    assert.equal(comparison.at, 34);
    assert.match(comparison.detail, /U\+006F/);
    assert.match(comparison.detail, /U\+006D/);
  });

  it("reports a truncated statement as differing at the end of the text", () => {
    const comparison = compareDisclaimer(SCOPE_STATEMENT.slice(0, 40));
    assert.equal(comparison.kind, "differs");
    if (comparison.kind !== "differs") return;
    assert.equal(comparison.at, 40);
    assert.match(comparison.detail, /end of text/);
  });
});

describe("matchTag", () => {
  const records: readonly ReleaseRecord[] = [
    {
      release: {
        tag: "ref-1",
        name: "ref-1",
        body: REF_1_BODY,
        prerelease: true,
        publishedAt: null,
        htmlUrl: "https://github.com/EchoJustus/clofin-core/releases/tag/ref-1",
      },
      sha: REF_1_SHA,
      coverage: parseCoverage(REF_1_BODY),
    },
  ];

  it("matches only on the tag's dereferenced commit", () => {
    const match = matchTag(REF_1_SHA, records);
    assert.equal(match.kind, "matched");
    if (match.kind !== "matched") return;
    assert.equal(match.tag, "ref-1");
    assert.match(formatTagMatch(match), /PARTIAL — charter items 1-4 of 8/);
  });

  it("says no match rather than showing the nearest tag", () => {
    const match = matchTag("0".repeat(40), records);
    assert.equal(match.kind, "no-match");
    assert.match(formatTagMatch(match), /not any published/);
  });

  it("distinguishes 'not checked' from 'no match', and never renders it as one", () => {
    const match = matchTag(REF_1_SHA, null);
    assert.equal(match.kind, "not-checked");
    const rendered = formatTagMatch(match);
    assert.match(rendered, /not checked/);
    assert.equal(rendered.includes("ref-1"), false, "no tag may appear when none was compared");
  });

  it("refuses to treat anything that is not a commit id as one", () => {
    for (const reported of ["unknown", "main", "ref-1", "(not reported)", REF_1_SHA.slice(0, 7)]) {
      const match = matchTag(reported, records);
      assert.equal(match.kind, "not-a-commit", reported);
      assert.equal(formatTagMatch(match).includes("ref-1 —"), false);
    }
  });

  it("never returns a blank label for any outcome", () => {
    for (const match of [
      matchTag(REF_1_SHA, records),
      matchTag("0".repeat(40), records),
      matchTag(REF_1_SHA, null),
      matchTag("unknown", records),
    ]) {
      assert.notEqual(formatTagMatch(match).trim(), "");
    }
  });
});
