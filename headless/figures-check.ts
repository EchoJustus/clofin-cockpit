/**
 * The run re-checks its own figures before it publishes them.
 *
 * `figures.test.ts` makes this assertion about recorded bodies at build time:
 * the text of every projected figure appears **verbatim** in the response body
 * it was read from. The assertion is deliberately crude, and crude is the
 * point — a figure that had been scaled, rounded, summed or localised would not
 * survive a substring check against its own source, so the check does not need
 * to know which transformation was applied to catch that one was.
 *
 * A batch run writes figures into a summary that people will quote without
 * opening the log, so it makes the same assertion again, at run time, against
 * the bodies this run actually received — and **fails the job** when one does
 * not hold. The difference from the test is the input: the test uses a recorded
 * body, this uses the live one. Neither replaces the other, and neither is a
 * review: both are the same substring, checked by a machine.
 *
 * A figure the instance did not send is not a failure. `figures.ts` renders it
 * as absent in words, never as a zero, and this reports it the same way: an
 * absent figure has no text to find, and treating "the instance did not say" as
 * a defect would push the next contributor towards inventing a value to make
 * the check pass.
 */

import { found, type Figure } from "../src/figures.js";
import type { DrivenProfile } from "./drive.js";

/** One figure, and whether it survived the check. */
export interface FigureAssertion {
  readonly profileId: string;
  readonly stepId: string;
  readonly readoutLabel: string;
  readonly figureLabel: string;
  readonly path: string;
  /** The projected text, or `null` when the instance did not send it. */
  readonly text: string | null;
  /** The request whose body it was read from. */
  readonly from: string;
  /** `true` when the text appears verbatim in that body; `null` when absent. */
  readonly verbatim: boolean | null;
}

/** Did any figure fail? Absent ones do not count — see the module note. */
export function anyFailed(assertions: readonly FigureAssertion[]): boolean {
  return assertions.some((assertion) => assertion.verbatim === false);
}

export function failedOnly(assertions: readonly FigureAssertion[]): readonly FigureAssertion[] {
  return assertions.filter((assertion) => assertion.verbatim === false);
}

function check(figure: Figure, body: string | null): boolean | null {
  if (!found(figure)) return null;
  if (body === null) return false;
  return body.includes(figure.text ?? "");
}

/**
 * Every figure this run put on paper, checked against the body it came from.
 *
 * The body is taken from the same {@link import("../src/net.js").Exchange} the
 * figure was projected out of — not from a second request, which could have
 * been answered differently and would turn a check into a coincidence.
 */
export function checkFigures(driven: readonly DrivenProfile[]): readonly FigureAssertion[] {
  const assertions: FigureAssertion[] = [];

  for (const document_ of driven) {
    for (const outcome of document_.run?.outcomes ?? []) {
      for (const readout of outcome.readouts) {
        const body = readout.exchange.response?.body ?? null;
        for (const entry of readout.figures) {
          assertions.push({
            profileId: document_.profile.id,
            stepId: outcome.stepId,
            readoutLabel: readout.label,
            figureLabel: entry.label,
            path: entry.figure.path,
            text: entry.figure.text,
            from: `${readout.exchange.request.method} ${readout.exchange.request.url}`,
            verbatim: check(entry.figure, body),
          });
        }
      }
    }
  }

  return assertions;
}
