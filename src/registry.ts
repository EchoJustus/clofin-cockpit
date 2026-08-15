/**
 * The instance registry — the one thing this repository persists, and the only
 * module that may name a browser storage API.
 *
 * Phase 1 stored nothing at all, and said so in several places. Phase 2 stores
 * one thing: the addresses an operator has connected, so that reopening the
 * page does not mean typing them again. That is the whole of it, and the shape
 * of this file is arranged so it stays the whole of it.
 *
 * ## What is written, and what is refused
 *
 * A stored entry is **a base URL and a label**. {@link serialise} builds each
 * record field by field from a literal, so a value that is not one of those two
 * cannot reach storage even if a caller passes an object carrying it — there is
 * no spread, no `JSON.stringify(entry)` of a whole object, and no
 * `Object.assign`. `registry.test.ts` passes an entry carrying an actor id and
 * asserts the serialised text does not contain it.
 *
 * Credentials live in `credentials.ts`, in memory, and never come here. The
 * build guard enforces the other half mechanically: `localStorage` may appear
 * in this module and nowhere else in the built output, and the other three
 * browser stores — the per-session one, the indexed database, and the cookie
 * jar — appear nowhere at all. Their names are not written out here either;
 * the guard reads this file like any other, which is the rule working rather
 * than an inconvenience (011-REQ N-5 recorded the same thing happening to
 * three comments in phase 1).
 *
 * ## Connecting is what permits an origin
 *
 * {@link connect} is the only path by which an origin becomes something
 * `net.ts` will contact, and {@link forget} withdraws that permission and
 * clears the instance's credentials in the same call. The registry, the
 * permitted-origin set and the held credentials therefore cannot disagree
 * about which instances exist — they are changed by the same two functions.
 */

import { clearActing } from "./acting.js";
import { forgetCredentials } from "./credentials.js";
import { connectOrigin, disconnectOrigin } from "./net.js";
import { decideInstanceUrl } from "./origins.js";
import { forgetWorkspace } from "./workspace.js";

/** One remembered instance. Two fields, and there is no third. */
export interface RegistryEntry {
  /** The base URL, normalised — scheme, host, port, no trailing slash. */
  readonly baseUrl: string;
  /** What the operator calls it. Their text, shown back to them. */
  readonly label: string;
}

/**
 * The storage key, versioned.
 *
 * If the stored shape ever changes, the version changes with it and the old
 * key is simply not read — which loses a list of URLs somebody can retype, and
 * avoids a migration path for data this repository has no business having
 * strong opinions about.
 */
export const STORAGE_KEY = "clofin-cockpit.instances.v1";

/** The longest label kept. A registry is a list of addresses, not a notebook. */
export const MAX_LABEL_LENGTH = 80;

/** How many instances are remembered. Beyond this, the oldest is dropped. */
export const MAX_ENTRIES = 20;

/**
 * Build the stored text from the two fields that may be stored.
 *
 * Exported so a test can assert what reaches storage rather than inferring it
 * from what a caller passed.
 */
export function serialise(entries: readonly RegistryEntry[]): string {
  return JSON.stringify(
    entries.slice(0, MAX_ENTRIES).map((entry) => ({
      baseUrl: String(entry.baseUrl),
      label: String(entry.label).slice(0, MAX_LABEL_LENGTH),
    })),
  );
}

/**
 * Read stored text back, discarding anything that is not the shape written.
 *
 * A stored value is input like any other — another page on the same origin
 * could have written it, and a future version of this file certainly could.
 * Every entry is re-validated against the origin rules, so an address that
 * would no longer be permitted does not come back as one that is.
 */
export function deserialise(text: string | null): readonly RegistryEntry[] {
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: RegistryEntry[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    const baseUrl = typeof record["baseUrl"] === "string" ? record["baseUrl"] : "";
    const decision = decideInstanceUrl(baseUrl);
    if (decision.kind !== "accepted") continue;
    const label = typeof record["label"] === "string" ? record["label"] : "";
    if (entries.some((entry) => entry.baseUrl === decision.baseUrl)) continue;
    entries.push({ baseUrl: decision.baseUrl, label: label.slice(0, MAX_LABEL_LENGTH) });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries;
}

/**
 * Storage, if this browser has it and will let us use it.
 *
 * A page opened from a file, or with site data blocked, has no usable store.
 * That is not an error to report: the registry is a convenience, and the
 * cockpit works without it — you type the address each time. Everything below
 * treats "no store" as "an empty registry that does not persist".
 */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Every remembered instance, oldest first. */
export function entries(): readonly RegistryEntry[] {
  const storage = store();
  if (!storage) return [];
  try {
    return deserialise(storage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function write(next: readonly RegistryEntry[]): void {
  const storage = store();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, serialise(next));
  } catch {
    // A full or refused store is not a failure of the cockpit. The instance is
    // connected either way; it just will not be remembered.
  }
}

/**
 * Permit an origin and remember it.
 *
 * Called after the instance has answered and passed the honesty gate, never
 * before: an address that turned out not to be a CloFin instance is not one
 * this page should be permitted to contact afterwards.
 */
export function connect(entry: RegistryEntry): readonly RegistryEntry[] {
  const decision = decideInstanceUrl(entry.baseUrl);
  if (decision.kind !== "accepted") return entries();

  connectOrigin(decision.origin);

  const kept = entries().filter((existing) => existing.baseUrl !== decision.baseUrl);
  const next = [...kept, { baseUrl: decision.baseUrl, label: entry.label }].slice(-MAX_ENTRIES);
  write(next);
  return next;
}

/**
 * Forget an instance: the entry, the permission, the credentials, whoever was
 * acting, and everything its runs learned — together.
 *
 * One function, because five separate ones would eventually be called in fours.
 * The list grew in phase 3 and the reason it is still one call is the reason it
 * was one call in phase 2: "forget this instance" has to mean it, and a session
 * that kept the ids of an instance the operator had dismissed would be holding
 * credentials nobody thought they still had.
 */
export function forget(baseUrl: string): readonly RegistryEntry[] {
  const decision = decideInstanceUrl(baseUrl);
  if (decision.kind === "accepted") {
    disconnectOrigin(decision.origin);
    forgetCredentials(decision.origin);
    clearActing(decision.origin);
    forgetWorkspace(decision.origin);
  }
  const next = entries().filter((entry) => entry.baseUrl !== baseUrl);
  write(next);
  return next;
}

/**
 * Re-permit every remembered origin, at start-up.
 *
 * Remembering an address is not the same as being connected to it — the
 * cockpit has not spoken to any of them yet, and will not display anything
 * about one until it has. This exists so that selecting a remembered instance
 * can make its first request; the honesty gate then runs exactly as it does
 * for an address typed by hand, because it is the same code path.
 */
export function permitRemembered(): readonly RegistryEntry[] {
  const remembered = entries();
  for (const entry of remembered) {
    const decision = decideInstanceUrl(entry.baseUrl);
    if (decision.kind === "accepted") connectOrigin(decision.origin);
  }
  return remembered;
}
