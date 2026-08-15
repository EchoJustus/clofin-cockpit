/**
 * The build.
 *
 *     node tools/build.mjs [--out _site]
 *
 * Four steps, and the last one can stop the other three from counting:
 *
 * 1. Compile `src/` to ES modules with `tsc`. No bundler, no minifier — what
 *    is deployed is the code in this repository with its types removed and its
 *    comments intact, so a reader can open the published page's source and
 *    read the thing that rendered it. `docs/ADR/0001` explains why that is
 *    worth more here than a smaller download.
 * 2. Copy `static/` over it.
 * 3. **Render the honesty frame into the page**, from the one canonical
 *    constant in `src/scope.ts`. The scope statement is never typed into HTML
 *    by hand; there is exactly one copy in this repository and this is where
 *    it becomes markup. That is also why it survives a JavaScript failure: it
 *    is in the document before any script runs.
 * 4. Run `guard-network.mjs` and **refuse to finish** if it objects. A site
 *    that could reach a second origin, carry a form, or store a credential is
 *    not published and then reported on — it is not built.
 */

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { guardNetwork } from "./guard-network.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FRAME_PLACEHOLDER = "<!--HONESTY-FRAME-->";

function outDir() {
  const flag = process.argv.indexOf("--out");
  return resolve(repoRoot, flag >= 0 ? (process.argv[flag + 1] ?? "_site") : "_site");
}

function compile(site) {
  const tsc = resolve(repoRoot, "node_modules", ".bin", "tsc");
  const result = spawnSync(
    tsc,
    ["--project", "tsconfig.json", "--outDir", join(site, "js")],
    { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" },
  );

  if (result.status !== 0) {
    throw new Error("tsc failed; the site was not built.");
  }
}

async function renderFrame(site) {
  // Imported from the freshly compiled output, so the constant the page gets
  // is the constant the application ships — not a second reading of the source.
  const { honestyFrameHtml } = await import(pathToFileURL(join(site, "js", "frame.js")).href);

  const indexPath = join(site, "index.html");
  const template = await readFile(indexPath, "utf8");

  if (!template.includes(FRAME_PLACEHOLDER)) {
    throw new Error(
      `static/index.html no longer contains ${FRAME_PLACEHOLDER}. The honesty frame ` +
        "has to be rendered into the page at build time; a page without that " +
        "placeholder would ship without it.",
    );
  }

  await writeFile(indexPath, template.replace(FRAME_PLACEHOLDER, honestyFrameHtml()), "utf8");
}

async function main() {
  const site = outDir();

  await rm(site, { recursive: true, force: true });
  await mkdir(site, { recursive: true });

  compile(site);
  await cp(resolve(repoRoot, "static"), site, { recursive: true });
  await renderFrame(site);

  const problems = await guardNetwork(site);
  if (problems.length > 0) {
    process.stderr.write("\nThe build refuses to publish this site:\n\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(
      `\n${problems.length} problem(s). See tools/guard-network.mjs for what is refused and why.\n`,
    );
    await rm(site, { recursive: true, force: true });
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Built ${site} — honesty frame rendered from src/scope.ts, network guard clean.\n`,
  );
}

await main();
