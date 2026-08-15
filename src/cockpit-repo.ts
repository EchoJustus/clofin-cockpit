/**
 * Where this repository is, and where its scenario runs are dispatched.
 *
 * The sibling of `core-repo.ts`, and separate from it for the same reason the
 * two repositories are separate: `clofin-core` is the system this cockpit reads
 * and drives; this is the cockpit itself. A page that confused the two would
 * eventually show one repository's runs under the other's name.
 *
 * These coordinates are fixed rather than configurable. A cockpit pointed at
 * some other repository's Actions would be listing runs of a workflow nobody
 * here wrote, under a frame that describes this one.
 */

export const COCKPIT_REPO = {
  owner: "EchoJustus",
  name: "clofin-cockpit",
  htmlUrl: "https://github.com/EchoJustus/clofin-cockpit",
} as const;

/**
 * The workflow that runs a scenario, by file name.
 *
 * The file name is the API's identifier for a workflow as well as the last
 * segment of its page, so one constant serves the link the page renders and the
 * runs the page asks for. If the file is ever renamed, both move together or
 * neither does.
 */
export const SCENARIO_WORKFLOW_FILE = "scenario-run.yml";

/**
 * The page a person goes to in order to run a scenario.
 *
 * Dispatching is a **github.com action**, performed there by somebody signed in,
 * because this phase of the cockpit holds no token and asking for one to press a
 * button would be exactly the trade this repository has not made. The page links
 * here and says so.
 */
export const SCENARIO_WORKFLOW_URL = `${COCKPIT_REPO.htmlUrl}/actions/workflows/${SCENARIO_WORKFLOW_FILE}`;

/** Where the runs of that workflow are listed, on the public API. */
export function scenarioRunsUrl(apiOrigin: string, perPage = 10): string {
  return (
    `${apiOrigin}/repos/${COCKPIT_REPO.owner}/${COCKPIT_REPO.name}` +
    `/actions/workflows/${SCENARIO_WORKFLOW_FILE}/runs?per_page=${perPage}`
  );
}
