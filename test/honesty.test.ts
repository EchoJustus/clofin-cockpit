/**
 * The honesty layer: the constant, the frame it renders into, and the rule
 * that tag, commit and coverage are never shown apart.
 *
 * The frame is asserted here as well as by `scope-verbatim` because the two
 * ask different questions. The check asks whether the *built site* is honest;
 * these ask whether the code can produce a dishonest one. A repository that
 * only checked its output would find out at the end of the build what it could
 * have known when the function was written.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCoverage } from "../src/coverage.js";
import { honestyFrameHtml, NO_RELEASE_IN_CONTEXT, PROVENANCE_MARKER, SCOPE_MARKER } from "../src/frame.js";
import { PROVENANCE_LABELS, provenanceFields, SHA_NOT_FOUND_LABEL } from "../src/provenance.js";
import type { ReleaseRecord } from "../src/releases.js";
import { SCOPE_STATEMENT } from "../src/scope.js";
import { REF_1_BODY, REF_1_SHA } from "./fixtures.js";

/**
 * `clofin-core`'s `GET /` disclaimer, written out here independently of
 * `src/scope.ts`. If someone edits the constant, this fails — which is the
 * point: the constant is a quotation, and a quotation that can be edited
 * silently is not one.
 *
 * Source: clofin-core src/clofin/api/health.clj, the `info` handler.
 */
const GET_ROOT_DISCLAIMER =
  "CloFin operates on synthetic data only. It is not connected to any bank, " +
  "payment scheme or central bank, holds no regulatory authorisation, and " +
  "never processes real funds.";

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

describe("the scope statement", () => {
  it("is clofin-core's GET / disclaimer, character for character", () => {
    assert.equal(SCOPE_STATEMENT, GET_ROOT_DISCLAIMER);
  });

  it("still says the four things it exists to say", () => {
    for (const clause of [
      "synthetic data only",
      "not connected to any bank",
      "holds no regulatory authorisation",
      "never processes real funds",
    ]) {
      assert.ok(SCOPE_STATEMENT.includes(clause), `missing: ${clause}`);
    }
  });
});

describe("the honesty frame", () => {
  const html = honestyFrameHtml();

  it("carries the statement in a marked element whose text is exactly the constant", () => {
    const match = new RegExp(`<p[^>]*\\b${SCOPE_MARKER}\\b[^>]*>([^<]*)</p>`).exec(html);
    assert.ok(match, "the frame has no marked scope-statement element");
    assert.equal(match[1], SCOPE_STATEMENT);
  });

  it("has a provenance region, so a release always has somewhere to be stamped", () => {
    assert.ok(html.includes(PROVENANCE_MARKER));
    assert.ok(html.includes(NO_RELEASE_IN_CONTEXT));
  });

  it("attributes the quotation to where it came from", () => {
    assert.match(html, /Quoted verbatim from/);
    assert.match(html, /clofin-core/);
  });

  it("offers no way to dismiss it", () => {
    assert.doesNotMatch(html, /<button/i);
    assert.doesNotMatch(html, /dismiss|close|hide/i);
  });
});

describe("provenance — tag, commit and coverage, or nothing", () => {
  it("always returns exactly three fields, in a fixed order", () => {
    const fields = provenanceFields(record());
    assert.equal(fields.length, 3);
    assert.deepEqual(
      fields.map((field) => field.label),
      [PROVENANCE_LABELS.tag, PROVENANCE_LABELS.commit, PROVENANCE_LABELS.coverage],
    );
  });

  it("stamps ref-1 with its tag, its commit and PARTIAL — charter items 1-4 of 8", () => {
    const [tag, commit, coverage] = provenanceFields(record());
    assert.equal(tag.value, "ref-1");
    assert.equal(tag.qualifier, "pre-release");
    assert.equal(commit.value, REF_1_SHA);
    assert.equal(coverage.value, "PARTIAL — charter items 1-4 of 8");
  });

  it("still shows all three when the commit is unknown", () => {
    const [tag, commit, coverage] = provenanceFields(record({ sha: null }));
    assert.equal(tag.value, "ref-1");
    assert.equal(commit.value, SHA_NOT_FOUND_LABEL);
    assert.ok(coverage.value.length > 0);
  });

  it("still shows all three when the coverage cannot be read", () => {
    const [tag, commit, coverage] = provenanceFields(
      record({ coverage: parseCoverage("no statement here") }),
    );
    assert.equal(tag.value, "ref-1");
    assert.equal(commit.value, REF_1_SHA);
    assert.equal(coverage.value, "coverage statement not found");
  });

  it("never leaves a field blank, whatever it is given", () => {
    const awkward = record({ sha: null, coverage: parseCoverage("") });
    for (const field of provenanceFields(awkward)) {
      assert.notEqual(field.value.trim(), "", `${field.label} was blank`);
    }
  });

  it("drops the pre-release qualifier only when the release is not one", () => {
    const [tag] = provenanceFields(record({ release: { ...record().release, prerelease: false } }));
    assert.equal(tag.qualifier, null);
  });
});
