/**
 * Mapping the two API responses into release records.
 *
 * The join is the part worth testing hard. The Releases API does not report
 * the commit a tag points at, so the SHA comes from the Tags API and the two
 * are matched by tag name. Getting that wrong would put a confident, wrong
 * commit under a frame that promises provenance — which is worse than showing
 * none, and is why an unmatched tag yields `null` rather than a fallback.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCoverage } from "../src/coverage.js";
import { buildReleaseRecords, shortSha } from "../src/releases.js";
import { releaseJson, REF_1_SHA, tagJson } from "./fixtures.js";

describe("buildReleaseRecords", () => {
  it("joins ref-1 to its commit and parses its coverage (AC-2, end to end)", () => {
    const [record] = buildReleaseRecords([releaseJson()], [tagJson()]);

    assert.ok(record);
    assert.equal(record.release.tag, "ref-1");
    assert.equal(record.sha, REF_1_SHA);
    assert.equal(record.release.prerelease, true);
    assert.equal(formatCoverage(record.coverage), "PARTIAL — charter items 1-4 of 8");
    assert.equal(shortSha(record.sha), "5c7b4ba");
  });

  it("never falls back to target_commitish, which is a branch name and moves", () => {
    const records = buildReleaseRecords([releaseJson({ target_commitish: "main" })], []);
    assert.equal(records[0]?.sha, null);
    assert.equal(shortSha(records[0]?.sha ?? null), "unknown");
  });

  it("ignores tags that are not ref-<n>", () => {
    const records = buildReleaseRecords(
      [releaseJson({ tag_name: "v1.0.0" }), releaseJson({ tag_name: "nightly" }), releaseJson()],
      [tagJson()],
    );
    assert.deepEqual(records.map((record) => record.release.tag), ["ref-1"]);
  });

  it("ignores drafts, which no one else can see", () => {
    const records = buildReleaseRecords([releaseJson({ tag_name: "ref-2", draft: true })], []);
    assert.equal(records.length, 0);
  });

  it("treats a missing prerelease flag as a pre-release, not as general availability", () => {
    const records = buildReleaseRecords([releaseJson({ prerelease: undefined })], []);
    assert.equal(records[0]?.release.prerelease, true);
  });

  it("rejects a malformed commit SHA rather than displaying it", () => {
    const records = buildReleaseRecords([releaseJson()], [tagJson("ref-1", "5c7b4ba")]);
    assert.equal(records[0]?.sha, null);
  });

  it("lists the newest release first", () => {
    const records = buildReleaseRecords(
      [releaseJson({ tag_name: "ref-1" }), releaseJson({ tag_name: "ref-10" }), releaseJson({ tag_name: "ref-2" })],
      [],
    );
    assert.deepEqual(records.map((record) => record.release.tag), ["ref-10", "ref-2", "ref-1"]);
  });

  it("survives responses that are not the shape it expected", () => {
    for (const nonsense of [null, undefined, {}, "", 42, [null, 7, { tag_name: 3 }]]) {
      assert.doesNotThrow(() => buildReleaseRecords(nonsense, nonsense));
      assert.equal(buildReleaseRecords(nonsense, nonsense).length, 0);
    }
  });

  it("gives a release with no body a not-found coverage rather than a blank", () => {
    const records = buildReleaseRecords([releaseJson({ body: "" })], [tagJson()]);
    assert.equal(formatCoverage(records[0]?.coverage ?? { kind: "not-found", reason: "" }), "coverage statement not found");
  });
});
