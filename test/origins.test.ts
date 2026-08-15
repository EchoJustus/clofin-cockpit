/**
 * Which addresses this page will contact, and the policy that says so.
 *
 * Two things are asserted, and the second matters more than the first. The
 * first is that the rule admits what it should and refuses what it should. The
 * second is that the **policy generated from the rule cannot be widened into
 * meaninglessness** — no scheme source, no wildcard, `default-src 'none'` — so
 * that a future contributor loosening `origins.ts` to make something work
 * breaks the build rather than quietly changing what the page may reach.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  connectSources,
  contentSecurityPolicy,
  decideInstanceUrl,
  GITHUB_API_ORIGIN,
  ORIGIN_RULES,
} from "../src/origins.js";

describe("decideInstanceUrl", () => {
  it("accepts a loopback address on any port, over either scheme", () => {
    for (const url of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "https://localhost:8443",
      "http://localhost:8080/",
      "http://localhost:8080///",
    ]) {
      const decision = decideInstanceUrl(url);
      assert.equal(decision.kind, "accepted", url);
    }
  });

  it("strips a trailing slash so a path appends cleanly", () => {
    const decision = decideInstanceUrl("http://localhost:8080/");
    assert.equal(decision.kind, "accepted");
    if (decision.kind !== "accepted") return;
    assert.equal(decision.baseUrl, "http://localhost:8080");
    assert.equal(decision.origin, "http://localhost:8080");
  });

  it("accepts a Codespace's forwarded port", () => {
    const decision = decideInstanceUrl("https://curly-space-goggles-8080.app.github.dev");
    assert.equal(decision.kind, "accepted");
  });

  it("refuses a host that merely ends in the Codespaces domain's letters", () => {
    // The suffix is matched with its leading dot for exactly this case. Without
    // it, an attacker-controlled host could end in the right characters.
    for (const url of [
      "https://evil-app.github.dev.attacker.example",
      "https://notapp.github.devil.example",
    ]) {
      assert.equal(decideInstanceUrl(url).kind, "refused", url);
    }
  });

  it("refuses any other address, and says which shapes it does take", () => {
    for (const url of [
      "http://192.168.1.5:8080",
      "https://clofin.example.com",
      "http://localhost.attacker.example:8080",
      "https://api.github.com",
    ]) {
      const decision = decideInstanceUrl(url);
      assert.equal(decision.kind, "refused", url);
      if (decision.kind !== "refused") return;
      assert.match(decision.reason, /may only contact/);
    }
  });

  it("refuses a URL carrying credentials", () => {
    const decision = decideInstanceUrl("http://someone:secret@localhost:8080");
    assert.equal(decision.kind, "refused");
    if (decision.kind !== "refused") return;
    assert.match(decision.reason, /credentials/);
  });

  it("refuses a scheme a page cannot fetch, and text that is not a URL at all", () => {
    for (const url of ["file:///etc/passwd", "localhost:8080", "", "   ", "not a url"]) {
      assert.equal(decideInstanceUrl(url).kind, "refused", JSON.stringify(url));
    }
  });

  it("reports whether an address is plain http, so the interface can warn", () => {
    const plain = decideInstanceUrl("http://localhost:8080");
    const secure = decideInstanceUrl("https://localhost:8443");
    assert.equal(plain.kind === "accepted" && plain.plainHttp, true);
    assert.equal(secure.kind === "accepted" && secure.plainHttp, false);
  });
});

describe("the Content-Security-Policy generated from the rule", () => {
  const policy = contentSecurityPolicy();

  it("carries the four directives that make the rest of it mean anything", () => {
    for (const directive of [
      "default-src 'none'",
      "script-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      assert.ok(policy.includes(directive), `${directive} is missing from: ${policy}`);
    }
  });

  it("names no scheme source and no wildcard, which would be every host there is", () => {
    for (const forbidden of [/(^|[;\s])https?:([;\s]|$)/, /(^|[;\s])\*([;\s]|$)/]) {
      assert.equal(forbidden.test(policy), false, `${policy} matches ${forbidden}`);
    }
  });

  it("permits no inline script or style", () => {
    assert.equal(policy.includes("'unsafe-inline'"), false);
    assert.equal(policy.includes("'unsafe-eval'"), false);
  });

  it("lists exactly the sources the rule produces, and nothing else", () => {
    const listed = policy.match(/connect-src ([^;]+)/)?.[1]?.split(" ") ?? [];
    assert.deepEqual([...listed].sort(), [...connectSources()].sort());
    assert.ok(listed.includes(GITHUB_API_ORIGIN));
    assert.ok(listed.includes("'self'"));
  });

  it("has a source for every rule, and a rule for every source", () => {
    // The two lists in `origins.ts` are the same decision written twice — the
    // predicate a request is checked against, and the sources a browser is
    // given. A rule whose sources did not cover it would refuse in the browser
    // what this page permits, which is the opaque failure mode.
    for (const rule of ORIGIN_RULES) {
      assert.ok(rule.cspSources.length > 0, `${rule.label} contributes no source`);
      for (const source of rule.cspSources) {
        const sample = source.replace(":*", ":8080").replace("*.", "example.");
        const decision = decideInstanceUrl(sample);
        assert.equal(decision.kind, "accepted", `${sample} is a source but not an accepted URL`);
      }
    }
  });
});
