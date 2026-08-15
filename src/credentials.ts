/**
 * The synthetic actor ids a bootstrap run mints, and where they are not.
 *
 * ## What these are
 *
 * CloFin authenticates by an `X-Actor-Id` header naming a row in the instance's
 * `actor` table. Its own documentation is blunt about what that is:
 *
 * > **This is not authentication in a sense that resists an adversary.** Anyone
 * > who can reach the service can claim to be any seeded actor.
 * > — `clofin-core`, `src/clofin/api/principal.clj`
 *
 * So an actor id is a credential in the only sense that matters here: whoever
 * holds it can act as that actor against that instance. They are synthetic,
 * they belong to a synthetic organisation on an instance the operator started
 * themselves, and they are still treated as credentials, because "it does not
 * matter much" is how a habit forms that later matters a lot.
 *
 * ## The four rules, and how each is kept
 *
 * 1. **Minted here, per instance, per run.** `crypto.randomUUID()`. They are
 *    not in this repository, not in a profile, and not in the built site —
 *    there is nothing to commit, which is a stronger property than a rule
 *    about not committing anything.
 * 2. **Session only.** A module-level `Map`. No browser storage is used, and
 *    the build refuses to publish a site in which any storage API appears
 *    outside `registry.ts`. Reloading the page loses them, which is correct:
 *    they are the state of a run, and a run is a thing you watched happen.
 * 3. **Sent only to that instance's origin.** They are keyed by origin, and
 *    `net.ts` derives the origin of every request from the URL it is given —
 *    so a header set for one instance cannot travel to another without a
 *    caller passing the wrong base URL, and the base URL is what selects the
 *    credentials in the first place.
 * 4. **Cleared with the registry entry.** Forgetting an instance calls
 *    {@link forgetCredentials} in the same function that removes it from the
 *    registry and withdraws its origin from `net.ts`.
 */

/** One synthetic actor a bootstrap run created, as this page knows it. */
export interface SyntheticActor {
  /** The profile's name for the role, e.g. `controller`. */
  readonly key: string;
  /** What the profile calls this actor on screen. */
  readonly displayName: string;
  /** The roles the seed grants — displayed, and part of the generated SQL. */
  readonly roles: readonly string[];
  /** The minted id. Sent as `X-Actor-Id`, never stored, never rendered into a build. */
  readonly actorId: string;
}

export interface InstanceCredentials {
  readonly origin: string;
  readonly profileId: string;
  readonly organisationId: string | null;
  readonly actors: readonly SyntheticActor[];
}

/**
 * In memory, for the life of the page, and nowhere else.
 *
 * Deliberately a module-level binding rather than something a caller can hand
 * around: there is one place these live, and a second place would be a second
 * lifetime to reason about.
 */
const byOrigin = new Map<string, InstanceCredentials>();

/**
 * A new identifier.
 *
 * `crypto.randomUUID` rather than anything hand-rolled: CloFin parses this as
 * a UUID and refuses a malformed one, and a home-made generator here would be
 * a source of a bug in a value that ends up inside SQL the operator runs.
 */
export function mintActorId(): string {
  return crypto.randomUUID();
}

/** Hold the credentials a run minted for one instance, replacing any earlier set. */
export function rememberCredentials(credentials: InstanceCredentials): void {
  byOrigin.set(credentials.origin, credentials);
}

/** What is held for this instance, if anything. */
export function credentialsFor(origin: string): InstanceCredentials | null {
  return byOrigin.get(origin) ?? null;
}

/** Record the organisation a run created, once the instance has answered with it. */
export function rememberOrganisation(origin: string, organisationId: string): void {
  const existing = byOrigin.get(origin);
  if (existing) byOrigin.set(origin, { ...existing, organisationId });
}

/** Drop everything held for one instance. Called when the instance is forgotten. */
export function forgetCredentials(origin: string): void {
  byOrigin.delete(origin);
}

/** For the interface: how many instances are currently holding credentials. */
export function heldOrigins(): readonly string[] {
  return [...byOrigin.keys()].sort();
}

/**
 * The actor id to send for one profile role, or null.
 *
 * Null rather than a thrown error, because a run that has not yet reached the
 * step that mints an actor is an ordinary state, and the runner renders it as
 * one.
 */
export function actorId(origin: string, key: string): string | null {
  return byOrigin.get(origin)?.actors.find((actor) => actor.key === key)?.actorId ?? null;
}
