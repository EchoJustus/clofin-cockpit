/**
 * The evidence view: what the trail says about one subject.
 *
 * This is the payoff screen for a compliance audience, and its whole content
 * comes from two endpoints — `GET /audit/evidence/{subjectId}` and
 * `GET /audit/events?subjectId=…`. Nothing here classifies, summarises,
 * counts or interprets. The pack states its own `subjectType`, its own period
 * and its own `truncated` flag, and those are rendered as the instance sent
 * them; where the pack says a field is absent, the screen says the pack said so.
 *
 * ## Two calls, not one, on purpose
 *
 * The pack is the curated answer — every state change of one subject, in order,
 * including events whose *subject* is something else where the pack relates
 * them (an `approval.invalidated` naming the approval, in a payment's pack).
 * The event list is the raw trail filtered to that id, and it is capped with a
 * `truncated` flag of its own. Reading both and showing both is the difference
 * between quoting a report and checking it: where they differ, the difference
 * is visible rather than resolved by this page picking one.
 *
 * ## Who asks
 *
 * `audit/read` is held by `auditor` and `compliance` and by nobody else — an
 * operator able to read the whole trail could see which approvers act on what
 * and when, which is reconnaissance rather than transparency. The controller
 * who ran the settlement therefore **cannot** read this, and the cockpit does
 * not paper over that by borrowing an actor for one request.
 *
 * Instead the evidence control **switches the acting actor** to an actor
 * holding `auditor`, says so on the button before it is pressed, and the
 * request goes out as the actor the frame now names. That keeps `acting.ts`'s
 * invariant exact — an authenticated request carries the acting actor's id,
 * always — and it makes a real property of the system visible in passing: this
 * screen is a different person's view, and getting to it is a change of hands.
 *
 * A subject touched on an instance whose seed profile declared no auditor is
 * offered no evidence button, with the reason rendered where the button would
 * be. That is a limitation of the profile, not of the API, and saying which is
 * the point.
 */

import { actAs } from "./acting.js";
import { credentialsFor, type SyntheticActor } from "./credentials.js";
import { exchange, type Exchange } from "./net.js";
import type { Subject } from "./workspace.js";

/** The role that holds `audit/read` in a way this cockpit can use. */
export const AUDIT_ROLE = "auditor";

/** The auditor this instance's bootstrap minted, or null if it minted none. */
export function auditorFor(origin: string): SyntheticActor | null {
  return (
    credentialsFor(origin)?.actors.find((actor) => actor.roles.includes(AUDIT_ROLE)) ?? null
  );
}

/** Why there is no evidence button, when there is none. */
export function whyNoAuditor(): string {
  return (
    "This instance was seeded by a profile that created no actor holding the auditor role, " +
    "and `audit/read` is held by no other role in this seed. The evidence endpoints would " +
    "answer 403 for every actor this page holds, so it does not ask and does not pretend to."
  );
}

export interface EvidenceResult {
  readonly subject: Subject;
  /** Which actor asked. Rendered on the screen and stamped on both exchanges. */
  readonly askedAs: SyntheticActor;
  /** `GET /audit/evidence/{subjectId}` — the curated pack. */
  readonly pack: Exchange;
  /** `GET /audit/events?subjectId=…` — the raw trail, filtered. */
  readonly events: Exchange;
}

export type EvidenceOutcome =
  | { readonly kind: "evidence"; readonly result: EvidenceResult }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Read the evidence for one subject, as the auditor.
 *
 * Switches the acting actor first — deliberately, and visibly: the caller's
 * button says it will, and the frame names the new actor from the moment it
 * happens. Both requests are returned whatever they answered, including a 403
 * or a 404, because on this page an answer that is not `2xx` is often the most
 * informative thing on the screen.
 */
export async function readEvidence(
  subject: Subject,
  baseUrl: string,
  origin: string,
  organisationId: string | null,
): Promise<EvidenceOutcome> {
  const auditor = auditorFor(origin);
  if (!auditor) return { kind: "refused", reason: whyNoAuditor() };

  if (!actAs(origin, auditor.key)) {
    return {
      kind: "refused",
      reason:
        "The auditor this instance was seeded with is no longer among the actors held for it. " +
        "Nothing was asked.",
    };
  }

  const scope = organisationId === null ? "" : `?organisationId=${encodeURIComponent(organisationId)}`;
  const headers = {
    Accept: "application/json",
    "X-Actor-Id": auditor.actorId,
  };

  const pack = await exchange({
    method: "GET",
    url: `${baseUrl}/audit/evidence/${encodeURIComponent(subject.id)}${scope}`,
    headers,
  });

  const query = new URLSearchParams();
  if (organisationId !== null) query.set("organisationId", organisationId);
  query.set("subjectId", subject.id);
  const events = await exchange({
    method: "GET",
    url: `${baseUrl}/audit/events?${query.toString()}`,
    headers,
  });

  return { kind: "evidence", result: { subject, askedAs: auditor, pack, events } };
}
