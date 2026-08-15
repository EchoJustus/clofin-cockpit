/**
 * The profiles this build ships, and what a malformed one does.
 *
 * The first suite reads the actual JSON documents from disk. That is
 * deliberate: a profile is executed against somebody's running instance, and a
 * typo in it would otherwise be found by the instance rather than by the test
 * suite. Every step is checked for the things that make a run honest — an
 * account create has a precheck, a manual step has something that verifies it
 * through the API and says what it cannot show, every actor a step acts as is
 * one the profile mints.
 *
 * The second suite is about refusing. A profile that does not validate is not
 * run with a default in place of the missing part.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PROFILE_IDS, readProfile, SUPPORTED_FORMAT_VERSION } from "../src/profiles.js";

/** Resolved from the repository root, which is where `node --test` is run. */
function load(id: string): { document: unknown; raw: string } {
  const raw = readFileSync(join("profiles", `${id}.json`), "utf8");
  return { document: JSON.parse(raw) as unknown, raw };
}

describe("the shipped profiles", () => {
  for (const id of PROFILE_IDS) {
    describe(id, () => {
      const { document, raw } = load(id);
      const result = readProfile(document, raw);

      it("is a valid profile document", () => {
        assert.equal(result.kind, "profile", result.kind === "refused" ? result.reason : "");
      });

      if (result.kind !== "profile") return;
      const profile = result.profile;

      it("declares the id its filename claims, and this format version", () => {
        assert.equal(profile.id, id);
        assert.equal(profile.formatVersion, SUPPORTED_FORMAT_VERSION);
        assert.match(profile.version, /^\d+\.\d+\.\d+$/);
      });

      it("says where its seed data comes from", () => {
        assert.ok(profile.source.length > 20, "a profile that cites nothing cannot be checked");
      });

      it("begins by creating the organisation, unauthenticated", () => {
        const first = profile.steps[0];
        assert.equal(first?.kind, "request");
        if (first?.kind !== "request") return;
        assert.equal(first.method, "POST");
        assert.equal(first.path, "/organisations");
        assert.equal(first.as, null, "no actor can exist before the organisation that holds one");
        assert.deepEqual(first.expect, [201]);
        assert.equal(first.capture["organisationId"], "id");
      });

      it("declares what a 409 means everywhere one can happen", () => {
        for (const step of profile.steps) {
          if (step.kind !== "request" || step.method !== "POST") continue;
          assert.ok(
            step.conflict,
            `${step.id} can be refused for existing already and does not say what that means`,
          );
          assert.ok(step.conflict.statuses.includes(409));
          assert.ok(step.conflict.note.length > 20);
        }
      });

      it("reads before it creates an account, so a re-run does not create twice", () => {
        const accounts = profile.steps.filter(
          (step) => step.kind === "request" && step.path === "/accounts" && step.method === "POST",
        );
        assert.ok(accounts.length >= 3, "the chart is at least the three UAT accounts");
        for (const step of accounts) {
          if (step.kind !== "request") continue;
          assert.ok(step.precheck, `${step.id} has no precheck, so a re-run would ask twice`);
          assert.equal(step.precheck.method, "GET");
          assert.equal(
            step.precheck.presentWhen.equals,
            (step.body as { code: string }).code,
            "the precheck must look for the code this step would create",
          );
        }
      });

      it("has a manual step for everything CloFin has no endpoint for", () => {
        const manual = profile.steps.filter((step) => step.kind === "manual");
        assert.ok(manual.length >= 2, "actors/roles and thresholds both lack an endpoint");
        for (const step of manual) {
          if (step.kind !== "manual") continue;
          assert.ok(step.statements.length > 0);
          assert.ok(step.howToRun.length > 0, "an operator has to be told how to run them");
          assert.ok(step.verify.proves.length > 20, "a verification must say what it demonstrates");
          assert.ok(
            step.unverifiable.length > 0,
            `${step.id} claims its API check covers everything, which no manual step's does`,
          );
        }
      });

      it("mints every actor any step acts as", () => {
        const keys = new Set(profile.actors.map((actor) => actor.key));
        for (const step of profile.steps) {
          const named =
            step.kind === "request" ? [step.as, step.precheck?.as ?? null] : [step.verify.as];
          for (const key of named) {
            if (key !== null) assert.ok(keys.has(key), `${step.id} acts as unminted ${key}`);
          }
        }
      });

      it("puts every actor id it inserts into the SQL through a placeholder", () => {
        for (const step of profile.steps) {
          if (step.kind !== "manual") continue;
          for (const statement of step.statements) {
            assert.doesNotMatch(
              statement,
              /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
              "a literal UUID in a profile would be a credential committed to this repository",
            );
          }
        }
      });

      it("names no host, so a profile cannot choose its own destination", () => {
        assert.doesNotMatch(raw, /https?:\/\//, "every path is joined to the connected instance");
      });

      it("declares a threshold table, per currency", () => {
        assert.ok(profile.thresholds.length > 0);
        for (const threshold of profile.thresholds) {
          assert.match(threshold.currency, /^[A-Z]{3}$/);
          assert.ok(Number.isInteger(threshold.fromMinor) && threshold.fromMinor >= 0);
          assert.ok(threshold.approvalsRequired >= 1);
        }
      });
    });
  }

  it("ships two profiles that are genuinely different policies", () => {
    const [standard, highValue] = PROFILE_IDS.map((id) => {
      const { document, raw } = load(id);
      const result = readProfile(document, raw);
      if (result.kind !== "profile") assert.fail(`${id} is invalid`);
      return result.profile;
    });
    assert.ok(standard && highValue);
    assert.notDeepEqual(standard.thresholds, highValue.thresholds);
    assert.notEqual(
      (standard.steps[0] as { body: { shortName: string } }).body.shortName,
      (highValue.steps[0] as { body: { shortName: string } }).body.shortName,
      "two profiles sharing a short name could not both run on one instance",
    );
  });
});

describe("readProfile refuses rather than defaults", () => {
  const valid = {
    id: "x",
    formatVersion: 1,
    version: "1.0.0",
    title: "t",
    summary: "s",
    source: "somewhere",
    actors: [{ key: "sam", displayName: "Sam", roles: ["controller"], limits: [] }],
    thresholds: [],
    steps: [
      {
        kind: "request",
        id: "one",
        title: "t",
        why: "w",
        method: "GET",
        path: "/accounts",
        as: "sam",
        expect: [200],
      },
    ],
  };

  it("accepts the valid document above", () => {
    assert.equal(readProfile(valid, "").kind, "profile");
  });

  type Mutation = (document: Record<string, unknown>) => void;
  const step = (document: Record<string, unknown>): Record<string, unknown> =>
    (document["steps"] as Record<string, unknown>[])[0] as Record<string, unknown>;

  const mutations: Readonly<Record<string, Mutation>> = {
    "a format version it does not read": (d) => {
      d["formatVersion"] = 2;
    },
    "no steps at all": (d) => {
      d["steps"] = [];
    },
    "a step kind it does not know": (d) => {
      step(d)["kind"] = "shell";
    },
    "a method CloFin's API does not use": (d) => {
      step(d)["method"] = "PUT";
    },
    "an absolute URL instead of a path": (d) => {
      step(d)["path"] = "https://evil.example/accounts";
    },
    "a protocol-relative path": (d) => {
      step(d)["path"] = "//evil.example/accounts";
    },
    "a path that is not one": (d) => {
      step(d)["path"] = "accounts";
    },
    "an actor it does not declare": (d) => {
      step(d)["as"] = "nobody";
    },
    "an expectation that is not a status": (d) => {
      step(d)["expect"] = ["ok"];
    },
    "no expectation at all": (d) => {
      delete step(d)["expect"];
    },
    "a manual step with nothing that verifies it": (d) => {
      d["steps"] = [
        { kind: "manual", id: "m", title: "t", why: "w", statements: ["x"], howToRun: ["y"], unverifiable: [] },
      ];
    },
    "two steps sharing an id": (d) => {
      d["steps"] = [step(d), JSON.parse(JSON.stringify(step(d))) as unknown];
    },
  };

  for (const [label, mutate] of Object.entries(mutations)) {
    it(`refuses ${label}`, () => {
      const document = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
      mutate(document);
      const result = readProfile(document, "");
      assert.equal(result.kind, "refused", `${label} was accepted`);
      if (result.kind !== "refused") return;
      assert.ok(result.reason.length > 0, "a refusal has to say what was wrong");
    });
  }

  it("refuses a document that is not an object at all", () => {
    for (const document of [null, "a string", 42, [], undefined]) {
      assert.equal(readProfile(document, "").kind, "refused", JSON.stringify(document));
    }
  });
});
