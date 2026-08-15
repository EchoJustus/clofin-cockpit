/**
 * The acting actor: whose `X-Actor-Id` the next request will carry.
 *
 * ## Why this is a module and not a variable in a view
 *
 * The cockpit's most important screen is a payment being refused to the person
 * who raised it. That screen is only honest if the audience can see **who is
 * asking** — a 403 with no actor beside it is a screenshot of a system being
 * difficult, not a demonstration of segregation of duties. So the acting actor
 * is not a detail of one flow: it is a property of the whole page, rendered in
 * the frame, and it changes only when an operator says so.
 *
 * ## The invariant
 *
 * > **Every authenticated request the cockpit sends carries the acting actor's
 * > id, and the acting actor changes only by an explicit operator action.**
 *
 * There are no exceptions, and that is what makes the sentence worth writing.
 * In particular the evidence view — which needs `audit/read`, a permission the
 * controller and the operator do not hold — does **not** quietly send its
 * request as somebody else. Its button says which actor it will switch to, the
 * switch happens, and the request goes out as the actor now named in the frame.
 * A page that borrowed an actor for one request would be a page whose frame
 * told the truth except when it mattered.
 *
 * The runner enforces the other half: a step declaring `as: "wei"` while the
 * acting actor is Priya does **not** send as Wei. It stops, in the four-state
 * vocabulary's `waiting for you`, and asks the operator to switch. That is
 * deliberate friction at exactly the moment the product is making its point —
 * the maker cannot approve, so a human has to hand the work to somebody else,
 * and in this interface that is a thing you do rather than a thing that happens
 * to you.
 *
 * ## Lifetime
 *
 * Per origin, in memory, for the life of the page — the same lifetime and the
 * same reasons as `credentials.ts`. Nothing here is persisted: which actor you
 * were pretending to be is state of a session you watched, and the build
 * refuses to publish a site that stores anything but the instance registry.
 */

import { credentialsFor, type SyntheticActor } from "./credentials.js";

/**
 * The acting actor's key, per instance origin.
 *
 * A key rather than an id: the id is a credential and lives in
 * `credentials.ts`, which is the one place that holds them. This module holds a
 * choice, not a secret.
 */
const actingByOrigin = new Map<string, string>();

/** Which actor is acting on this instance, or null if none has been chosen. */
export function actingKey(origin: string): string | null {
  return actingByOrigin.get(origin) ?? null;
}

/** The acting actor in full, or null. Read through `credentials.ts`. */
export function acting(origin: string): SyntheticActor | null {
  const key = actingByOrigin.get(origin);
  if (key === undefined) return null;
  return credentialsFor(origin)?.actors.find((actor) => actor.key === key) ?? null;
}

/**
 * Act as this actor from now on.
 *
 * Refuses a key the instance's run never minted, and says so by returning
 * false: an interface that silently accepted an unknown actor would leave the
 * frame naming somebody whose id no request could carry.
 */
export function actAs(origin: string, key: string): boolean {
  const known = credentialsFor(origin)?.actors.some((actor) => actor.key === key) ?? false;
  if (!known) return false;
  actingByOrigin.set(origin, key);
  return true;
}

/** Stop acting as anybody on this instance. Called when an instance is forgotten. */
export function clearActing(origin: string): void {
  actingByOrigin.delete(origin);
}

/** Every actor the operator may switch to on this instance, in profile order. */
export function available(origin: string): readonly SyntheticActor[] {
  return credentialsFor(origin)?.actors ?? [];
}

/**
 * How the frame names the acting actor.
 *
 * The display name and the roles, and **not** the id. The id is on the run's
 * own card and on every rendered exchange's `X-Actor-Id` header, which is where
 * a reader checking the claim would look; repeating it in the masthead of every
 * screen would put a credential in every screenshot for no gain.
 */
export function describeActing(origin: string): string {
  const actor = acting(origin);
  if (!actor) return "No actor selected — requests that need one will wait for you to choose.";
  return `${actor.displayName} — ${actor.roles.join(", ")}`;
}
