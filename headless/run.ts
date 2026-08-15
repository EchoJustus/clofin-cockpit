/**
 * The headless entry point: one scenario, end to end, and the evidence.
 *
 * ```
 * node tmp/headless/headless/run.js \
 *   --base-url http://localhost:8080 --ref ref-1 --sha <40 hex> \
 *   --seed uat-standard --scenario scheme-play \
 *   --playbook playbooks/scheme-play.playbook.json \
 *   --psql '["docker","compose","exec","-T","postgres","psql","-v","ON_ERROR_STOP=1","-U","clofin","-d","clofin"]'
 * ```
 *
 * ## It is the same cockpit, without a browser
 *
 * Every document is read by `profiles.ts`, every step performed by
 * `bootstrap.ts`, every identity held by `acting.ts`, every figure projected by
 * `figures.ts`, every request made by `net.ts`, and the connection made by
 * `instance.ts` through the same honesty gate — an address whose `GET /` carries
 * no disclaimer is refused here exactly as it is on screen. This file supplies
 * the two things a browser gets from the person sitting at it: arguments, and
 * somewhere to write the result.
 *
 * ## The walk, not a step
 *
 * A flow declares what it `requires`, and the flows are listed in the order the
 * product's own story runs in. So a scenario is executed by running the seed
 * profile and then the flows **up to and including** the one asked for: playing
 * the scheme needs a released batch, and a released batch needs a payment that
 * somebody other than its maker approved. The order is `profiles.ts`'s
 * `FLOW_IDS`, read rather than restated, and the summary prints the chain it
 * ran.
 *
 * ## What makes the job fail
 *
 * A refused connection, a document that would not start, a step the instance
 * did not answer as the document said it would, a choice the playbook does not
 * answer, SQL that did not apply, a manual step the instance would not confirm,
 * or a figure whose text is not in the body it came from. Each one names the
 * step. Nothing is retried and nothing is skipped: a batch run that recovered
 * from a surprise would be hiding the most interesting thing it found.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { connectToInstance, matchTag, type ConnectedInstance } from "../src/instance.js";
import { connectOrigin } from "../src/net.js";
import { decideInstanceUrl } from "../src/origins.js";
import { FLOW_IDS, PROFILE_IDS, readProfile, type Profile } from "../src/profiles.js";
import { RELEASE_TAG_PATTERN } from "../src/core-repo.js";
import { buildReleaseRecords, fetchReleaseRecords, type ReleaseRecord } from "../src/releases.js";
import { probeAnonymousRuns } from "./anonymous.js";
import { driveProfile, type DrivenProfile } from "./drive.js";
import { anyFailed, checkFigures, failedOnly } from "./figures-check.js";
import { checkAgainstProfile, readPlaybook, type Playbook } from "./playbook.js";
import { clientRunner, refusingRunner, type SqlRunner } from "./sql.js";
import { renderSummary, type RunReport } from "./summary.js";

interface Arguments {
  readonly baseUrl: string;
  readonly ref: string;
  readonly sha: string;
  readonly seed: string;
  readonly scenario: string;
  readonly playbookPath: string | null;
  readonly bootMethod: string;
  readonly repoRoot: string;
  readonly psql: readonly string[] | null;
  readonly summaryPath: string | null;
  readonly workflowRunUrl: string | null;
  /** Raw Releases API document, when the caller read it rather than this run. */
  readonly releasesPath: string | null;
  /** Raw Tags API document, likewise. Both or neither. */
  readonly tagsPath: string | null;
  /** How they were obtained, in the caller's own words. Printed, never inferred. */
  readonly releasesSource: string;
}

class Refusal extends Error {}

function flag(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Refusal(`--${name} was given without a value.`);
  }
  return value;
}

function required(argv: readonly string[], name: string): string {
  const value = flag(argv, name);
  if (value === null) throw new Refusal(`--${name} is required.`);
  return value;
}

function readArguments(argv: readonly string[]): Arguments {
  const sha = required(argv, "sha");
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    // The summary's provenance line is this value. A short SHA, a branch name
    // or a tag would each render as a commit and be none.
    throw new Refusal(
      `--sha must be a full 40-character commit id; got ${JSON.stringify(sha)}. The workflow ` +
        "resolves it with git rev-parse against the checkout it made.",
    );
  }

  const scenario = required(argv, "scenario");
  if (!FLOW_IDS.includes(scenario)) {
    throw new Refusal(
      `--scenario must be one of the flow documents this build ships (${FLOW_IDS.join(", ")}); ` +
        `got ${JSON.stringify(scenario)}.`,
    );
  }

  const seed = required(argv, "seed");
  if (!PROFILE_IDS.includes(seed)) {
    throw new Refusal(
      `--seed must be one of the seed profiles this build ships (${PROFILE_IDS.join(", ")}); ` +
        `got ${JSON.stringify(seed)}.`,
    );
  }

  const psqlRaw = flag(argv, "psql");
  let psql: readonly string[] | null = null;
  if (psqlRaw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(psqlRaw) as unknown;
    } catch {
      throw new Refusal("--psql must be a JSON array of command arguments.");
    }
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Refusal("--psql must be a JSON array of strings — the command and its arguments.");
    }
    psql = parsed as readonly string[];
  }

  const releasesPath = flag(argv, "releases");
  const tagsPath = flag(argv, "tags");
  if ((releasesPath === null) !== (tagsPath === null)) {
    // The tag/SHA join needs both. One without the other would resolve every
    // release's commit to null and render "commit SHA not found" for a tag that
    // is perfectly fine — a plausible-looking wrong answer, which is the one
    // outcome `releases.ts` is arranged to avoid.
    throw new Refusal(
      "--releases and --tags are given together or not at all: the coverage line joins a " +
        "release to the commit its tag dereferences to, and one document without the other " +
        "cannot make that join.",
    );
  }

  return {
    baseUrl: required(argv, "base-url"),
    ref: required(argv, "ref"),
    sha,
    seed,
    scenario,
    playbookPath: flag(argv, "playbook"),
    bootMethod: flag(argv, "boot-method") ?? "not stated by the caller",
    repoRoot: resolve(flag(argv, "repo-root") ?? process.cwd()),
    psql,
    summaryPath: flag(argv, "summary") ?? process.env["GITHUB_STEP_SUMMARY"] ?? null,
    workflowRunUrl: flag(argv, "run-url"),
    releasesPath,
    tagsPath,
    releasesSource:
      flag(argv, "releases-source") ??
      "supplied to this run as two raw API documents, by a caller that did not say how it " +
        "obtained them",
  };
}

/** Read one profile document from the repository, or refuse it with the reason. */
function loadProfile(repoRoot: string, id: string): { profile: Profile; raw: string } {
  const path = resolve(repoRoot, "profiles", `${id}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Refusal(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Refusal(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = readProfile(parsed, raw);
  if (result.kind === "refused") {
    throw new Refusal(`${path} was refused: ${result.reason}. Nothing was run.`);
  }
  if (result.profile.id !== id) {
    throw new Refusal(
      `${path} declares the id "${result.profile.id}". A profile whose name and id disagree is ` +
        "not run.",
    );
  }
  return { profile: result.profile, raw };
}

function loadPlaybook(repoRoot: string, path: string): { playbook: Playbook; raw: string } {
  const full = resolve(repoRoot, path);
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (error) {
    throw new Refusal(`${full} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Refusal(`${full} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = readPlaybook(parsed, raw);
  if (result.kind === "refused") {
    throw new Refusal(`${full} was refused: ${result.reason}. Nothing was run.`);
  }
  return { playbook: result.playbook, raw };
}

/**
 * The documents this scenario needs, in order.
 *
 * The seed first, then every flow up to and including the one asked for. A flow
 * states what it `requires` and refuses to start without it, so this order is
 * not a convenience — running `scheme-play` alone would be refused before its
 * first request, naming the values no run on this instance had produced.
 */
export function documentChain(seed: string, scenario: string): readonly string[] {
  const upTo = FLOW_IDS.indexOf(scenario);
  return [seed, ...FLOW_IDS.slice(0, upTo + 1)];
}

/**
 * The published releases, and how they were read.
 *
 * Two transports, one mapping. When the caller supplies the two raw API
 * documents this reads them from disk; otherwise it asks the API itself,
 * anonymously, through the same `net.ts` the page uses. **Either way the
 * documents are turned into coverage by `releases.ts` and `coverage.ts`** — the
 * modules the cockpit's release browser uses, which parse the `RELEASE AUDIT:`
 * paragraph out of the body and fail closed on anything they cannot read. What
 * changes is who made the HTTP request, and that sentence is printed in the
 * summary rather than left to be assumed.
 *
 * The transport is worth offering because a hosted runner's unauthenticated
 * allowance is shared with everybody else on its address, and a coverage line
 * reading "not checked" because of somebody else's traffic is a worse artifact
 * than one that says exactly how it was obtained.
 */
async function releaseRecords(
  options: Arguments,
  log: (line: string) => void,
): Promise<{ records: readonly ReleaseRecord[] | null; whyNot: string; source: string }> {
  if (options.releasesPath !== null && options.tagsPath !== null) {
    try {
      const rawReleases = JSON.parse(readFileSync(resolve(options.releasesPath), "utf8")) as unknown;
      const rawTags = JSON.parse(readFileSync(resolve(options.tagsPath), "utf8")) as unknown;
      const records = buildReleaseRecords(rawReleases, rawTags);
      log(`mapped ${records.length} published release(s) from documents supplied to this run`);
      return { records, whyNot: "", source: options.releasesSource };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`the supplied release documents could not be read: ${reason}`);
      return {
        records: null,
        whyNot: `the release documents supplied to this run could not be read (${reason}), so this commit was not compared with any tag`,
        source: options.releasesSource,
      };
    }
  }

  try {
    const records = await fetchReleaseRecords();
    log(`read ${records.length} published release(s) from the GitHub API, anonymously`);
    return {
      records,
      whyNot: "",
      source:
        "asked of the public GitHub API by this run, through the same reader the cockpit's " +
        "release browser uses, carrying no credential",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`the published releases could not be read: ${reason}`);
    return {
      records: null,
      whyNot: `the published releases could not be read (${reason}), so this commit was not compared with any tag`,
      source:
        "asked of the public GitHub API by this run, carrying no credential — and not answered",
    };
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    process.stdout.write(`${line}\n`);
  };

  const startedAt = new Date().toISOString();
  const options = readArguments(argv);

  log(`scenario ${options.scenario}, seed ${options.seed}, ref ${options.ref} (${options.sha})`);
  log(`instance ${options.baseUrl}`);
  log(`boot: ${options.bootMethod}`);

  const decision = decideInstanceUrl(options.baseUrl);
  if (decision.kind === "refused") throw new Refusal(decision.reason);

  // The act that permits an origin. In the browser this is what connecting does;
  // here it is the address this job started the stack on, and nothing else ever
  // becomes permitted.
  connectOrigin(decision.origin);

  const connection = await connectToInstance(decision.baseUrl);
  if (connection.kind === "refused") {
    throw new Refusal(
      `the instance was refused: ${connection.reason} Nothing was run against it.`,
    );
  }
  const connected: ConnectedInstance = connection;
  log(
    `connected — ${connected.info.service}, environment ${connected.info.environment}, ` +
      `disclaimer ${connected.disclaimer.kind}`,
  );

  const { records, whyNot, source: coverageSource } = await releaseRecords(options, log);
  const tagMatch = matchTag(options.sha, records, whyNot);

  let refDisagreement: string | null = null;
  if (RELEASE_TAG_PATTERN.test(options.ref)) {
    if (tagMatch.kind === "matched" && tagMatch.tag !== options.ref) {
      refDisagreement =
        `The dispatch asked for ${options.ref}, and the commit it resolved to is the one ` +
        `${tagMatch.tag} points at. The coverage above is ${tagMatch.tag}'s, because coverage ` +
        "belongs to a commit rather than to the name used to ask for it.";
    }
    if (tagMatch.kind === "no-match") {
      refDisagreement =
        // The word for what this run may not be called is deliberately not
        // written here: the `no-unqualified-audited` check reads this file like
        // any other, and a sentence *about* the word fails it exactly as a
        // claim would. That is the rule working bluntly on purpose — the same
        // treatment `figures.ts` gives the number formatters, and 011-REQ N-5
        // and 013-REQ N-5 are the two previous times this repository learned it.
        `The dispatch asked for ${options.ref} and the commit it resolved to is not any ` +
        "published ref-<n> tag's commit, so no release-audit coverage applies to this run. " +
        "That is stated rather than smoothed over: a tag that has moved, and a tag with no " +
        "release, are both real situations, and neither of them entitles this run to a " +
        "coverage claim of any kind.";
    }
  }

  // Documents, all of them read and refused-or-accepted before the first write.
  const chain = documentChain(options.seed, options.scenario);
  log(`documents, in order: ${chain.join(" → ")}`);
  const documents = chain.map((id) => ({ id, ...loadProfile(options.repoRoot, id) }));

  const playbook = options.playbookPath
    ? loadPlaybook(options.repoRoot, options.playbookPath)
    : null;
  if (playbook) {
    log(
      `playbook ${playbook.playbook.id} v${playbook.playbook.version} for ` +
        `${playbook.playbook.scenario} — ${playbook.playbook.answers.length} declared answer(s)`,
    );

    // Cross-checked here, against the document it names, **before the first
    // write**. `driveProfile` checks it again when it reaches that document,
    // which is what makes the guarantee structural — but by then this run would
    // already have bootstrapped an organisation and moved three payments, and a
    // playbook naming an option that does not exist is a defect worth finding
    // while the instance is still untouched.
    // The playbook answers a *document*, which is not always the scenario that
    // was asked for: reaching one flow runs the ones it depends on, and a
    // choice in any of them needs an answer. So the rule is that the document
    // it names must be one this run will execute — not that it must be the
    // headline.
    const target = documents.find((entry) => entry.id === playbook.playbook.scenario);
    if (!target) {
      throw new Refusal(
        `${options.playbookPath} answers "${playbook.playbook.scenario}", which is not one of ` +
          `the documents this run would execute (${chain.join(", ")}). Nothing was run.`,
      );
    }
    const problems = checkAgainstProfile(playbook.playbook, target.profile);
    if (problems.length > 0) {
      throw new Refusal(
        `${options.playbookPath} does not match ${target.id}: ${problems.join(" ")} Nothing was run.`,
      );
    }
  }

  const runSql: SqlRunner = options.psql
    ? clientRunner(options.psql, options.repoRoot)
    : refusingRunner(
        "no database client was given to this run (--psql), so a step CloFin has no endpoint " +
          "for could not be performed. Nothing was attempted.",
      );

  const driven: DrivenProfile[] = [];
  for (const document_ of documents) {
    const result = await driveProfile({
      profile: document_.profile,
      raw: document_.raw,
      baseUrl: connected.baseUrl,
      origin: connected.origin,
      // A playbook answers exactly one document — the one it names — and
      // `checkAgainstProfile` refuses it against any other.
      playbook:
        playbook && playbook.playbook.scenario === document_.id ? playbook.playbook : null,
      runSql,
      log,
    });
    driven.push(result);
    if (result.failure) break;
  }

  const figures = checkFigures(driven);
  for (const failure of failedOnly(figures)) {
    log(
      `FIGURE NOT VERBATIM: ${failure.profileId}/${failure.stepId} ${failure.figureLabel} ` +
        `${failure.path} = ${failure.text ?? "absent"} is not in ${failure.from}`,
    );
  }

  const probe = await probeAnonymousRuns();
  log(`anonymous read probe: ${probe.outcome}`);

  const report: RunReport = {
    requestedRef: options.ref,
    resolvedSha: options.sha,
    tagMatch,
    coverageSource,
    refDisagreement,
    bootMethod: options.bootMethod,
    scenarioId: options.scenario,
    seedId: options.seed,
    documentOrder: chain,
    playbookPath: options.playbookPath,
    playbook: playbook?.playbook ?? null,
    connection: connected,
    workflowRunUrl: options.workflowRunUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
  };

  const summary = renderSummary({ report, driven, figures, probe });
  if (options.summaryPath) {
    appendFileSync(options.summaryPath, `${summary}\n`, "utf8");
    log(`summary written to ${options.summaryPath} (${summary.length} characters)`);
  } else {
    process.stdout.write(`\n${summary}\n`);
  }

  const stopped = driven.find((document_) => document_.failure !== null);
  if (stopped) {
    log(
      `the run stopped at ${stopped.profile.id}` +
        `${stopped.failure?.stepId ? `/${stopped.failure.stepId}` : ""}: ${stopped.failure?.reason ?? ""}`,
    );
    return 1;
  }
  if (anyFailed(figures)) {
    log("a figure in this run's summary is not in the body it came from; the run failed.");
    return 1;
  }

  log("every document finished and every figure is the instance's own.");
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nThis scenario run refused to proceed:\n\n  ${message}\n\n`);
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath) {
    // A refusal is evidence too, and the summary is where a reader looks.
    appendFileSync(
      summaryPath,
      `# Scenario run — refused\n\n> ${
        "This run did not start."
      }\n\n${message}\n\nNothing was run against any instance beyond what is written above.\n`,
      "utf8",
    );
  }
  process.exitCode = 1;
}
