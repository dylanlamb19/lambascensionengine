#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const micro = join(root, "acq-micro");
const list = readFileSync(join(micro, "LIST.txt"), "utf8").trim().split(/\n/).filter(Boolean);
const blob = list.map((p) => readFileSync(join(micro, p), "utf8")).join("");
const map = JSON.parse(blob);
for (const [rel, b64] of Object.entries(map)) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(b64, "base64"));
  console.log("wrote", rel);
}
const patch = join(root, "scripts/apply-acquisition-os-patches.mjs");
if (existsSync(patch) && existsSync(join(root, "src/lib/prospects/view-filter.ts"))) {
  const r = spawnSync(process.execPath, [patch], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("install-acq-os-from-payload: done");
