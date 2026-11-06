// SPDX-License-Identifier: GPL-3.0-or-later
(() => {
  "use strict";
  const previous = window.__testudyContentV1;
  if (previous?.isAlive()) { previous.refresh(); return; }
  document.getElementById("testudy-fuck")?.remove();
  const host = document.createElement("div");
  host.id = "testudy-fuck";
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(320px,calc(100vw - 32px));";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box}section{font:13px/1.65 system-ui,sans-serif;background:#132620;color:#effaf5;border:1px solid #47685b;border-radius:14px;box-shadow:0 6px 28px #0004;padding:14px}
    header{display:flex;align-items:center;gap:8px}strong{font-size:14px}small{margin-left:auto;color:#b0c8bc}p{margin:9px 0;overflow-wrap:anywhere}button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:6px 14px;background:#b8f6d3;color:#10291c;font-weight:700}button:disabled{opacity:.6}details{margin-top:7px;color:#bfd5c9}summary{cursor:pointer}output{display:block;white-space:pre-wrap;max-height:100px;overflow:auto;color:#fff}.fold{background:transparent;color:#bed6c9;padding:0 5px;margin-left:4px}section.compact p,section.compact details{display:none}
  </style><section><header><strong>Testudy-fuck</strong><small>停止中</small><button class="fold" title="折りたたむ" aria-label="折りたたむ">−</button></header><p role="status" aria-live="polite">問題を確認しています。</p><button id="toggle">開始</button><details><summary>今回の回答</summary><output></output></details></section>`;
  document.documentElement.append(host);
  let running = false, busy = false, disposed = false, timer;
  const status = shadow.querySelector("p"), badge = shadow.querySelector("small"), toggle = shadow.querySelector("#toggle");
  function render(result) {
    running = result.running === true;
    badge.textContent = running ? "実行中" : "停止中";
    toggle.textContent = running ? "停止" : "開始";
    const s = result.status;
    if (s) {
      const progress = s.current ? `［${s.current}/${s.total}］` : "";
      status.textContent = progress + s.message;
      shadow.querySelector("output").textContent = s.answer || "回答データはまだありません。";
    }
  }
  async function tick() {
    if (busy || disposed) return;
    busy = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "TESTUDY_TICK" });
      if (!result?.ok) throw new Error(result?.error || "拡張機能に接続できません。");
      render(result);
    } catch (error) {
      status.textContent = "接続エラー: " + error.message + " ページを再読み込みしてください。";
      running = false; badge.textContent = "接続エラー"; toggle.disabled = true;
      disposed = true;
    } finally {
      busy = false;
      if (!disposed) timer = setTimeout(tick, running ? 650 : 1800);
    }
  }
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "TESTUDY_RUN", running: !running });
      if (!result?.ok) throw new Error(result?.error || "状態を変更できません。");
      render(result);
      clearTimeout(timer); tick();
    } catch (error) { status.textContent = error.message; }
    finally { toggle.disabled = false; }
  });
  shadow.querySelector(".fold").addEventListener("click", (event) => {
    const compact = shadow.querySelector("section").classList.toggle("compact");
    event.target.textContent = compact ? "+" : "−";
    event.target.setAttribute("aria-label", compact ? "展開する" : "折りたたむ");
  });
  window.__testudyContentV1 = { isAlive: () => !disposed, refresh: () => { clearTimeout(timer); tick(); } };
  tick();
})();
