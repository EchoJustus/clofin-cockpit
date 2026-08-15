/**
 * No figure on any screen originates in this repository.
 *
 * This is the mechanical half of the claim the cockpit makes most loudly. The
 * other half is in `tools/guard-network.mjs`, which refuses to publish a site
 * containing a number formatter or arithmetic on a money identifier; between
 * them, "the cockpit computes no figure" is a property rather than a promise.
 *
 * The central assertion below is deliberately crude, and crude is the point:
 * **the text of every figure appears verbatim in the response body it was read
 * from.** A figure that had been scaled, rounded, summed or localised would not
 * survive a substring check against its own source, so the test does not need
 * to know which transformation was applied to catch that one was.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ABSENT, figureText, found, readFigure, valueAt } from "../src/figures.js";

/** A real account-statement body, trimmed to the members these tests read. */
const STATEMENT = JSON.stringify({
  account: { id: "6e6fa50f", code: "1300-IN-TRANSIT", currency: "SGD", normalBalance: "debit" },
  openingBalance: { currency: "SGD", minorUnits: 0 },
  closingBalance: { currency: "SGD", minorUnits: 375000 },
  movements: [
    { direction: "debit", amount: { currency: "SGD", minorUnits: 125000 } },
    { direction: "debit", amount: { currency: "SGD", minorUnits: 250000 } },
  ],
  truncated: false,
  movementCap: 500,
});

describe("a figure is the response's own value", () => {
  it("renders minor units exactly as they arrived, with no conversion", () => {
    const figure = readFigure(STATEMENT, "closingBalance");
    assert.equal(figure.text, '{"currency":"SGD","minorUnits":375000}');
    // The thing that must never appear.
    assert.doesNotMatch(figureText(figure), /3,750|3750\.00/);
  });

  it("appears verbatim in the body it was read from", () => {
    for (const path of [
      "closingBalance",
      "openingBalance",
      "account.code",
      "movements.0.amount",
      "movements.1.amount.minorUnits",
      "truncated",
      "movementCap",
    ]) {
      const figure = readFigure(STATEMENT, path);
      assert.ok(found(figure), `${path} should be found`);
      const text = figure.text ?? "";
      // Strings are quoted in the projection and in the body alike, so the
      // comparison is against the body's own bytes either way.
      assert.ok(
        STATEMENT.includes(text),
        `the projection of ${path} (${text}) is not a substring of the body it came from`,
      );
    }
  });

  it("never sums anything, even when the members are obviously summable", () => {
    // The two movements add to the closing balance. A page that helped would
    // produce 375000 from the movements; this one produces the array.
    const figure = readFigure(STATEMENT, "movements");
    assert.ok(figure.text?.startsWith("["), "the movements render as the list they are");
    assert.ok(STATEMENT.includes(figure.text ?? ""));
  });
});

describe("a figure that is not there", () => {
  it("says so rather than standing in for a zero", () => {
    const figure = readFigure(STATEMENT, "closingBalanceInDollars");
    assert.equal(figure.text, null);
    assert.equal(found(figure), false);
    assert.equal(figureText(figure), ABSENT);
    assert.doesNotMatch(figureText(figure), /0/, "absence never renders as a number");
  });

  it("treats a missing body, an unparseable body and a missing path alike", () => {
    assert.equal(readFigure(null, "closingBalance").text, null);
    assert.equal(readFigure("not json at all", "closingBalance").text, null);
    assert.equal(readFigure("{}", "closingBalance").text, null);
  });

  it("does not walk into a value that is not an object", () => {
    assert.equal(readFigure(STATEMENT, "truncated.somethingElse").text, null);
    assert.equal(readFigure(STATEMENT, "movements.notAnIndex").text, null);
  });

  it("keeps a null the instance sent distinct from a path that was absent", () => {
    // `null` is an answer: an item with no outcome yet reports `"outcome": null`,
    // and rendering that as "not in the response" would be reporting a
    // different fact.
    const body = JSON.stringify({ outcome: null });
    assert.equal(readFigure(body, "outcome").text, "null");
    assert.equal(readFigure(body, "missing").text, null);
  });
});

describe("valueAt", () => {
  it("returns the parsed value, so the runner and the screen walk the same path", () => {
    assert.equal(valueAt(STATEMENT, "account.code"), "1300-IN-TRANSIT");
    assert.equal(valueAt(STATEMENT, "movements.1.amount.minorUnits"), 250000);
    assert.equal(valueAt(STATEMENT, "nope"), undefined);
  });

  it("reads an array index the way a capture path expects", () => {
    const body = JSON.stringify({ breaks: [{ id: "break-1", kind: "amount-mismatch" }] });
    assert.equal(valueAt(body, "breaks.0.id"), "break-1");
    assert.equal(valueAt(body, "breaks.0.kind"), "amount-mismatch");
    assert.equal(valueAt(body, "breaks.1.id"), undefined);
  });
});
