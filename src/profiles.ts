/**
 * Seed profiles and operation flows: what a run will do, written down before it
 * does it.
 *
 * A profile is **data** — a versioned JSON document in `profiles/`, served
 * beside this page and fetched at runtime, so the document the deployed
 * cockpit executes is a file you can `curl` and diff against the repository.
 * The runner in `bootstrap.ts` is **code**, and it contains no organisation
 * name, no actor, no account code, no threshold, no scheme name and no payment
 * amount. Neither embeds the other, which is what makes "here is exactly what
 * it will do" checkable rather than asserted.
 *
 * The profile lists **every call, one step per call**. There is deliberately no
 * loop construct, no "repeat over this list" and no template expansion that
 * turns one declaration into three requests. A reader counting the calls in the
 * file is counting the requests the instance will receive — including the
 * balance re-reads, which are declared individually for exactly that reason.
 *
 * ## Two roles, one format, one runner
 *
 * `role: "bootstrap"` sets an instance up; `role: "flow"` operates one that is
 * already set up. They are the same document format read by the same reader and
 * executed by the same runner, because a second runner is a second place for
 * the halting rule, the four-state vocabulary and the raw-exchange discipline
 * to be *almost* implemented. The difference is narrow and stated in one place
 * (`startRun`): a bootstrap mints the synthetic actors, a flow uses the ones
 * already minted for that instance and refuses to start if there are none.
 *
 * ## Four kinds of step, because the product has four kinds of moment
 *
 * `request` — one call to the API. The ordinary case.
 *
 * `manual` — something CloFin has **no endpoint for, on purpose**: there is no
 * operation that creates an actor, grants a role, sets an approver limit or
 * configures an approval threshold, and that absence is a control decision
 * rather than a gap —
 *
 * > There is deliberately no endpoint that creates an actor, grants a role or
 * > sets a limit. […] an actor able to grant itself the approver role would
 * > make segregation of duties unenforceable however carefully the rule is
 * > written.
 * > — `clofin-core`, UAT-005 §2
 *
 * So a `manual` step generates the exact SQL for the operator to run against
 * their own instance and then **verifies through the API** that it landed. The
 * verification is a real request with a real response; the cockpit never takes
 * the operator's word for it, and never marks a step done because a button was
 * pressed. This is the pattern ratified for every future manual step by the
 * TASK-012 changelog's ruling on objection O-1, and the *what this cannot
 * show* list it requires is enforced here by {@link readStep} and again by
 * `profiles.test.ts`.
 *
 * `choice` — a moment where the **operator decides what happens next**, and the
 * decision is not the cockpit's to make. Playing the simulated scheme is the
 * whole of this: a scheme settles, or returns, or repeats itself, or
 * contradicts itself, or says nothing at all, and which of those occurs is a
 * fact about the world that a demonstration must not script. Every option is
 * one real request, declared in full, and taking it costs one deliberate click.
 * There is no option that fires several, no "play the whole scheme" control and
 * no timer: a macro that produced misbehaviour on its own would make this a
 * demo reel rather than an operator console.
 *
 * `readouts`, which any acting step may carry, are the other half of that
 * honesty. After a step's call, its declared readouts are performed — real
 * `GET`s, rendered raw like everything else — and the figures they name are
 * **projected out of the responses** by `figures.ts`, which cannot compute. So
 * a balance changes on screen after a settlement because the ledger changed and
 * the instance was asked again, never because this page adjusted a number it
 * was already showing.
 *
 * ## Validation fails closed
 *
 * {@link readProfile} returns a profile or a refusal. There is no partial
 * profile and no defaulting: a document missing a field is not run with an
 * assumption in place of it, because a run is a sequence of writes against
 * somebody's instance and the wrong assumption is a write nobody asked for.
 */

/** Where the profile documents live, relative to the page. */
export const PROFILE_DIRECTORY = "./profiles";

/** The bootstrap profiles this build ships, in the order the interface offers them. */
export const PROFILE_IDS: readonly string[] = ["uat-standard", "high-value-two-approver"];

/**
 * The operation flows this build ships, in the order they are meant to be run.
 *
 * The order is the product's own story and the interface presents it that way:
 * a payment cannot be played through the scheme before it has been released,
 * and there is nothing to reconcile until the scheme has answered. Each flow
 * states what it requires, so taking them out of order is refused with a
 * sentence rather than by a mid-run failure.
 */
export const FLOW_IDS: readonly string[] = [
  "payment-maker-checker",
  "scheme-play",
  "reconciliation",
];

/**
 * The profile-format version this runner understands.
 *
 * A profile declaring anything else is refused rather than interpreted. The
 * version is the document's format, not its content: `formatVersion` changes
 * when the runner's reading of a profile changes, `version` when the seed data
 * does. It became `2` when flows arrived, because the runner's reading changed
 * in four ways at once — a role, choice steps, readouts, and captured
 * documents. Both shipped bootstrap profiles were moved to `2` in the same
 * commit rather than being read by a compatibility branch: one format the
 * reader implements once is the point of having a version at all.
 */
export const SUPPORTED_FORMAT_VERSION = 2;

/** What a document is for. The runner's only behavioural difference. */
export type ProfileRole = "bootstrap" | "flow";

/** An actor a bootstrap run mints an id for and the seed SQL inserts. */
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

/**
 * A thing the evidence view can be asked about.
 *
 * Declared against the step that touched it, and offered from that step — which
 * is what "one click from the step that touched it" means in practice. The
 * `type` is the instance's own word for the subject kind; the cockpit does not
 * classify anything, it repeats what the API's vocabulary calls it and the
 * evidence pack's own `subjectType` is rendered beside it.
 */
export interface SubjectDeclaration {
  /** The run variable holding the subject's id. */
  readonly variable: string;
  /** `payment-instruction`, `settlement-batch`, … — the instance's vocabulary. */
  readonly type: string;
  readonly label: string;
}

/** One figure to project out of a readout's response. */
export interface FigureDeclaration {
  readonly label: string;
  /** A dotted path into the response body. Read by `figures.ts`, which cannot compute. */
  readonly path: string;
}

/**
 * A real `GET` performed after a step's call, whose figures are rendered.
 *
 * Readouts carry no `as`: they are sent as the acting actor, like every other
 * authenticated request this page makes. A readout that could quietly use a
 * different actor would be a hole in the one invariant `acting.ts` states.
 */
export interface Readout {
  readonly label: string;
  readonly why: string;
  readonly method: string;
  readonly path: string;
  readonly figures: readonly FigureDeclaration[];
}

/**
 * One call to the API: what is sent, what is expected, what is kept.
 *
 * Shared by `request` steps and by each option of a `choice` step, so that an
 * operator's choice is executed by exactly the same code as a scripted step and
 * cannot acquire a different discipline.
 */
export interface Call {
  readonly method: string;
  readonly path: string;
  /** A literal body, rendered with the run's variables. */
  readonly body: unknown;
  /**
   * Send a document an earlier step captured, instead of a literal body.
   *
   * The reconciliation flow needs this and nothing else does: the statement
   * posted to `POST /reconciliation-statements` is the document
   * `GET /settlement-statements` returned, unchanged. Re-typing it into the
   * profile would be this repository asserting what the scheme said.
   */
  readonly bodyFrom: string | null;
  /** Members added to that document before sending, as `{member: template}`. */
  readonly bodyMerge: Readonly<Record<string, string>>;
  /**
   * Whether this call needs an `Idempotency-Key`.
   *
   * The key is minted per attempt by the runner, not written in the profile: a
   * key in a document is a key that is reused on the second run, and CloFin
   * would answer the second payment with the first one's response. The minted
   * key appears in the rendered request like every other header, so a reader
   * can see the one that was actually sent.
   */
  readonly idempotent: boolean;
  readonly expect: readonly number[];
  /** Response-body fields to remember, as `{variable: dotted.path}`. */
  readonly capture: Readonly<Record<string, string>>;
  /** Keep the whole response body under this name, for a later `bodyFrom`. */
  readonly captureDocument: string | null;
  readonly subjects: readonly SubjectDeclaration[];
  readonly conflict: ConflictMeaning | null;
}

export interface RequestStep extends Call {
  readonly kind: "request";
  readonly id: string;
  readonly title: string;
  readonly why: string;
  /** Which actor this step must be performed by, or null for an unauthenticated call. */
  readonly as: string | null;
  readonly precheck: Precheck | null;
  readonly readouts: readonly Readout[];
  /** What this step's requests cannot demonstrate. Rendered whenever present. */
  readonly unverifiable: readonly string[];
}

/** One thing the operator may decide to do. */
export interface ChoiceOption {
  readonly id: string;
  /** The button. Rendered exactly as written — `SIM-` names are never prettified. */
  readonly label: string;
  readonly why: string;
  /**
   * The call this option makes, or null for an option that deliberately sends
   * nothing.
   *
   * Silence is a real thing a scheme does, and the only faithful way to offer
   * it is an option that makes no request at all. Such an option must carry a
   * {@link nothingNote} saying what was *not* done, so that a step reading
   * "done" never stands for an outcome nobody produced.
   */
  readonly call: Call | null;
  readonly nothingNote: string | null;
}

export interface ChoiceStep {
  readonly kind: "choice";
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly as: string | null;
  readonly options: readonly ChoiceOption[];
  readonly readouts: readonly Readout[];
  readonly unverifiable: readonly string[];
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

export type ProfileStep = RequestStep | ChoiceStep | ManualStep;

export interface Profile {
  readonly id: string;
  readonly role: ProfileRole;
  readonly formatVersion: number;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  /** Where the seed data or the script comes from, so it can be compared with its source. */
  readonly source: string;
  /** Variables a flow needs an earlier run to have captured. */
  readonly requires: readonly string[];
  /** What this whole document cannot demonstrate. Rendered before it is run. */
  readonly unverifiable: readonly string[];
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

function optionalArray(raw: Record<string, unknown>, key: string, where: string): unknown[] {
  if (raw[key] === undefined || raw[key] === null) return [];
  return requireArray(raw, key, where);
}

function requireStrings(raw: Record<string, unknown>, key: string, where: string): string[] {
  return requireArray(raw, key, where).map((entry, index) => {
    if (typeof entry !== "string") throw new Error(`${where}: "${key}"[${index}] must be a string`);
    return entry;
  });
}

function optionalStrings(raw: Record<string, unknown>, key: string, where: string): string[] {
  if (raw[key] === undefined || raw[key] === null) return [];
  return requireStrings(raw, key, where);
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

function readStringMap(value: unknown, where: string, key: string): Record<string, string> {
  const raw = record(value) ?? {};
  const map: Record<string, string> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (typeof entry !== "string") throw new Error(`${where}: "${key}.${name}" must be a string`);
    map[name] = entry;
  }
  return map;
}

function readSubjects(value: unknown, where: string): SubjectDeclaration[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${where}: "subjects" must be an array`);
  return value.map((entry, index) => {
    const raw = record(entry);
    if (!raw) throw new Error(`${where}.subjects[${index}] must be an object`);
    return {
      variable: requireString(raw, "variable", `${where}.subjects[${index}]`),
      type: requireString(raw, "type", `${where}.subjects[${index}]`),
      label: requireString(raw, "label", `${where}.subjects[${index}]`),
    };
  });
}

function readReadouts(value: unknown, where: string): Readout[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${where}: "readouts" must be an array`);
  return value.map((entry, index) => {
    const raw = record(entry);
    if (!raw) throw new Error(`${where}.readouts[${index}] must be an object`);
    const at = `${where}.readouts[${index}]`;
    const method = requireMethod(raw, at);
    if (method !== "GET") {
      throw new Error(`${at}: a readout may only be a GET; it reads, it does not act`);
    }
    const figures = requireArray(raw, "figures", at).map((figure, position) => {
      const figureRaw = record(figure);
      if (!figureRaw) throw new Error(`${at}.figures[${position}] must be an object`);
      return {
        label: requireString(figureRaw, "label", `${at}.figures[${position}]`),
        path: requireString(figureRaw, "path", `${at}.figures[${position}]`),
      };
    });
    if (figures.length === 0) {
      throw new Error(`${at}: a readout with no figures would make a request and show nothing`);
    }
    return {
      label: requireString(raw, "label", at),
      why: requireString(raw, "why", at),
      method,
      path: requirePath(raw, at),
      figures,
    };
  });
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

/** Read the call fields, wherever they appear — on a step or on a choice option. */
function readCall(raw: Record<string, unknown>, where: string): Call {
  const bodyFrom = optionalString(raw, "bodyFrom");
  if (bodyFrom !== null && raw["body"] !== undefined && raw["body"] !== null) {
    throw new Error(
      `${where}: carries both "body" and "bodyFrom". A call sends one document, and which ` +
        "one it is must be readable here rather than decided at run time.",
    );
  }
  return {
    method: requireMethod(raw, where),
    path: requirePath(raw, where),
    body: raw["body"] ?? null,
    bodyFrom,
    bodyMerge: readStringMap(raw["bodyMerge"], where, "bodyMerge"),
    idempotent: raw["idempotent"] === true,
    expect: requireStatuses(raw, "expect", where),
    capture: readStringMap(raw["capture"], where, "capture"),
    captureDocument: optionalString(raw, "captureDocument"),
    subjects: readSubjects(raw["subjects"], where),
    conflict: readConflict(raw["conflict"], where),
  };
}

function readOption(value: unknown, where: string, index: number): ChoiceOption {
  const raw = record(value);
  if (!raw) throw new Error(`${where}.options[${index}] must be an object`);
  const at = `${where}.options[${index}]`;
  const sends = raw["sends"] !== false;
  const nothingNote = optionalString(raw, "nothingNote");

  if (!sends) {
    if (nothingNote === null) {
      throw new Error(
        `${at}: an option that sends nothing must carry a "nothingNote" saying what was not ` +
          "done. A step reporting success for an outcome nobody produced is the one thing " +
          "this interface must never do.",
      );
    }
    return {
      id: requireString(raw, "id", at),
      label: requireString(raw, "label", at),
      why: requireString(raw, "why", at),
      call: null,
      nothingNote,
    };
  }

  return {
    id: requireString(raw, "id", at),
    label: requireString(raw, "label", at),
    why: requireString(raw, "why", at),
    call: readCall(raw, at),
    nothingNote: null,
  };
}

function readStep(value: unknown, index: number): ProfileStep {
  const where = `steps[${index}]`;
  const raw = record(value);
  if (!raw) throw new Error(`${where} must be an object`);
  const kind = requireString(raw, "kind", where);

  if (kind === "request") {
    return {
      kind: "request",
      id: requireString(raw, "id", where),
      title: requireString(raw, "title", where),
      why: requireString(raw, "why", where),
      as: optionalString(raw, "as"),
      precheck: readPrecheck(raw["precheck"], where),
      readouts: readReadouts(raw["readouts"], where),
      unverifiable: optionalStrings(raw, "unverifiable", where),
      ...readCall(raw, where),
    };
  }

  if (kind === "choice") {
    const options = requireArray(raw, "options", where).map((option, at) =>
      readOption(option, where, at),
    );
    if (options.length === 0) {
      throw new Error(`${where}: a choice with no options would offer the operator nothing`);
    }
    const ids = options.map((option) => option.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`${where}: two options share an id, so a run could not name which was taken`);
    }
    return {
      kind: "choice",
      id: requireString(raw, "id", where),
      title: requireString(raw, "title", where),
      why: requireString(raw, "why", where),
      as: optionalString(raw, "as"),
      options,
      readouts: readReadouts(raw["readouts"], where),
      unverifiable: optionalStrings(raw, "unverifiable", where),
    };
  }

  if (kind === "manual") {
    const verify = record(raw["verify"]);
    if (!verify) throw new Error(`${where}: a manual step must carry a "verify" request`);
    const unverifiable = requireStrings(raw, "unverifiable", where);
    if (unverifiable.length === 0) {
      // The TASK-012 ruling in one line: a green tick never stands for
      // something nobody checked.
      throw new Error(
        `${where}: a manual step must say what its verification cannot show. The API confirms ` +
          "one consequence of the SQL, never all of it.",
      );
    }
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
      unverifiable,
    };
  }

  throw new Error(`${where}: "${kind}" is not a step kind this runner knows`);
}

/** Every actor key a step names, in any position. */
function actorKeysOf(step: ProfileStep): readonly (string | null)[] {
  if (step.kind === "request") return [step.as, step.precheck?.as ?? null];
  if (step.kind === "choice") return [step.as];
  return [step.verify.as, ...actorKeysIn(step.statements)];
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

    const role = requireString(top, "role", "profile");
    if (role !== "bootstrap" && role !== "flow") {
      throw new Error(`"${role}" is not a role this runner knows (bootstrap, flow)`);
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

    const thresholds = optionalArray(top, "thresholds", "profile").map((entry, index) => {
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
      for (const key of actorKeysOf(step)) {
        if (key !== null && key !== undefined && !keys.has(key)) {
          throw new Error(`step "${step.id}" acts as "${key}", which the profile does not declare`);
        }
      }
    }

    const ids = steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("two steps share an id, so a run could not name which one failed");
    }

    // A flow does not mint actors — it uses the ones the bootstrap minted — so
    // its actor list is a *claim about the instance* rather than a plan. It
    // must still declare them, because every step naming one is checked above.
    if (role === "flow" && actors.length === 0) {
      throw new Error("a flow must declare the actors it acts as, so its steps can be checked");
    }

    return {
      kind: "profile",
      raw,
      profile: {
        id: requireString(top, "id", "profile"),
        role,
        formatVersion,
        version: requireString(top, "version", "profile"),
        title: requireString(top, "title", "profile"),
        summary: requireString(top, "summary", "profile"),
        source: requireString(top, "source", "profile"),
        requires: optionalStrings(top, "requires", "profile"),
        unverifiable: optionalStrings(top, "unverifiable", "profile"),
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

/** How many real requests a step will make at most, for the plan the reader sees. */
export function callCount(step: ProfileStep): number {
  if (step.kind === "manual") return 1;
  if (step.kind === "request") {
    return 1 + (step.precheck ? 1 : 0) + step.readouts.length;
  }
  return 1 + step.readouts.length;
}
