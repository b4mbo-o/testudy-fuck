// SPDX-License-Identifier: GPL-3.0-or-later
// Extract only script bodies. Request headers, cookies, and login URLs are never copied.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run analyze:har -- <capture.har>");
  process.exit(1);
}
const out = path.join(__dirname, "..", ".analysis");
const entries = JSON.parse(fs.readFileSync(input, "utf8")).log.entries;
function body(filename) {
  const entry = entries.find((entry) => {
    const u = new URL(entry.request.url);
    return u.hostname === "www.digcbt.com" && u.pathname.endsWith("/" + filename) && entry.response.content.text;
  });
  if (!entry) throw new Error(filename + " のレスポンス本文がHARにありません。");
  const content = entry.response.content;
  return content.encoding === "base64" ? Buffer.from(content.text, "base64").toString("utf8") : content.text;
}
const source = body("kukangainen.min.js");
function extractFunction(name, source) {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("記録と異なる難読化形式です。");
  let quote = null, escaped = false, depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (["'", '"', "`"].includes(char)) quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("文字列表の終端がありません。");
}
function decodeBundle(source, table, decoder, alias, rotationEnd, startToken) {
  const endRotation = source.indexOf(rotationEnd);
  if (endRotation < 0) throw new Error("このHARの難読化形式には未対応です。");
  const setup = extractFunction(table, source) + "\n" + extractFunction(decoder, source) + "\n" + source.slice(source.indexOf("(function("), endRotation + 1);
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(setup, context, { timeout: 3000 });
  const aliases = new Set([alias, decoder]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of source.matchAll(/(_0x[\da-f]+)\s*=\s*(_0x[\da-f]+)\b/g)) {
      if (aliases.has(m[2]) && !aliases.has(m[1])) { aliases.add(m[1]); changed = true; }
    }
  }
  const decoded = source.replace(/(_0x[\da-f]+)\((0x[\da-f]+)\)/g, (match, name, hex) => aliases.has(name) ? JSON.stringify(context[decoder](Number(hex))) : match);
  const start = decoded.indexOf(startToken);
  if (start < 0) throw new Error("問題定義の開始位置がありません。");
  return `const ${alias} = () => "";\n` + decoded.slice(start);
}
fs.mkdirSync(out, { recursive: true });
// Skip the bundle's self-defending/console-rewriting initialization for local replay.
fs.writeFileSync(path.join(out, "site-decoded.js"), decodeBundle(source, "_0x534b", "_0x4978", "_0x45a7aa", ";const _0x51e01b", "var itemdefine="));
try {
  fs.writeFileSync(path.join(out, "speech-decoded.js"), decodeBundle(body("kukangainen2.min.js"), "_0x1b76", "_0x23c1", "_0x20992d", ";const _0x388320", "const azure_url="));
} catch (error) { console.log("音声評価JSの抽出: " + error.message); }
fs.writeFileSync(path.join(out, "jquery-3.6.0.min.js"), body("jquery-3.6.0.min.js"));
const datasets = [];
for (const entry of entries) {
  if (!new URL(entry.request.url).pathname.endsWith("/php/getcontents.php") || !entry.response.content.text) continue;
  const content = entry.response.content;
  const value = JSON.parse(content.encoding === "base64" ? Buffer.from(content.text, "base64").toString("utf8") : content.text);
  // Only exercise fields; never extract tokens, response keys or account data.
  const allowed = ["ID", "Chinese", "Japanese", "Real_Pinyin", "Pinyin", "Question0", "Question1", "Answer0", "Answer1", "CorrectAnswer", "CN", "CN_Splitted", "MaxLength", ...Array.from({ length: 8 }, (_, i) => "Word" + i)];
  datasets.push(Object.fromEntries(["word", "s1", "s3"].map(type => [type, (value[type] || []).map(row => Object.fromEntries(allowed.filter(key => key in row).map(key => [key, row[key]])))])));
}
fs.writeFileSync(path.join(out, "exercise-data.json"), JSON.stringify(datasets));
console.log(`記録済みサイトJS・jQueryと問題データ${datasets.length}セットを .analysis に抽出しました（外部通信なし）。`);
