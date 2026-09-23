import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathDenied, type CodeIndex } from "./query.ts";

const ROOTS = ["src", "scripts", "migrations", ".github/workflows"];
const ROOT_FILES = ["package.json", "tsconfig.json", "vite.config.ts", "vercel.json"];
const MAX_BYTES = 180_000;

let cache: CodeIndex | null = null;

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 4000 }).trim();
  } catch {
    return "";
  }
}

function walk(root: string, dir: string, out: { path: string; text: string }[]) {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const abs = join(dir, name);
    const path = relative(root, abs).replace(/\\/g, "/");
    if (pathDenied(path)) continue;
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walk(root, abs, out);
      continue;
    }
    if (!/\.(ts|tsx|mjs|js|sql|yml|yaml|json|md)$/.test(name)) continue;
    if (st.size > MAX_BYTES) continue;
    try {
      out.push({ path, text: readFileSync(abs, "utf8") });
    } catch {
      /* unreadable files are skipped */
    }
  }
}

export function loadCodeIndex(root = process.cwd()): CodeIndex {
  const sha = git(root, ["rev-parse", "HEAD"]) || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
  if (cache && cache.sha === sha) return cache;
  const files: { path: string; text: string }[] = [];
  for (const dir of ROOTS) walk(root, join(root, dir), files);
  for (const file of ROOT_FILES) {
    if (pathDenied(file)) continue;
    try {
      const text = readFileSync(join(root, file), "utf8");
      files.push({ path: file, text });
    } catch {
      /* optional root file */
    }
  }
  const raw = git(root, ["log", "-15", "--pretty=format:%h%x09%s"]);
  const commits = raw
    ? raw.split("\n").filter(Boolean).map((line) => {
      const [commitSha, subject] = line.split("\t");
      return { sha: commitSha, subject: subject || "" };
    })
    : [];
  const productionSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  cache = {
    repo: "dylanlamb19/lamb-ascension-engine",
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown",
    sha,
    productionSha,
    indexedAt: new Date().toISOString(),
    files,
    commits,
  };
  return cache;
}

export function clearCodeIndexCache(): void {
  cache = null;
}
