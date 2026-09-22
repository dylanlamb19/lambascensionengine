#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const dir = "acq-bundle-parts";
const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
let buf = Buffer.alloc(0);
for (let i = 0; i < meta.parts; i++) {
  const p = path.join(dir, `part-${String(i).padStart(2, "0")}.b64`);
  buf = Buffer.concat([buf, fs.readFileSync(p)]);
}
const files = JSON.parse(buf.toString("utf8"));
for (const [rel, b64] of Object.entries(files)) {
  const abs = path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(b64, "base64"));
  console.log("wrote", rel, fs.statSync(abs).size);
}
execSync("node scripts/apply-acquisition-os-patches.mjs", { stdio: "inherit" });
