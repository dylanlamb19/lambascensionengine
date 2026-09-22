#!/usr/bin/env node
/**
 * Assemble Acquisition OS sources from acq-bundle-parts/*.b64 (or *.chunk).
 * Idempotent: writes files then runs apply-acquisition-os-patches.mjs.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const partsDir = join(root, "acq-bundle-parts");

function loadB64Blob() {
  const names = readdirSync(partsDir).filter((n) => /^part-\d+\.b64$/.test(n)).sort();
  if (names.length) {
    return names.map((n) => readFileSync(join(partsDir, n), "utf8")).join("");
  }
  // Fallback: numbered chunks part-NN-MM.chunk
  const chunks = readdirSync(partsDir)
    .filter((n) => /^part-\d+-\d+\.chunk$/.test(n))
    .sort();
  if (!chunks.length) throw new Error("No acq-bundle-parts found");
  // group by part number
  const byPart = new Map();
  for (const n of chunks) {
    const m = n.match(/^part-(\d+)-\d+\.chunk$/);
    const key = m[1];
    if (!byPart.has(key)) byPart.set(key, []);
    byPart.get(key).push(n);
  }
  const keys = [...byPart.keys()].sort();
  return keys
    .map((k) => byPart.get(k).sort().map((n) => readFileSync(join(partsDir, n), "utf8")).join(""))
    .join("");
}

const blob = loadB64Blob();
const map = JSON.parse(Buffer.from(blob, "base64").toString("utf8"));
for (const [rel, body] of Object.entries(map)) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  console.log("wrote", rel, body.length);
}

const patch = join(root, "scripts/apply-acquisition-os-patches.mjs");
if (existsSync(patch)) {
  const r = spawnSync(process.execPath, [patch], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("assemble-acquisition-os: done");
