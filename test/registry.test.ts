/**
 * What reaches storage, and what cannot.
 *
 * The registry is the one thing this repository persists, and the risk it
 * carries is not that it fails — it is that it quietly grows. A field added to
 * `RegistryEntry` by a future contributor, or an object passed in carrying more
 * than it should, would end up in a browser store that the README says holds
 * addresses and labels.
 *
 * So the assertion here is not "it round-trips". It is that an entry carrying
 * a synthetic actor id serialises **without** it — the serialiser builds each
 * record field by field from a literal, and this is the test that makes that
 * property visible rather than a comment about the implementation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deserialise, MAX_ENTRIES, MAX_LABEL_LENGTH, serialise } from "../src/registry.js";

const ACTOR_ID = "1e6c2ea0-4a8b-4f19-9a29-5a2f1f5b7c3d";

describe("serialise", () => {
  it("writes the base URL and the label, and nothing else that was passed", () => {
    const smuggled = {
      baseUrl: "http://localhost:8080",
      label: "local",
      // Everything below is what must not reach a browser store. They are
      // typed away, so this is what a JavaScript caller — or a future field —
      // would look like.
      actorId: ACTOR_ID,
      organisationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      credentials: { priya: ACTOR_ID },
    } as unknown as { baseUrl: string; label: string };

    const text = serialise([smuggled]);

    assert.equal(text.includes(ACTOR_ID), false, "an actor id reached storage");
    assert.equal(text.includes("organisationId"), false);
    assert.equal(text.includes("credentials"), false);
    assert.deepEqual(JSON.parse(text), [{ baseUrl: "http://localhost:8080", label: "local" }]);
  });

  it("bounds the label and the number of entries", () => {
    const long = serialise([{ baseUrl: "http://localhost:8080", label: "x".repeat(500) }]);
    assert.equal((JSON.parse(long) as { label: string }[])[0]?.label.length, MAX_LABEL_LENGTH);

    const many = Array.from({ length: MAX_ENTRIES + 10 }, (_, index) => ({
      baseUrl: `http://localhost:${8000 + index}`,
      label: String(index),
    }));
    assert.equal((JSON.parse(serialise(many)) as unknown[]).length, MAX_ENTRIES);
  });
});

describe("deserialise", () => {
  it("reads back what was written", () => {
    const entries = [{ baseUrl: "http://localhost:8080", label: "local" }];
    assert.deepEqual(deserialise(serialise(entries)), entries);
  });

  it("treats stored text as input, not as data it wrote", () => {
    // Another page on the same origin can write this key, and a future version
    // of this file certainly can. Anything that is not the shape written is
    // dropped rather than trusted.
    for (const text of [
      null,
      "",
      "not json",
      "{}",
      '"a string"',
      "[1, 2, 3]",
      '[{"label":"no url"}]',
      '[{"baseUrl":"http://evil.example","label":"off the rules"}]',
      '[{"baseUrl":"javascript:alert(1)","label":"x"}]',
      '[{"baseUrl":42,"label":"x"}]',
    ]) {
      assert.deepEqual(deserialise(text), [], JSON.stringify(text));
    }
  });

  it("re-checks every stored address against the origin rules", () => {
    const mixed = JSON.stringify([
      { baseUrl: "http://localhost:8080", label: "kept" },
      { baseUrl: "https://clofin.example.com", label: "dropped" },
    ]);
    assert.deepEqual(deserialise(mixed), [{ baseUrl: "http://localhost:8080", label: "kept" }]);
  });

  it("normalises and de-duplicates, so one address is one entry", () => {
    const duplicated = JSON.stringify([
      { baseUrl: "http://localhost:8080/", label: "first" },
      { baseUrl: "http://localhost:8080", label: "second" },
    ]);
    assert.deepEqual(deserialise(duplicated), [
      { baseUrl: "http://localhost:8080", label: "first" },
    ]);
  });

  it("drops a field a later version might have added", () => {
    const withExtra = JSON.stringify([
      { baseUrl: "http://localhost:8080", label: "local", actorId: ACTOR_ID },
    ]);
    const [entry] = deserialise(withExtra);
    assert.deepEqual(entry, { baseUrl: "http://localhost:8080", label: "local" });
    assert.equal(JSON.stringify(entry).includes(ACTOR_ID), false);
  });
});
