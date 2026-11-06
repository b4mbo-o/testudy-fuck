// SPDX-License-Identifier: GPL-3.0-or-later
(async () => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let tabId, running = false, timer;
  const settings = await chrome.storage.local.get({ delayMs: 1200, autoStart: true, autoNextSet: true, speechNoise: true, noiseSeconds: 8, naturalTiming: true, noiseStyle: "rustle" });
  $("delay").value = settings.delayMs;
  $("autoStart").checked = settings.autoStart;
  $("autoNextSet").checked = settings.autoNextSet;
  $("speechNoise").checked = settings.speechNoise;
  $("noiseSeconds").value = settings.noiseSeconds;
  $("naturalTiming").checked = settings.naturalTiming;
  $("noiseStyle").value = ["taps", "continuous"].includes(settings.noiseStyle) ? settings.noiseStyle : "rustle";
  const updateLabel = () => { $("delayLabel").value = (Number($("delay").value) / 1000).toFixed(1) + "秒"; };
  updateLabel();
  $("delay").addEventListener("input", updateLabel);
  for (const id of ["delay", "autoStart", "autoNextSet", "speechNoise", "noiseSeconds", "naturalTiming", "noiseStyle"]) $(id).addEventListener("change", async () => {
    try {
      const seconds = Math.max(3, Math.min(20, Number($("noiseSeconds").value) || 8));
      $("noiseSeconds").value = seconds;
      await chrome.storage.local.set({ delayMs: Number($("delay").value), autoStart: $("autoStart").checked, autoNextSet: $("autoNextSet").checked, speechNoise: $("speechNoise").checked, noiseSeconds: seconds, naturalTiming: $("naturalTiming").checked, noiseStyle: ["taps", "continuous"].includes($("noiseStyle").value) ? $("noiseStyle").value : "rustle" });
      $("saved").textContent = "設定を保存しました。";
    } catch (error) { $("saved").textContent = error.message; }
  });
  async function refresh() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "TESTUDY_STATUS", tabId });
      if (!r?.ok) throw new Error(r?.error || "状態を取得できません。");
      running = r.running;
      $("badge").textContent = running ? "実行中" : "停止中";
      $("toggle").textContent = running ? "停止" : "開始";
      $("status").textContent = r.status?.message || "取り組む練習を選んで「開始」を押してください。";
      const logKey = "logs:" + tabId;
      const data = await chrome.storage.session.get(logKey);
      $("logs").replaceChildren(...(data[logKey] || []).slice().reverse().map((entry) => {
        const li = document.createElement("li");
        li.textContent = new Date(entry.at).toLocaleTimeString("ja-JP") + " " + entry.message;
        return li;
      }));
      $("toggle").disabled = false;
    } catch (error) { $("status").textContent = error.message; $("toggle").disabled = true; }
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://www.digcbt.com/dig/studyTest2/pages/")) throw new Error("DigCBTの練習ページを開いてください。");
    tabId = tab.id;
    await refresh();
    timer = setInterval(refresh, 1000);
  } catch (error) { $("status").textContent = error.message; }
  $("toggle").addEventListener("click", async () => {
    $("toggle").disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: "TESTUDY_RUN", tabId, running: !running });
      if (!r?.ok) throw new Error(r?.error || "実行状態を変更できません。");
      await refresh();
    } catch (error) { $("status").textContent = error.message; $("toggle").disabled = false; }
  });
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
