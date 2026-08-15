/**
 * Seed profiles: what a bootstrap run will do, written down before it does it.
 *
 * A profile is **data** — a versioned JSON document in `profiles/`, served
 * beside this page and fetched at runtime, so the document the deployed
 * cockpit executes is a file you can `curl` and diff against the repository.
 * The runner in `bootstrap.ts` is **code**, and it contains no organisation
 * name, no actor, no account code and no threshold. Neither embeds the other,
 * which is what makes "here is exactly what it will do" checkable rather than
 * asserted.
 *
 * The profile lists **every call, one step per call**. There is deliberately no
 * loop construct, no "repeat over this list" and no template expansion that
 * turns one declaration into three requests: a reader counting the steps in the
 * file is counting the requests the instance will receive. A longer file is the
 * price, and it is the right way round for a document whose purpose is to be
 * read before it is run.
 *
 * ## Two kinds of step, because CloFin has two kinds of thing to set up
 *
 * `request` steps are made against the API. `manual` steps are not, and cannot
 * be: **CloFin has no endpoint that creates an actor, grants a role, sets an
 * approver limit or configures an approval threshold**, and that absence is a
 * control decision rather than a gap —
 *
 * > There is deliberately no endpoint that creates an actor, grants a role or
 * > sets a limit. […] an actor able to grant itself the approver role would
 * > make segregation of duties unenforceable however carefully the rule is
 * > written.
 * > — `clofin-core`, `tools/clofin/tools/capture/recorder.clj`, UAT-005 §2
 *
 * So a `manual` step generates the exact SQL for the operator to run against
 * their own instance — the same shape as phase 1's Compose card, which is also
 * text you read and run yourself — and then **verifies through the API** that
 * it landed. The verification is a real request with a real response; the
 * cockpit never takes the operator's word for it, and never marks a step done
 * because a button was pressed.
 *
 * ## Validation fails closed
 *
 * {@link readProfile} returns a profile or a refusal. There is no partial
 * profile and no defaulting: a document missing a field is not run with an
 * assumption in place of it, because a bootstrap run is a sequence of writes
 * against somebody's instance and the wrong assumption is a write nobody asked
 * for.
 */

/** Where the profile documents live, relative to the page. */
export const PROFILE_DIRECTORY = "./profiles";

/** The profiles this build ships, in the order the interface offers them. */
export const PROFILE_IDS: readonly string[] = ["uat-standard", "high-value-two-approver"];

/**
 * The profile-format version this runner understands.
 *
 * A profile declaring anything else is refused rather than interpreted. The
 * version is the document's format, not its content: `formatVersion` changes
 * when the runner's reading of a profile changes, `version` when the seed data
 * does.
 */
export const SUPPORTED_FORMAT_VERSION = 1;

/** An actor the run will mint an id for and the seed SQL will insert. */
export interface ProfileActor {
  /** How steps refer to this actor: `"as": "controller"`. */
  readonly key: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly limits: readonly { readonly currency: string; readonly limitMinor: number }[];
}

/** One approval band, per currency, exactly as `clofin-core` stores it. */
export interface ProfileThreshold {
  readonly currency: string;
  readonly fromMinor: number;
  readonly approvalsRequired: number;
}

/** How a step decides something already exists rather than creating it twice. */
export interface PresentWhen {
  /** The array in the response body to look in, e.g. `accounts`. */
  readonly listAt: string;
  /** The field on each element to compare. */
  readonly field: string;
  /** The value that means "already there". */
  readonly equals: string;
}

export interface Precheck {
  readonly title: string;
  readonly method: string;
  readonly path: string;
  readonly as: string | null;
  readonly presentWhen: PresentWhen;
}

/** What a non-2xx answer means, when the profile knows. */
export interface ConflictMeaning {
  readonly statuses: readonly number[];
  readonly meaning: string;
  /** Whether the run can carry on afterwards. */
  readonly recoverable: boolean;
  readonly note: string;
}

export interface RequestStep {
  readonly kind: "request";
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly method: string;
  readonly path: string;
  /** Which actor to send as, or null for an unauthenticated call. */
  readonly as: string | null;
  readonly body: unknown;
  readonly expect: readonly number[];
  /** Response-body fields to remember, as `{variable: field}`. */
  readonly capture: Readonly<Record<string, string>>;
  readonly precheck: Precheck | null;
  readonly conflict: ConflictMeaning | null;
}

export interface ManualStep {
  readonly kind: "manual";
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** SQL templates, rendered with the run's variables. */
  readonly statements: readonly string[];
  /** How the operator runs them. Shown verbatim; this page runs nothing. */
  readonly howToRun: readonly string[];
  /** The API request that proves it landed. */
  readonly verify: {
    readonly title: string;
    readonly method: string;
    readonly path: string;
    readonly as: string | null;
    readonly expect: readonly number[];
    readonly proves: string;
  };
  /** What the API cannot show, said rather than left out. */
  readonly unverifiable: readonly string[];
}

export type ProfileStep = RequestStep | ManualStep;

export interface Profile {
  readonly id: string;
  readonly formatVersion: number;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  /** Where the seed data comes from, so it can be compared with its source. */
  readonly source: string;
  readonly actors: readonly ProfileActor[];
  readonly thresholds: readonly ProfileThreshold[];
  readonly steps: readonly ProfileStep[];
}

export type ProfileResult =
  | { readonly kind: "profile"; readonly profile: Profile; readonly raw: string }
  | { readonly kind: "refused"; readonly reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(raw: Record<string, unknown>, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function optionalString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function requireArray(raw: Record<string, unknown>, key: string, where: string): unknown[] {
  const value = raw[key];
  if (!Array.isArray(value)) throw new Error(`${where}: "${key}" must be an array`);
  return value;
}

function requireStrings(raw: Record<string, unknown>, key: string, where: string): string[] {
  return requireArray(raw, key, where).map((entry, index) => {
    if (typeof entry !== "string") throw new Error(`${where}: "${key}"[${index}] must be a string`);
    return entry;
  });
}

function requireNumber(raw: Record<string, unknown>, key: string, where: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: "${key}" must be a number`);
  }
  return value;
}

function requireStatuses(raw: Record<string, unknown>, key: string, where: string): number[] {
  return requireArray(raw, key, where).map((entry, index) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 100 || entry > 599) {
      throw new Error(`${where}: "${key}"[${index}] must be an HTTP status code`);
    }
    return entry;
  });
}

const METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

function requireMethod(raw: Record<string, unknown>, where: string): string {
  const method = requireString(raw, "method", where).toUpperCase();
  if (!METHODS.has(method)) {
    throw new Error(`${where}: "${method}" is not a method CloFin's API uses`);
  }
  return method;
}

function requirePath(raw: Record<string, unknown>, where: string): string {
  const path = requireString(raw, "path", where);
  if (!path.startsWith("/")) throw new Error(`${where}: "path" must begin with "/"`);
  // A step's path is joined to the connected instance's base URL. An absolute
  // URL here would be a profile choosing its own destination, which is exactly
  // the thing the connected-origin rule exists to prevent.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) || path.startsWith("//")) {
    throw new Error(`${where}: "path" must be a path, not a URL`);
  }
  return path;
}

function readPrecheck(value: unknown, where: string): Precheck | null {
  if (value === undefined || value === null) return null;
  const raw = record(value);
  if (!raw) throw new Error(`${where}: "precheck" must be an object`);
  const present = record(raw["presentWhen"]);
  if (!present) throw new Error(`${where}: "precheck.presentWhen" must be an object`);
  return {
    title: requireString(raw, "title", `${where}.precheck`),
    method: requireMethod(raw, `${where}.precheck`),
    path: requirePath(raw, `${where}.precheck`),
    as: optionalString(raw, "as"),
    presentWhen: {
      listAt: requireString(present, "listAt", `${where}.precheck.presentWhen`),
      field: requireString(present, "field", `${where}.precheck.presentWhen`),
      equals: requireString(present, "equals", `${where}.precheck.presentWhen`),
    },
  };
}

function readConflict(value: unknown, where: string): ConflictMeaning | null {
  if (value === undefined || value === null) return null;
  const raw = record(value);
  if (!raw) throw new Error(`${where}: "conflict" must be an object`);
  return {
    statuses: requireStatuses(raw, "statuses", `${where}.conflict`),
    meaning: requireString(raw, "meaning", `${where}.conflict`),
    recoverable: raw["recoverable"] === true,
    note: requireString(raw, "note", `${where}.conflict`),
  };
}

function readStep(value: unknown, index: number): ProfileStep {
  const where = `steps[${index}]`;
  const raw = record(value);
  if (!raw) throw new Error(`${where} must be an object`);
  const kind = requireString(raw, "kind", where);

  if (kind === "request") {
    const captureRaw = record(raw["capture"]) ?? {};
    const capture: Record<string, string> = {};
    for (const [name, field] of Object.entries(captureRaw)) {
      if (typeof field !== "string") throw new Error(`${where}: "capture.${name}" must be a string`);
      capture[name] = field;
    }
    return {
      kind: "request",
      id: requireString(raw, "id", where),
      title: requireString(raw, "title", where),
      why: requireString(raw, "why", where),
      method: requireMethod(raw, where),
      path: requirePath(raw, where),
      as: optionalString(raw, "as"),
      body: raw["body"] ?? null,
      expect: requireStatuses(raw, "expect", where),
      capture,
      precheck: readPrecheck(raw["precheck"], where),
      conflict: readConflict(raw["conflict"], where),
    };
  }

  if (kind === "manual") {
    const verify = record(raw["verify"]);
    if (!verify) throw new Error(`${where}: a manual step must carry a "verify" request`);
    return {
      kind: "manual",
      id: requireString(raw, "id", where),
      title: requireString(raw, "title", where),
      why: requireString(raw, "why", where),
      statements: requireStrings(raw, "statements", where),
      howToRun: requireStrings(raw, "howToRun", where),
      verify: {
        title: requireString(verify, "title", `${where}.verify`),
        method: requireMethod(verify, `${where}.verify`),
        path: requirePath(verify, `${where}.verify`),
        as: optionalString(verify, "as"),
        expect: requireStatuses(verify, "expect", `${where}.verify`),
        proves: requireString(verify, "proves", `${where}.verify`),
      },
      unverifiable: requireStrings(raw, "unverifiable", where),
    };
  }

  throw new Error(`${where}: "${kind}" is not a step kind this runner knows`);
}

/**
 * Read a profile document, or refuse it with the reason.
 *
 * Every referenced actor key is checked against the declared actors, because a
 * step that named an actor nobody minted would otherwise fail mid-run with an
 * unauthenticated request against a live instance — a refusal is much better
 * before the first write than during the fourth.
 */
export function readProfile(document: unknown, raw: string): ProfileResult {
  try {
    const top = record(document);
    if (!top) throw new Error("the profile is not a JSON object");

    const formatVersion = requireNumber(top, "formatVersion", "profile");
    if (formatVersion !== SUPPORTED_FORMAT_VERSION) {
      throw new Error(
        `formatVersion ${formatVersion} is not the format this runner reads ` +
          `(${SUPPORTED_FORMAT_VERSION})`,
      );
    }

    const actors = requireArray(top, "actors", "profile").map((entry, index) => {
      const actorRaw = record(entry);
      if (!actorRaw) throw new Error(`actors[${index}] must be an object`);
      const limits = requireArray(actorRaw, "limits", `actors[${index}]`).map((limit, at) => {
        const limitRaw = record(limit);
        if (!limitRaw) throw new Error(`actors[${index}].limits[${at}] must be an object`);
        return {
          currency: requireString(limitRaw, "currency", `actors[${index}].limits[${at}]`),
          limitMinor: requireNumber(limitRaw, "limitMinor", `actors[${index}].limits[${at}]`),
        };
      });
      return {
        key: requireString(actorRaw, "key", `actors[${index}]`),
        displayName: requireString(actorRaw, "displayName", `actors[${index}]`),
        roles: requireStrings(actorRaw, "roles", `actors[${index}]`),
        limits,
      };
    });

    const thresholds = requireArray(top, "thresholds", "profile").map((entry, index) => {
      const thresholdRaw = record(entry);
      if (!thresholdRaw) throw new Error(`thresholds[${index}] must be an object`);
      return {
        currency: requireString(thresholdRaw, "currency", `thresholds[${index}]`),
        fromMinor: requireNumber(thresholdRaw, "fromMinor", `thresholds[${index}]`),
        approvalsRequired: requireNumber(
          thresholdRaw,
          "approvalsRequired",
          `thresholds[${index}]`,
        ),
      };
    });

    const steps = requireArray(top, "steps", "profile").map(readStep);
    if (steps.length === 0) throw new Error("a profile with no steps would do nothing");

    const keys = new Set(actors.map((actor) => actor.key));
    for (const step of steps) {
      const named =
        step.kind === "request"
          ? [step.as, step.precheck?.as ?? null]
          : [step.verify.as, ...actorKeysIn(step.statements)];
      for (const key of named) {
        if (key !== null && key !== undefined && !keys.has(key)) {
          throw new Error(`step "${step.id}" acts as "${key}", which the profile does not declare`);
        }
      }
    }

    const ids = steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("two steps share an id, so a run could not name which one failed");
    }

    return {
      kind: "profile",
      raw,
      profile: {
        id: requireString(top, "id", "profile"),
        formatVersion,
        version: requireString(top, "version", "profile"),
        title: requireString(top, "title", "profile"),
        summary: requireString(top, "summary", "profile"),
        source: requireString(top, "source", "profile"),
        actors,
        thresholds,
        steps,
      },
    };
  } catch (error) {
    return { kind: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Every `{{actor:key}}` named in a set of templates. */
export function actorKeysIn(templates: readonly string[]): readonly string[] {
  const keys = new Set<string>();
  for (const template of templates) {
    for (const match of template.matchAll(/\{\{actor:([A-Za-z0-9_-]+)\}\}/g)) {
      if (match[1]) keys.add(match[1]);
    }
  }
  return [...keys];
}
