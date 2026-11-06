// SPDX-License-Identifier: GPL-3.0-or-later
/* Executed synchronously in the page's MAIN world by chrome.scripting.
 * Keep all dependencies inside the function: Chrome serializes the function.
 * The site's model is read only. Answers are submitted through existing UI events.
 */
function testudyAdapter(operation, options) {
  "use strict";
  options ||= {};
  const url = new URL(location.href);
  if (url.origin !== "https://www.digcbt.com" || !url.pathname.startsWith("/dig/studyTest2/pages/")) {
    return { phase: "unsupported", message: "対象外のページです。" };
  }
  const el = (id) => document.getElementById(id);
  const visible = (node) => {
    if (!node || !node.isConnected) return false;
    for (let parent = node; parent && parent.nodeType === 1; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      if (parent.hidden || css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse") return false;
    }
    return true;
  };
  const text = (node) => (node?.textContent || "").trim();
  const blocked = (message) => ({ phase: "blocked", message, stop: true });
  const state = window.__testudyHelperStateV1 ||= { lastAction: 0, navigation: null };
  const act = operation === "step";
  try {
    if (act && options.speechNoise !== false) sessionStorage.setItem("__testudyNoiseEnabledV1", "1");
    else sessionStorage.removeItem("__testudyNoiseEnabledV1");
  } catch {}
  const delay = Math.max(300, Math.min(10000, Number(options.delayMs) || 1200));
  const ready = Date.now() - state.lastAction >= delay;
  const click = (node, label) => {
    if (!visible(node) || node.disabled || node.getAttribute("aria-disabled") === "true") return false;
    state.lastAction = Date.now();
    node.click();
    return label;
  };
  const page = url.pathname.split("/").pop();
  const testResult = /^result\.php$/i.test(page) && typeof ssmgr !== "undefined" &&
    typeof ssmgr.isTestMode === "function" && ssmgr.isTestMode();
  if (/^drillTestEnd\.php$/i.test(page) || testResult) {
    try { sessionStorage.removeItem("__testudyNoiseEnabledV1"); } catch {}
    window.__testudyNoiseV1?.stop();
    return { phase: "complete", message: "成績開示画面で停止しました。", stop: true };
  }
  if (/speechEvaluation\.php$/i.test(url.pathname)) {
    if (window.__testudyNoiseV1) return window.__testudyNoiseV1.step(operation, options);
    return { phase: "speech", message: "発話評価です。サイトのマイクで発話してください。画面が変わると自動処理を再開します。" };
  }
  if (visible(el("loadInfo"))) return { phase: "loading", message: "サイトの読み込みを待っています。" };
  if (visible(el("dialogInfo")) || visible(el("warnInfo"))) {
    return { phase: "dialog", message: "サイトのダイアログを操作してください。閉じると再開します。" };
  }

  // The bundle declares these with let/const, so window.drillMainMgr is insufficient.
  const manager = typeof drillMainMgr !== "undefined" ? drillMainMgr : null;
  if (!manager || !/\/main\d+\.php$/i.test(url.pathname)) {
    const start = el("btnStart");
    const result = /^result\.php$/i.test(page);
    const startPage = /^drill(?:\d+|TestStart)\.php$/i.test(url.pathname.split("/").pop());
    let node = null;
    if (startPage && options.autoStart !== false && visible(start)) node = start;
    if (result && options.autoNextSet !== false && visible(el("btnNext"))) {
      const label = text(el("btnNext"));
      if (!/再挑戦|もう一度|やり直|retry|try again/i.test(label)) node = el("btnNext");
    }
    if (node) {
      const navKey = url.pathname + ":" + node.id;
      if (act && ready && state.navigation !== navKey) {
        state.navigation = navKey;
        return { phase: "navigation", message: "「" + text(node) + "」をクリックしました。", action: click(node, "navigate") };
      }
      return { phase: "navigation", message: "ページの移動を待っています。" };
    }
    return { phase: result ? "complete" : "idle", message: result ? "このセットは終了しました。" : "取り組む単元・練習をサイトで選んでください。" };
  }

  const drill = String(manager.drillType);
  const index = manager.curItemIdx;
  const records = manager.studyResords; // This spelling is used by the actual site.
  if (!Array.isArray(records) || !Number.isInteger(index) || !records[index]) {
    return { phase: "loading", message: "問題データ・結果画面を待っています。" };
  }
  const record = records[index];
  const base = { drill, current: index + 1, total: records.length };
  const reply = (phase, message, extra = {}) => ({ ...base, phase, message, ...extra });
  if (!["1", "2", "3", "4", "5", "6", "7"].includes(drill)) {
    return reply("unsupported", "この練習形式は手動で操作してください。", { stop: true });
  }
  if (state.manager !== manager || state.record !== record || state.index !== index) {
    state.manager = manager;
    state.record = record;
    state.index = index;
    state.submitted = false;
    state.ownedInput = null;
    state.ownedTiles = null;
    const prompt = ["showContents", "selectInputArea", "inputArea", "selectArea"].map(el).filter(visible).map(text).join(" ");
    const units = (prompt.match(/[A-Za-z0-9]+/g) || []).length + (prompt.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length / 2;
    let readMs = Math.max(1500, Math.min(12000, 1000 + units * 240)) * (0.8 + Math.random() * 0.4);
    if (manager.isTest && typeof totalTestTime !== "undefined" && Number(totalTestTime) > 0) readMs = Math.min(readMs, Number(totalTestTime) * 350);
    state.questionReadyAt = performance.now() + readMs;
  }
  if (manager.selectedFlg) {
    if (record.isCorrect !== true) return { ...base, ...blocked("サイトで不正解と判定されました。停止しました。表示された正答を確認してください。") };
    if (act && ready && !manager.isTest && typeof utilMgr !== "undefined" && utilMgr.isEnableNextMenu()) {
      // Automatic site transitions disable this menu until their timer finishes.
      const closer = el("btnErrClose");
      if (visible(closer)) click(closer, "close");
      const action = click(el("btnNext"), "next");
      return reply("correct", "正解。次の問題へ進みます。", { action });
    }
    return reply("correct", "正解。サイトの次問題への移動を待っています。");
  }
  if (state.submitted) {
    if (Date.now() - state.lastAction > 10000) return { ...base, ...blocked("送信後の採点を確認できません。重複送信を避けて停止しました。") };
    return reply("grading", "採点を待っています。");
  }
  if (act && options.naturalTiming !== false) {
    if (performance.now() < state.questionReadyAt) return reply("pacing", "問題を読む待ち時間です。");
    const playing = [...document.querySelectorAll("#audioArea audio, #soundObj, #userAudioId")].some((audio) =>
      !audio.paused && !audio.ended && Number.isFinite(audio.duration) && audio.duration - audio.currentTime > 0.15);
    if (playing) return reply("pacing", "問題の音声が終わるまで待っています。");
  }
  if (typeof dbMgr === "undefined" || typeof infoMgr === "undefined") return { ...base, ...blocked("サイトの問題データを読み取れません。") };
  try {
    const field = infoMgr.getItemSettingInfo(drill)?.[0];
    let answer = "", count;
    if (drill === "1" || drill === "2") {
      const n = Number(record.correctIdx);
      if (![1, 2, 3].includes(n)) return { ...base, ...blocked("正答の選択位置を確認できません。") };
      const node = el("bar" + n);
      if (!visible(node)) return reply("loading", "選択肢の表示を待っています。");
      answer = text(node);
      if (!answer) return { ...base, ...blocked("選択肢が空です。") };
      if (act && ready) {
        state.submitted = true;
        return reply("answering", "選択肢を選んで採点します。", { answer, action: click(node, "choose") });
      }
      return reply("ready", "選択問題を検出しました。", { answer });
    }
    if (!field) return { ...base, ...blocked("正答フィールドの設定を確認できません。") };
    if (drill === "3") answer = dbMgr.getWordItemById(record.correctId, field);
    if (drill === "4" || drill === "6") answer = dbMgr.getS1ItemById(record.correctId, field);
    if (drill === "5" || drill === "7") {
      const data = dbMgr.getS3ItemsByIds(record.correctId, itemdefine["drill" + drill + "items"]);
      answer = data?.[field];
      count = Number(data?.MaxLength);
    }
    if (typeof answer !== "string" || !answer.trim()) return { ...base, ...blocked("この問題の正答データがありません。") };

    const input = el("userInput");
    if (visible(input)) {
      if (input.disabled || input.readOnly) return reply("loading", "入力欄が有効になるまで待っています。");
      if (input.value && state.ownedInput !== input.value) return { ...base, ...blocked("手入力された回答があるため停止しました。続ける場合は入力欄を空にして再開してください。") };
      if (input.maxLength > 0 && answer.length > input.maxLength) return { ...base, ...blocked("正答が入力欄の文字数上限を超えています。") };
      if (act && ready) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, answer);
        state.ownedInput = answer;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" }));
        // jQuery's handler uses event.which, which native synthetic keypress omits.
        if (typeof jQuery !== "function") return { ...base, ...blocked("サイトの入力イベントを確認できません。") };
        state.submitted = true;
        state.lastAction = Date.now();
        jQuery(input).trigger(jQuery.Event("keypress", { which: 13, keyCode: 13, key: "Enter" }));
        return reply("answering", "回答を入力し、Enterで採点します。", { answer, action: "input" });
      }
      return reply("ready", "入力問題を検出しました。", { answer });
    }
    if (drill === "4") {
      const choices = [...document.querySelectorAll("#inputArea [id^='selItemId']")].filter(visible);
      const matches = choices.filter((node) => text(node) === answer.trim());
      if (matches.length !== 1) return { ...base, ...blocked("正答と一致する選択肢を一意に確認できません。") };
      if (act && ready) {
        state.submitted = true;
        return reply("answering", "選択肢を選んで採点します。", { answer, action: click(matches[0], "choose") });
      }
      return reply("ready", "選択問題を検出しました。", { answer });
    }
    if (drill !== "3" && drill !== "5") return { ...base, ...blocked("対応する回答欄がありません。") };
    const destinationSelector = "#selectArea .drillMain3SelItemCls, #selectArea .drillMain5SelItemCls";
    const destinations = [...document.querySelectorAll(destinationSelector)];
    const destinationIds = destinations.map((node) => node.id).join(",");
    if (destinations.length && state.ownedTiles !== destinationIds) return { ...base, ...blocked("手動で並べた回答があるため停止しました。リセットして再開してください。") };
    const tiles = [...document.querySelectorAll("#inputArea [id^='selItemId']")].filter(visible);
    if (!tiles.length) return reply("loading", "並べ替えの選択肢を待っています。");
    const insensitive = drill === "5" && typeof decisionMgr !== "undefined" && decisionMgr.isShowModeWithTypeE();
    const normalize = (value) => {
      const s = value.replace(/\s/g, "");
      return insensitive ? s.toUpperCase() : s;
    };
    const target = normalize(answer);
    const required = drill === "5" ? count : tiles.length;
    if (!Number.isInteger(required) || required < 1 || required > 50 || required !== tiles.length) return { ...base, ...blocked("並べ替えの選択肢数と問題データが一致しません。") };
    // Backtrack across overlapping prefixes; duplicate words keep distinct DOM IDs.
    let budget = 20000;
    function order(rest, used, path) {
      if (--budget < 0) return null;
      if (path.length === required) return drill === "5" || rest === "" ? path : null;
      const duplicate = new Set();
      for (let i = 0; i < tiles.length; i++) {
        if (used.has(i)) continue;
        const word = normalize(text(tiles[i]));
        if (!word || duplicate.has(word) || !rest.startsWith(word)) continue;
        duplicate.add(word);
        const result = order(rest.slice(word.length), new Set([...used, i]), [...path, tiles[i]]);
        if (result) return result;
      }
      return null;
    }
    const plan = order(target, new Set(), []);
    if (!plan) return { ...base, ...blocked("正答と選択肢の並びが一致しません。停止しました。") };
    if (act && ready) {
      // The plan is fully validated before changing any tile.
      for (const node of plan) node.click();
      state.ownedTiles = [...document.querySelectorAll(destinationSelector)].map((node) => node.id).join(",");
      const confirm = el("btnConfirm");
      if (!visible(confirm) || confirm.getAttribute("status") !== "1") return { ...base, ...blocked("並べ替え後に確定ボタンが有効になりませんでした。") };
      state.submitted = true;
      return reply("answering", "語句を並べ、確定して採点します。", { answer, action: click(confirm, "order") });
    }
    return reply("ready", "並べ替え問題を検出しました。", { answer });
  } catch (error) {
    return { ...base, ...blocked("サイトの構造を確認できません: " + String(error.message).slice(0, 180)) };
  }
}

if (typeof module !== "undefined") module.exports = { testudyAdapter };
