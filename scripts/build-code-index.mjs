import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const roots = ["src", "scripts", "migrations", ".github/workflows"];
const rootFiles = ["package.json", "tsconfig.json", "vite.config.ts", "vercel.json"];
const blocked = /(^|\/)\.env($|\.)|(^|\/)\.git(\/|$)|(^|\/)node_modules(\/|$)/;

function walk(dir, out) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const abs = join(dir, name);
    const path = relative(root, abs).replace(/\\/g, "/");
    if (!path || path.includes("..") || blocked.test(path)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walk(abs, out);
      continue;
    }
    if (!/\.(ts|tsx|mjs|js|sql|yml|yaml|json|md)$/.test(name) || st.size > 180_000) continue;
    if (path.endsWith("src/lib/codebase/snapshot.json")) continue;
    out.push({ path, text: readFileSync(abs, "utf8") });
  }
}

const files = [];
for (const dir of roots) walk(join(root, dir), files);
for (const file of rootFiles) {
  try { files.push({ path: file, text: readFileSync(join(root, file), "utf8") }); } catch { /* optional */ }
}
function git(args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 4000 }).trim(); } catch { return ""; }
}
const raw = git(["log", "-15", "--pretty=format:%h%x09%s"]);
const index = {
  repo: "dylanlamb19/lambascensionengine",
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown",
  sha: git(["rev-parse", "HEAD"]) || process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  productionSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
  indexedAt: new Date().toISOString(),
  files,
  commits: raw ? raw.split("\n").filter(Boolean).map((line) => {
    const [sha, subject] = line.split("\t");
    return { sha, subject: subject || "" };
  }) : [],
};
writeFileSync(join(root, "src/lib/codebase/snapshot.json"), JSON.stringify(index));
console.log(`code index ${index.sha} files=${files.length}`);
