#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const micro = join(root, "acq-micro");
const list = readFileSync(join(micro, "LIST.txt"), "utf8").trim().split(/\n/).filter(Boolean);

const remPartsPath = join(micro, "remaining.PARTS");
if (existsSync(remPartsPath)) {
  const remParts = readFileSync(remPartsPath, "utf8").trim().split(/\n/).filter(Boolean);
  const b64 = remParts.map((p) => readFileSync(join(micro, p), "utf8")).join("");
  const gz = Buffer.from(b64, "base64");
  const overlay = JSON.parse(gunzipSync(gz).toString("utf8"));
  for (const [name, content] of Object.entries(overlay)) {
    writeFileSync(join(micro, name), content);
    console.log("overlay", name);
  }
}

const fullBlob = list.map((p) => readFileSync(join(micro, p), "utf8")).join("");
const map = JSON.parse(fullBlob);
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
