/**
 * Recent scenario runs: GitHub's words, and no word of ours.
 *
 * Two properties, both of them about not inventing anything:
 *
 * - a run still going has **no conclusion**, and that absence stays an absence.
 *   Rendering a neutral-sounding word there — "pending", "ok", "unknown" —
 *   would be this repository describing somebody else's state in language
 *   nobody can check against the API;
 * - a status is passed through exactly as it arrives, `in_progress` and all.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRuns, describeConclusion } from "../src/runs.js";
import { SCENARIO_WORKFLOW_FILE, SCENARIO_WORKFLOW_URL, scenarioRunsUrl } from "../src/cockpit-repo.js";

function runJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    run_number: 7,
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-15T18:00:00Z",
    display_title: "Scenario run",
    event: "workflow_dispatch",
    html_url: "https://github.com/EchoJustus/clofin-cockpit/actions/runs/42",
    ...overrides,
  };
}

describe("the runs list is mapped, never interpreted", () => {
  it("keeps GitHub's own status and conclusion words", () => {
    const [run] = buildRuns({ workflow_runs: [runJson()] });
    assert.equal(run?.status, "completed");
    assert.equal(run?.conclusion, "success");
    assert.equal(describeConclusion(run!), "success");
  });

  it("keeps a failure a failure", () => {
    const [run] = buildRuns({ workflow_runs: [runJson({ conclusion: "failure" })] });
    assert.equal(describeConclusion(run!), "failure");
  });

  it("reports a run still going as having no conclusion yet", () => {
    const [run] = buildRuns({
      workflow_runs: [runJson({ status: "in_progress", conclusion: null })],
    });
    assert.equal(run?.conclusion, null);
    assert.equal(describeConclusion(run!), "in_progress — no conclusion yet");
    // The one thing it must never read as.
    assert.doesNotMatch(describeConclusion(run!), /success/);
  });

  it("treats a missing conclusion member the same as a null one", () => {
    const json = runJson();
    delete json["conclusion"];
    const [run] = buildRuns({ workflow_runs: [json] });
    assert.equal(run?.conclusion, null);
  });

  it("drops an entry with no link, rather than rendering one that goes nowhere", () => {
    const json = runJson();
    delete json["html_url"];
    assert.deepEqual(buildRuns({ workflow_runs: [json] }), []);
  });

  it("answers an unexpected shape with an empty list rather than throwing", () => {
    assert.deepEqual(buildRuns(null), []);
    assert.deepEqual(buildRuns({ workflow_runs: "lots" }), []);
    assert.deepEqual(buildRuns({}), []);
    assert.deepEqual(buildRuns({ workflow_runs: [1, "two", null] }), []);
  });

  it("says so when a field is missing rather than inventing a value", () => {
    const [run] = buildRuns({ workflow_runs: [{ html_url: "https://github.com/x/y/actions/runs/1" }] });
    assert.equal(run?.status, "(not stated)");
    assert.equal(run?.event, "(not stated)");
    assert.equal(run?.createdAt, null);
  });
});

describe("the workflow is addressed by one file name", () => {
  it("links the page and the API read to the same workflow", () => {
    assert.ok(SCENARIO_WORKFLOW_URL.endsWith(SCENARIO_WORKFLOW_FILE));
    assert.ok(scenarioRunsUrl("https://api.github.com").includes(SCENARIO_WORKFLOW_FILE));
  });

  it("reads runs from the API origin it is given, and no other", () => {
    const url = scenarioRunsUrl("https://api.github.com");
    assert.ok(url.startsWith("https://api.github.com/"));
    assert.match(url, /repos\/EchoJustus\/clofin-cockpit\/actions\/workflows\//);
  });
});
