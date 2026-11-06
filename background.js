// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";
importScripts("site-adapter.js");

const DEFAULTS = { delayMs: 1200, autoStart: true, autoNextSet: true, speechNoise: true, noiseSeconds: 8, naturalTiming: true, noiseStyle: "rustle" };
const queues = new Map();
function supported(value) {
  try {
    const u = new URL(value);
    return u.origin === "https://www.digcbt.com" && u.pathname.startsWith("/dig/studyTest2/pages/");
  } catch { return false; }
}
async function handle(request, sender) {
  const internal = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(""));
  const tabId = sender.tab?.id ?? (internal ? request.tabId : null);
  if (!Number.isInteger(tabId)) throw new Error("対象のタブを確認できません。");
  const tab = await chrome.tabs.get(tabId);
  if (!supported(tab.url) || (sender.tab && (!supported(sender.url) || sender.frameId !== 0))) {
    throw new Error("DigCBTの問題ページで開いてください。");
  }
  const runKey = "run:" + tabId, statusKey = "status:" + tabId;
  if (request.type === "TESTUDY_RUN") {
    if (internal) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    }
    await chrome.storage.session.set({ [runKey]: request.running === true });
    const settings = await chrome.storage.local.get(DEFAULTS);
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: (enabled) => {
      try {
        if (enabled) sessionStorage.setItem("__testudyNoiseEnabledV1", "1");
        else sessionStorage.removeItem("__testudyNoiseEnabledV1");
      } catch {}
      if (!enabled) window.__testudyNoiseV1?.stop();
      else window.__testudyNoiseV1?.reset();
    }, args: [request.running === true && settings.speechNoise !== false] });
    return { running: request.running === true };
  }
  if (request.type !== "TESTUDY_TICK" && request.type !== "TESTUDY_STATUS") throw new Error("不明な操作です。");
  const stored = await chrome.storage.session.get([runKey, statusKey]);
  const running = stored[runKey] === true;
  if (request.type === "TESTUDY_STATUS") return { running, status: stored[statusKey] || null };
  const settings = await chrome.storage.local.get(DEFAULTS);
  if (/\/speechEvaluation\.php(?:[?#]|$)/i.test(tab.url)) {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["speech-noise.js"] });
  }
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", func: testudyAdapter,
    args: [running ? "step" : "snapshot", settings]
  });
  const status = execution?.result || { phase: "loading", message: "ページの読み込みを待っています。" };
  const nextRunning = running && !status.stop;
  await chrome.storage.session.set({ [runKey]: nextRunning, [statusKey]: { ...status, at: Date.now() } });
  if (running && (status.action || status.stop)) {
    const logKey = "logs:" + tabId;
    const logData = await chrome.storage.session.get(logKey);
    const logs = logData[logKey] || [];
    // No account/session data or answer text is included in the log.
    logs.push({ at: Date.now(), message: status.message, drill: status.drill, current: status.current });
    await chrome.storage.session.set({ [logKey]: logs.slice(-30) });
  }
  return { running: nextRunning, status };
}

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (!request?.type?.startsWith("TESTUDY_")) return;
  const id = sender.tab?.id ?? request.tabId;
  const prior = queues.get(id) || Promise.resolve();
  const work = prior.catch(() => {}).then(() => handle(request, sender));
  queues.set(id, work);
  work.then((result) => respond({ ok: true, ...result }), (error) => respond({ ok: false, error: error.message }));
  work.finally(() => { if (queues.get(id) === work) queues.delete(id); }).catch(() => {});
  return true;
});

chrome.tabs.onRemoved.addListener((id) => {
  chrome.storage.session.remove(["run:" + id, "status:" + id, "logs:" + id]);
});
