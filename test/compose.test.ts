/**
 * The deployment card — AC-7.
 *
 * The card's whole claim is that it is pinned: the commands name the tag a
 * person asked for, and verify the commit the cockpit displayed. These tests
 * assert both halves are present, that the commands are the ones
 * `clofin-core`'s Makefile actually offers, and that the card refuses to exist
 * rather than lose the pin.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeCard, composeScript } from "../src/compose.js";
import { parseCoverage } from "../src/coverage.js";
import type { ReleaseRecord } from "../src/releases.js";
import { REF_1_BODY, REF_1_SHA } from "./fixtures.js";

function record(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    release: {
      tag: "ref-1",
      name: "CloFin reference implementation, first tagged release",
      body: REF_1_BODY,
      prerelease: true,
      publishedAt: "2026-08-05T10:34:54Z",
      htmlUrl: "https://github.com/EchoJustus/clofin-core/releases/tag/ref-1",
    },
    sha: REF_1_SHA,
    coverage: parseCoverage(REF_1_BODY),
    ...overrides,
  };
}

describe("composeCard — pinned to the tag and the commit (AC-7)", () => {
  const card = composeCard(record());
  assert.equal(card.kind, "card");
  const script = card.kind === "card" ? composeScript(card) : "";

  it("clones clofin-core and checks out the tag by name", () => {
    assert.match(script, /git clone https:\/\/github\.com\/EchoJustus\/clofin-core\.git/);
    assert.match(script, /git checkout ref-1/);
  });

  it("verifies the commit the cockpit displayed, so a moved tag stops the script", () => {
    assert.ok(script.includes(`test "$(git rev-parse HEAD)" = "${REF_1_SHA}"`));
  });

  it("brings the stack up and checks it, with the targets clofin-core defines", () => {
    assert.match(script, /\bmake up\b/);
    assert.match(script, /\bmake health\b/);
    assert.match(script, /\bmake down\b/);
  });

  it("chains with && so a failed step stops the rest", () => {
    const fetchBlock = card.kind === "card" ? card.blocks[0]?.commands ?? [] : [];
    for (const line of fetchBlock.slice(0, -1)) {
      assert.ok(line.trimEnd().endsWith("&&"), `expected ${JSON.stringify(line)} to chain`);
    }
    assert.ok(!(fetchBlock.at(-1) ?? "").trimEnd().endsWith("&&"), "the last line must not dangle");
  });

  it("names both the tag and the commit in the script header", () => {
    assert.match(script, /# CloFin reference instance — ref-1/);
    assert.ok(script.includes(`# Commit ${REF_1_SHA}`));
  });

  it("carries the scope reminder into the copied text, which travels without the page", () => {
    assert.match(script, /Synthetic data only/);
  });

  it("executes nothing itself — the card is only text", () => {
    // Every command is a string; there is no callable anywhere in the card.
    const blocks = card.kind === "card" ? card.blocks : [];
    for (const block of blocks) {
      for (const command of block.commands) assert.equal(typeof command, "string");
    }
  });
});

describe("composeCard — refuses rather than losing the pin", () => {
  it("generates no card when the tag's commit is unknown", () => {
    const refused = composeCard(record({ sha: null }));
    assert.equal(refused.kind, "refused");
    assert.match(refused.kind === "refused" ? refused.reason : "", /cannot be pinned/);
  });

  it("has no deploy-from-main variant", () => {
    const card = composeCard(record());
    const script = card.kind === "card" ? composeScript(card) : "";
    assert.doesNotMatch(script, /checkout main\b/);
    assert.doesNotMatch(script, /\borigin\/main\b/);
  });
});
