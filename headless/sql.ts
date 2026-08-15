/**
 * Running a manual step's SQL — the first of the two declared differences
 * between a batch run and a browser run.
 *
 * ## What a manual step is, and why the difference is narrow
 *
 * CloFin has no endpoint that creates an actor, grants a role or sets an
 * approval threshold, and that absence is a control decision rather than a gap.
 * So a `manual` step generates the exact SQL and then **asks the API whether it
 * landed**; the step advances because the instance answered, never because a
 * button was pressed. That is the pattern the TASK-012 changelog ratified and
 * `bootstrap.ts` implements.
 *
 * In a browser the operator runs those statements against their own instance.
 * In a batch run the workflow *is* the operator — it started the database
 * minutes earlier and it is the only thing that can reach it — so it runs them
 * itself, here.
 *
 * **The confirmation half does not change.** The same `verifyManualStep` runs,
 * as the same actor the profile names, against the same instance, and the step
 * advances on the instance's answer exactly as it does in a browser. What
 * changed is who typed the SQL, and the summary says so on every such step:
 * *performed by the workflow, confirmed by the instance*. The two halves are
 * rendered together — the statements that ran, then the request that confirmed
 * them — because a step that showed only the first would be reporting that a
 * command was issued, which is not the same fact as the row existing.
 *
 * ## No shell
 *
 * The command is an argv array, not a string, and the statements go in on
 * standard input. Nothing is interpolated into a shell, so a value from a
 * profile cannot become part of the command; and the argv is rendered verbatim
 * in the summary, so how the SQL reached the database is as readable as the SQL.
 */

import { spawnSync } from "node:child_process";

/** What running one manual step's statements did. Kept whole, printed whole. */
export interface SqlExecution {
  /** The command, exactly as it was invoked. Rendered in the summary. */
  readonly argv: readonly string[];
  /** The statements, rendered with the run's values by the runner, as they were fed in. */
  readonly script: string;
  /** The process exit status. `null` when it was killed by a signal. */
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the command could not be run at all. */
  readonly failure: string | null;
}

/** Whether the statements were applied without the client reporting an error. */
export function applied(execution: SqlExecution): boolean {
  return execution.failure === null && execution.status === 0;
}

/**
 * One line describing what happened, in the words the summary uses.
 *
 * Never "done": whether the step is done is the instance's to say, one request
 * later. This describes the command only.
 */
export function describeExecution(execution: SqlExecution): string {
  if (execution.failure !== null) return `the client could not be run: ${execution.failure}`;
  if (execution.signal !== null) return `the client was killed by ${execution.signal}`;
  return `the client exited ${execution.status}`;
}

export type SqlRunner = (statements: readonly string[]) => SqlExecution;

/**
 * A runner that pipes statements into a database client.
 *
 * @param argv the client and its arguments — for example a `psql` invocation
 *   with `ON_ERROR_STOP` set, so a failing statement stops the script instead of
 *   letting the ones after it run against a half-applied state.
 */
export function clientRunner(argv: readonly string[], cwd: string): SqlRunner {
  return (statements) => {
    const script = `${statements.join("\n")}\n`;
    const [command, ...rest] = argv;

    if (command === undefined) {
      return {
        argv,
        script,
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
        failure: "no database client command was given to the driver",
      };
    }

    const result = spawnSync(command, rest, {
      cwd,
      input: script,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });

    return {
      argv,
      script,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      failure: result.error ? `${result.error.name}: ${result.error.message}` : null,
    };
  };
}

/**
 * A runner for a run that must not touch a database.
 *
 * Used when a scenario declares no manual step, and by the tests. It reports
 * that nothing ran rather than pretending something did — a driver that
 * silently no-opped here would advance a step on a confirmation that had
 * nothing to confirm.
 */
export function refusingRunner(reason: string): SqlRunner {
  return (statements) => ({
    argv: [],
    script: `${statements.join("\n")}\n`,
    status: null,
    signal: null,
    stdout: "",
    stderr: "",
    failure: reason,
  });
}
