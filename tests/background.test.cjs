// SPDX-License-Identifier: GPL-3.0-or-later
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function worker() {
  const session = {}, invocations = [], listeners = {};
  let response = { phase: "ready", message: "ready" };
  const store = {
    async get(keys) {
      if (typeof keys === "object" && !Array.isArray(keys)) return { ...keys };
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, session[k]]));
    },
    async set(values) { Object.assign(session, values); },
    async remove(keys) { keys.forEach(key => delete session[key]); }
  };
  const chrome = {
    runtime: { getURL: (s) => "chrome-extension://test/" + s, onMessage: { addListener: (fn) => listeners.message = fn } },
    storage: { session: store, local: store },
    tabs: { get: async id => ({ id, url: "https://www.digcbt.com/dig/studyTest2/pages/main1.php" }), onRemoved: { addListener: (fn) => listeners.removed = fn } },
    scripting: { executeScript: async request => { invocations.push(request); return [{ result: response }]; } }
  };
  const context = vm.createContext({ chrome, URL, importScripts: () => {}, testudyAdapter: () => {}, console });
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"), "utf8"), context);
  const sender = { tab: { id: 1 }, url: "https://www.digcbt.com/dig/studyTest2/pages/main1.php", frameId: 0 };
  const send = (request, from = sender) => new Promise(resolve => listeners.message(request, from, resolve));
  return { session, invocations, chrome, send, sender, setResponse: value => response = value };
}

test("stopped tab uses snapshot and started tab uses step", async () => {
  const w = worker(); await w.send({ type: "TESTUDY_TICK" }); assert.equal(w.invocations[0].args[0], "snapshot");
  await w.send({ type: "TESTUDY_RUN", running: true }); await w.send({ type: "TESTUDY_TICK" }); assert.equal(w.invocations.at(-1).args[0], "step");
});
test("pause is serialized ahead of following ticks", async () => {
  const w = worker(); await w.send({ type: "TESTUDY_RUN", running: true });
  await Promise.all([w.send({ type: "TESTUDY_RUN", running: false }), w.send({ type: "TESTUDY_TICK" })]);
  assert.equal(w.invocations.at(-1).args[0], "snapshot"); assert.equal(w.session["run:1"], false);
});
test("execution stays scoped to the originating tab", async () => {
  const w = worker(); await w.send({ type: "TESTUDY_RUN", running: true });
  const other = { ...w.sender, tab: { id: 2 } };
  const result = await w.send({ type: "TESTUDY_TICK", tabId: 1 }, other);
  assert.equal(result.running, false); assert.equal(w.invocations.at(-1).target.tabId, 2); assert.equal(w.invocations.at(-1).args[0], "snapshot");
});
test("foreign origins and subframes cannot execute the adapter", async () => {
  const w = worker();
  assert.equal((await w.send({ type: "TESTUDY_TICK" }, { ...w.sender, url: "https://example.com" })).ok, false);
  assert.equal((await w.send({ type: "TESTUDY_TICK" }, { ...w.sender, frameId: 1 })).ok, false);
  assert.equal((await w.send({ type: "TESTUDY_TICK", tabId: 1 }, { url: "https://example.com" })).ok, false);
  assert.equal(w.invocations.length, 0);
});
test("blocked adapter stops only its tab and logs the stop once", async () => {
  const w = worker(); await w.send({ type: "TESTUDY_RUN", running: true });
  w.setResponse({ stop: true, phase: "blocked", message: "mismatch", answer: "private answer" });
  assert.equal((await w.send({ type: "TESTUDY_TICK" })).running, false);
  await w.send({ type: "TESTUDY_TICK" });
  assert.equal(w.session["logs:1"].length, 1); assert.equal(JSON.stringify(w.session["logs:1"]).includes("private answer"), false);
});

test("reaching final grades switches off the tab and subsequent ticks stay read-only", async () => {
  const w = worker(); await w.send({ type: "TESTUDY_RUN", running: true });
  w.setResponse({ phase: "complete", stop: true, message: "成績開示画面で停止しました。" });
  const result = await w.send({ type: "TESTUDY_TICK" });
  assert.equal(result.running, false); assert.equal(w.session["run:1"], false);
  await w.send({ type: "TESTUDY_TICK" });
  assert.equal(w.invocations.at(-1).args[0], "snapshot");
  assert.equal(w.session["logs:1"].length, 1);
});
