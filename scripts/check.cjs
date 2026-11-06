// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

assert.equal(manifest.name, "Testudy-fuck");
assert.equal(manifest.version, pkg.version);
assert.equal(pkg.license, "GPL-3.0-or-later");
const referenced = new Set([
  manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(script => script.js)
]);
for (const file of referenced) {
  const resolved = path.resolve(root, file);
  assert.ok(resolved.startsWith(root + path.sep), `Invalid extension path: ${file}`);
  assert.ok(fs.statSync(resolved).isFile(), `Missing extension file: ${file}`);
}
const png = fs.readFileSync(path.join(root, "icon.png"));
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
assert.match(read("LICENSE"), /GNU GENERAL PUBLIC LICENSE/);
assert.match(read("LICENSE"), /Version 3, 29 June 2007/);

const sources = [
  ...fs.readdirSync(root).filter(file => file.endsWith(".js")),
  ...["scripts", "tests"].flatMap(dir => fs.readdirSync(path.join(root, dir))
    .filter(file => file.endsWith(".cjs")).map(file => path.join(dir, file)))
];
for (const file of sources) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${file}`);
}
console.log(`Checked manifest, icon, license and ${sources.length} JavaScript files.`);
