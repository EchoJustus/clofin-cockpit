/**
 * Does the public API serve this workflow's runs to a reader with no
 * credential? Asked, not assumed.
 *
 * The batch-runs page promises to list recent runs **only if** an anonymous
 * read is served for a public repository, and to say why the list is absent
 * otherwise. That promise has to rest on an answer from GitHub rather than on
 * anybody's recollection of the API documentation — including on a network
 * whose egress happens to add a credential to outgoing requests, where a
 * developer's own check would come back a cheerful `200` that says nothing
 * about what a reader gets.
 *
 * A workflow runner is the right place to settle it: the job holds a token in
 * an environment variable that nothing here reads, and nothing between this
 * process and GitHub adds one. So the request below carries `Accept` and
 * nothing else — the header set `net.ts` sends for every GitHub read — and its
 * answer is printed into the summary with the headers that were sent beside it,
 * so a reader can see for themselves what the question was.
 *
 * The probe never fails the job. Whether the anonymous API serves a list is a
 * fact about GitHub, not a defect in this run; the run records it and the page
 * behaves accordingly.
 */

import { scenarioRunsUrl } from "../src/cockpit-repo.js";
import { exchange, GITHUB_API_ORIGIN, parseJson } from "../src/net.js";
import { buildRuns } from "../src/runs.js";

/** What the probe asked, what came back, and what the page does about it. */
export interface AnonymousProbe {
  readonly url: string;
  /** The header names the request carried. Printed so “anonymous” is checkable. */
  readonly headersSent: readonly string[];
  readonly status: number | null;
  /** One line: the answer, in GitHub's terms. */
  readonly outcome: string;
  /** One line: what the batch-runs page will therefore do. */
  readonly consequence: string;
}

export async function probeAnonymousRuns(): Promise<AnonymousProbe> {
  const url = scenarioRunsUrl(GITHUB_API_ORIGIN);
  const headers = { Accept: "application/vnd.github+json" };
  const result = await exchange({ method: "GET", url, headers });
  const headersSent = result.request.headers.map(([name]) => name);

  if (!result.response) {
    return {
      url,
      headersSent,
      status: null,
      outcome: `the request did not complete: ${result.failure ?? "no response"}`,
      consequence:
        "the page cannot tell whether the list is served, so it renders the link to the " +
        "workflow and states that the list could not be read. It asks for nothing.",
    };
  }

  const { status, statusText, headers: answered, body } = result.response;
  const asked = `from a request carrying ${headersSent.join(", ")} and no credential of any kind`;

  if (status === 200) {
    const runs = buildRuns(parseJson(body));
    return {
      url,
      headersSent,
      status,
      outcome: `${status} ${statusText} — ${runs.length} run(s) listed, ${asked}`,
      consequence:
        "the batch-runs page renders its recent-runs list from exactly this read, in the " +
        "reader's own browser, with no token anywhere in the page.",
    };
  }

  // A spent quota and a refusal are different answers and must not collapse
  // into one. GitHub's unauthenticated allowance is per network address, and a
  // hosted runner's address is shared with everybody else on it — so a `403`
  // with nothing left says something about this runner's neighbours, not about
  // whether the endpoint is served without a credential. Reporting the second
  // when the first happened would be this repository claiming to have settled a
  // question it did not.
  const remaining = answered.find(([name]) => name === "x-ratelimit-remaining")?.[1];
  if ((status === 403 || status === 429) && remaining === "0") {
    return {
      url,
      headersSent,
      status,
      outcome:
        `${status} ${statusText} — the unauthenticated allowance for this runner's network ` +
        `address is spent (x-ratelimit-remaining: 0), ${asked}`,
      consequence:
        "this run could not settle whether the list is served without a credential, and does " +
        "not claim to have. The page makes the same request from the reader's own browser and " +
        "their own address, and renders either the list or the answer it got. It asks for " +
        "nothing either way.",
    };
  }

  // A `404` from this endpoint has two possible meanings and the run cannot
  // tell them apart: a repository the reader may not see answers the same way
  // as a workflow file that is not on the default branch yet. Saying which one
  // it was would be a guess, so it says both.
  if (status === 404) {
    return {
      url,
      headersSent,
      status,
      outcome: `${status} ${statusText} — ${asked}`,
      consequence:
        "either this workflow is not on the default branch yet or the repository is not " +
        "readable without a credential, and this request cannot tell those apart. The page " +
        "renders whichever answer it gets in the reader's own browser and states it; it does " +
        "not ask for a token in either case.",
    };
  }

  return {
    url,
    headersSent,
    status,
    outcome: `${status} ${statusText} — ${asked}`,
    consequence:
      "the list is not served to a request with no credential, so the batch-runs page renders " +
      "none. It shows this answer as the reason, keeps the link to the workflow on github.com, " +
      "and does not ask the reader for a token.",
  };
}
