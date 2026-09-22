#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "acq-src-chunks");
const manifest = JSON.parse(readFileSync(join(dir, "MANIFEST.json"), "utf8"));
for (const entry of manifest) {
  const body = entry.parts.map((p) => readFileSync(join(dir, p), "utf8")).join("");
  const abs = join(root, entry.dest);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  console.log("joined", entry.dest, body.length);
}
const patch = join(root, "scripts/apply-acquisition-os-patches.mjs");
if (existsSync(patch)) {
  const r = spawnSync(process.execPath, [patch], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("join-acq-src-chunks: done");
