/**
 * The coverage parser, and mostly the ways it refuses.
 *
 * Two acceptance criteria live here. **AC-2**: `ref-1` renders
 * `PARTIAL — charter items 1-4 of 8`, parsed from the release body rather than
 * typed anywhere. **AC-3**: a body with no `RELEASE AUDIT:` paragraph renders
 * as "coverage statement not found" and the suite still passes — the missing
 * statement is an expected input, not an error.
 *
 * The rest of these are the fail-closed cases. Each one asserts two things:
 * that the result is `not-found`, and that the label the reader sees contains
 * no word that could be mistaken for reassurance.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COVERAGE_NOT_FOUND_LABEL,
  formatCoverage,
  parseCoverage,
} from "../src/coverage.js";
import { REF_1_BODY } from "./fixtures.js";

/** No refusal may read as an assurance. */
function assertSaysNothingReassuring(label: string): void {
  assert.equal(label, COVERAGE_NOT_FOUND_LABEL);
  assert.doesNotMatch(label, /\b(audited|verified|reviewed|full|complete|ok|passed)\b/i);
  assert.notEqual(label.trim(), "");
}

describe("parseCoverage — the real ref-1 release body (AC-2)", () => {
  const coverage = parseCoverage(REF_1_BODY);

  it("reads the coverage from the RELEASE AUDIT: paragraph", () => {
    assert.equal(coverage.kind, "stated");
    assert.equal(coverage.kind === "stated" && coverage.status, "PARTIAL");
    assert.equal(coverage.kind === "stated" && coverage.scope, "charter items 1-4 of 8");
  });

  it("renders exactly “PARTIAL — charter items 1-4 of 8”", () => {
    assert.equal(formatCoverage(coverage), "PARTIAL — charter items 1-4 of 8");
  });

  it("is not confused by the prose sentence about the release audit", () => {
    // The body's second paragraph says "The release audit is an internal
    // quality gate." — prose, no colon, not a declaration. Requiring the marker
    // to open a paragraph is what keeps that out.
    assert.ok(REF_1_BODY.includes("The release audit is an internal quality gate."));
    assert.equal(coverage.kind, "stated");
  });

  it("keeps the paragraph it read, so the page can show its own source", () => {
    assert.ok(coverage.kind === "stated" && coverage.paragraph.startsWith("RELEASE AUDIT: PARTIAL."));
  });
});

describe("parseCoverage — fails closed (AC-3)", () => {
  it("says not found when there is no RELEASE AUDIT: paragraph", () => {
    const coverage = parseCoverage("A release with plenty of prose and no coverage statement.");
    assert.equal(coverage.kind, "not-found");
    assertSaysNothingReassuring(formatCoverage(coverage));
  });

  it("says not found for an empty, blank, null or undefined body", () => {
    for (const body of ["", "   \n\n  ", null, undefined]) {
      const coverage = parseCoverage(body);
      assert.equal(coverage.kind, "not-found", `body ${JSON.stringify(body)}`);
      assertSaysNothingReassuring(formatCoverage(coverage));
    }
  });

  it("refuses a coverage word this project has not defined", () => {
    const coverage = parseCoverage("RELEASE AUDIT: MOSTLY. Charter items 1-7 of 8 were performed.");
    assert.equal(coverage.kind, "not-found");
    assert.match(coverage.kind === "not-found" ? coverage.reason : "", /MOSTLY/);
    assertSaysNothingReassuring(formatCoverage(coverage));
  });

  it("refuses when two paragraphs declare coverage", () => {
    const body = [
      "RELEASE AUDIT: FULL. All 8 charter items were performed.",
      "",
      "RELEASE AUDIT: PARTIAL. Charter items 1-4 of 8 were performed.",
    ].join("\n");

    const coverage = parseCoverage(body);
    assert.equal(coverage.kind, "not-found");
    assert.match(coverage.kind === "not-found" ? coverage.reason : "", /2 paragraphs/);
    assertSaysNothingReassuring(formatCoverage(coverage));
  });

  it("refuses a marker buried inside a sentence", () => {
    const coverage = parseCoverage("For the RELEASE AUDIT: see the annotation file in the repository.");
    assert.equal(coverage.kind, "not-found");
    assertSaysNothingReassuring(formatCoverage(coverage));
  });

  it("never returns a blank label for any input", () => {
    const bodies = ["", "x", "RELEASE AUDIT:", "RELEASE AUDIT: .", "RELEASE AUDIT: 42."];
    for (const body of bodies) {
      assert.notEqual(formatCoverage(parseCoverage(body)).trim(), "", `body ${JSON.stringify(body)}`);
    }
  });
});

describe("parseCoverage — statuses and scopes it does understand", () => {
  it("reads a full audit stated as all N charter items", () => {
    const coverage = parseCoverage("RELEASE AUDIT: FULL. All 8 charter items were performed.");
    assert.equal(formatCoverage(coverage), "FULL — all 8 charter items");
  });

  it("reads NONE", () => {
    const coverage = parseCoverage("RELEASE AUDIT: NONE. No release audit was performed for this tag.");
    assert.equal(coverage.kind === "stated" && coverage.status, "NONE");
  });

  it("keeps the status but says so when the scope is missing", () => {
    const coverage = parseCoverage("RELEASE AUDIT: PARTIAL. Some of it was done.");
    assert.equal(formatCoverage(coverage), "PARTIAL — scope not stated in the release body");
  });

  it("copes with CRLF line endings and hard wrapping", () => {
    const wrapped = "RELEASE AUDIT: PARTIAL. Charter items 1-4\r\nof 8 were performed.";
    assert.equal(formatCoverage(parseCoverage(wrapped)), "PARTIAL — charter items 1-4 of 8");
  });

  it("accepts a lower-case marker but still refuses an undefined level", () => {
    assert.equal(parseCoverage("Release audit: partial. Charter items 1-4 of 8.").kind, "stated");
    assert.equal(parseCoverage("Release audit: probably.").kind, "not-found");
  });
});
