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
 * 2. Copy `static/` over it, and `profiles/` beside it. A seed profile is data
 *    in this repository, served as the JSON file it is — so the document the
 *    deployed cockpit executes can be fetched and diffed against the one in
 *    the repository, which a profile compiled into a bundle could not be.
 * 3. **Render the honesty frame into the page**, from the one canonical
 *    constant in `src/scope.ts`, **and the Content-Security-Policy**, from the
 *    one rule in `src/origins.ts`. Neither is ever typed into HTML by hand:
 *    there is exactly one copy of each in this repository and this is where
 *    both become markup. That is also why the scope statement survives a
 *    JavaScript failure — it is in the document before any script runs.
 * 4. Run `guard-network.mjs` and **refuse to finish** if it objects. A site
 *    that could reach somewhere it should not, persist something it should
 *    not, or carry a credential is not published and then reported on — it is
 *    not built.
 */

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { guardNetwork } from "./guard-network.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FRAME_PLACEHOLDER = "<!--HONESTY-FRAME-->";
const CSP_PLACEHOLDER = "<!--CONTENT-SECURITY-POLICY-->";

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

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

async function renderPage(site) {
  // Imported from the freshly compiled output, so what the page gets is what
  // the application ships — not a second reading of the source.
  const { honestyFrameHtml } = await import(pathToFileURL(join(site, "js", "frame.js")).href);
  const { contentSecurityPolicy } = await import(
    pathToFileURL(join(site, "js", "origins.js")).href
  );

  const indexPath = join(site, "index.html");
  let page = await readFile(indexPath, "utf8");

  for (const [placeholder, what] of [
    [FRAME_PLACEHOLDER, "honesty frame"],
    [CSP_PLACEHOLDER, "Content-Security-Policy"],
  ]) {
    if (!page.includes(placeholder)) {
      throw new Error(
        `static/index.html no longer contains ${placeholder}. The ${what} is rendered into ` +
          "the page at build time; a page without that placeholder would ship without it.",
      );
    }
  }

  page = page.replace(FRAME_PLACEHOLDER, honestyFrameHtml());
  page = page.replace(
    CSP_PLACEHOLDER,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(contentSecurityPolicy())}" />`,
  );

  await writeFile(indexPath, page, "utf8");
}

async function main() {
  const site = outDir();

  await rm(site, { recursive: true, force: true });
  await mkdir(site, { recursive: true });

  compile(site);
  await cp(resolve(repoRoot, "static"), site, { recursive: true });
  await cp(resolve(repoRoot, "profiles"), join(site, "profiles"), { recursive: true });
  await renderPage(site);

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
