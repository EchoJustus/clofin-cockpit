/**
 * What one run learned, so the next run on the same instance can use it.
 *
 * The walk this cockpit exists to perform is four runs, not one: bootstrap the
 * organisation, move a payment through maker–checker to release, play the
 * scheme by hand, then reconcile. Each is a separate document with a separate
 * beginning and end, because a single forty-step profile would be unreadable
 * and unrestartable — and the whole point of a profile is that you read it
 * before you run it.
 *
 * But run two needs the organisation id run one created, and run four needs the
 * account ids run one opened. Something has to carry them.
 *
 * ## What this is, and what it is not
 *
 * A per-origin map of **values earlier runs captured from responses**. Every
 * one of them arrived in a response body from that instance; nothing in here
 * was invented by this repository, and nothing in here is a credential — the
 * synthetic actor ids live in `credentials.ts` and are keyed by origin there,
 * for the same session lifetime and by the same rules.
 *
 * It is **in memory, for the life of the page**. Reloading loses it, which is
 * correct for the same reason a run does not survive a reload: what it holds is
 * the state of a walk somebody watched happen. The build refuses to publish a
 * site in which any storage API appears outside `registry.ts`, so this could
 * not be persisted without that refusal firing.
 *
 * ## Why the interface renders it
 *
 * A run that silently inherited an organisation id would be a run whose first
 * request contained a value the reader never saw arrive. So
 * `views-instance.ts` renders what a run inherited, with the step that captured
 * each value named, before the run's first request. Inheritance you can read is
 * continuity; inheritance you cannot is hidden state.
 */

/** One value an earlier run captured, and where it came from. */
export interface Inherited {
  readonly name: string;
  readonly value: string;
  /** The step id that captured it, so the interface can say where it came from. */
  readonly fromStepId: string;
  /** The profile that step belonged to. */
  readonly fromProfileId: string;
}

/** A subject some run touched, offered to the evidence view. */
export interface Subject {
  readonly id: string;
  /** The instance's own word for what kind of thing this is, e.g. `payment-instruction`. */
  readonly type: string;
  /** What the flow calls it on screen. */
  readonly label: string;
  readonly fromStepId: string;
  readonly fromProfileId: string;
}

interface Workspace {
  readonly values: Map<string, Inherited>;
  readonly subjects: Map<string, Subject>;
}

const byOrigin = new Map<string, Workspace>();

function workspace(origin: string): Workspace {
  const existing = byOrigin.get(origin);
  if (existing) return existing;
  const created: Workspace = { values: new Map(), subjects: new Map() };
  byOrigin.set(origin, created);
  return created;
}

/** Everything an instance's runs have captured, as a plain record for the runner. */
export function variables(origin: string): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  for (const [name, inherited] of workspace(origin).values) record[name] = inherited.value;
  return record;
}

/** The same, with provenance, for the interface to render. */
export function inherited(origin: string): readonly Inherited[] {
  return [...workspace(origin).values.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Record what a step captured.
 *
 * Later captures replace earlier ones under the same name, which is what makes
 * re-running a flow against the same instance work: the second payment run's
 * instruction id is the one the third run should play.
 */
export function remember(origin: string, entries: readonly Inherited[]): void {
  const store = workspace(origin).values;
  for (const entry of entries) store.set(entry.name, entry);
}

/** Offer a subject to the evidence view. */
export function rememberSubject(origin: string, subject: Subject): void {
  workspace(origin).subjects.set(subject.id, subject);
}

/** Every subject any run on this instance has touched, most recently added last. */
export function subjects(origin: string): readonly Subject[] {
  return [...workspace(origin).subjects.values()];
}

/**
 * Drop everything held for one instance.
 *
 * Called from the same function that forgets the instance, withdraws its origin
 * and clears its credentials — so there is no path by which one of the four
 * survives the other three.
 */
export function forgetWorkspace(origin: string): void {
  byOrigin.delete(origin);
}
