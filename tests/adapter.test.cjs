// SPDX-License-Identifier: GPL-3.0-or-later
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { testudyAdapter } = require("../site-adapter.js");

function fixture({ drill = "1", answer = "answer", words = [], correctIdx = 2, count = words.length, url } = {}) {
  const dom = new JSDOM(`<!doctype html><div id="contents"><div id="inputArea"></div><div id="selectInputArea"><div id="bar1">one</div><div id="bar2">two</div><div id="bar3">three</div></div><div id="selectArea"><div class="selectItemList"></div></div><div id="btnConfirm" status="0"></div><div id="btnNext">次へ</div></div>`, {
    url: url || `https://www.digcbt.com/dig/studyTest2/pages/main${drill}.php`, runScripts: "outside-only"
  });
  const w = dom.window, doc = w.document;
  const m = { drillType: drill, curItemIdx: 0, studyResords: [{ correctId: "q1", correctIdx }], selectedFlg: false, isTest: false };
  w.testManager = m;
  // Match the real app's top-level lexical binding, not a window property.
  vm.runInContext("let drillMainMgr = testManager", dom.getInternalVMContext());
  w.dbMgr = {
    getWordItemById: () => answer, getS1ItemById: () => answer,
    getS3ItemsByIds: () => ({ Answer: answer, MaxLength: count })
  };
  w.infoMgr = { getItemSettingInfo: () => ["Answer"] };
  w.itemdefine = { drill5items: [], drill7items: [] };
  w.decisionMgr = { isShowModeWithTypeE: () => false };
  w.utilMgr = { isEnableNextMenu: () => true };
  vm.runInContext(`window.adapter = (${testudyAdapter.toString()})`, dom.getInternalVMContext());
  const clicks = [], submissions = [];
  function grade(value) { submissions.push(value); m.selectedFlg = true; m.studyResords[0].isCorrect = true; }
  for (const n of [1, 2, 3]) doc.getElementById("bar" + n).onclick = () => { clicks.push("bar" + n); grade(n); };
  doc.getElementById("btnNext").onclick = () => { clicks.push("next"); };
  if (["6", "7"].includes(drill)) {
    doc.getElementById("inputArea").innerHTML = '<input id="userInput" maxlength="100">';
    w.jQuery = (node) => ({ trigger: (event) => { assert.equal(event.which, 13); grade(node.value); } });
    w.jQuery.Event = (_, event) => event;
  }
  if (["3", "5"].includes(drill)) {
    for (let i = 0; i < words.length; i++) {
      const node = doc.createElement("div"); node.id = "selItemId" + (i + 1); node.textContent = words[i];
      node.onclick = () => {
        clicks.push(node.id); node.style.display = "none";
        const dest = doc.createElement("div"); dest.id = "destItem" + (i + 1);
        dest.className = drill === "3" ? "drillMain3SelItemCls" : "drillMain5SelItemCls"; dest.textContent = words[i];
        doc.querySelector(".selectItemList").append(dest);
        if (doc.querySelector(".selectItemList").childElementCount === words.length) doc.getElementById("btnConfirm").setAttribute("status", "1");
      };
      doc.getElementById("inputArea").append(node);
    }
    doc.getElementById("btnConfirm").onclick = () => grade(doc.querySelector(".selectItemList").textContent);
  }
  let monotonic = 0;
  Object.defineProperty(w.performance, "now", { value: () => monotonic, configurable: true });
  const run = (op = "step", options = {}) => w.adapter(op, { delayMs: 500, naturalTiming: false, ...options });
  const advance = () => { w.__testudyHelperStateV1.lastAction = 0; };
  return { dom, w, doc, m, run, advance, clicks, submissions, elapse: ms => { monotonic += ms; } };
}

test("snapshot reads lexical site state without submitting", () => {
  const f = fixture(); assert.equal(f.run("snapshot").answer, "two"); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("choice uses actual randomized correctIdx and submits exactly once", () => {
  const f = fixture({ correctIdx: 3 }); assert.equal(f.run().action, "choose"); f.run();
  assert.deepEqual(f.submissions, [3]); assert.equal(f.run().phase, "correct"); f.dom.window.close();
});
test("site automatic transition blocks manual next until its menu is enabled", () => {
  const f = fixture(); f.run(); f.advance(); f.w.utilMgr.isEnableNextMenu = () => false; f.run();
  assert.deepEqual(f.clicks, ["bar2"]); f.w.utilMgr.isEnableNextMenu = () => true; assert.equal(f.run().action, "next"); f.dom.window.close();
});
test("input dispatches changes and submits via the site's Enter handler", () => {
  const f = fixture({ drill: "6", answer: "hello world" }); const input = f.doc.getElementById("userInput");
  const events = []; for (const type of ["input", "change", "keyup"]) input.addEventListener(type, () => events.push(type));
  assert.equal(f.run().action, "input"); assert.deepEqual(events, ["input", "change", "keyup"]); assert.deepEqual(f.submissions, ["hello world"]); f.dom.window.close();
});
test("manual input is preserved and stops automation", () => {
  const f = fixture({ drill: "7" }); const input = f.doc.getElementById("userInput"); input.value = "my answer";
  assert.equal(f.run().stop, true); assert.equal(input.value, "my answer"); assert.deepEqual(f.submissions, []); f.dom.window.close();
});
test("overlapping prefixes backtrack and identical words remain distinct", () => {
  const f = fixture({ drill: "5", answer: "abc ab abc", words: ["ab", "abc", "abc"] });
  assert.equal(f.run().action, "order"); assert.deepEqual(f.clicks, ["selItemId2", "selItemId1", "selItemId3"]); assert.deepEqual(f.submissions, ["abcababc"]); f.dom.window.close();
});
test("drill 3 character tiles are ordered and confirmed", () => {
  const f = fixture({ drill: "3", answer: "apple", words: ["p", "l", "a", "e", "p"] });
  assert.equal(f.run().action, "order"); assert.deepEqual(f.submissions, ["apple"]); f.dom.window.close();
});
test("inconsistent ordering plan does not click even the first tile", () => {
  const f = fixture({ drill: "5", answer: "I read books.", words: ["I", "read", "music"] });
  assert.equal(f.run().stop, true); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("drill 5 follows site prefix comparison for omitted ending punctuation", () => {
  const f = fixture({ drill: "5", answer: "I read books.", words: ["books", "I", "read"] });
  assert.equal(f.run().action, "order"); assert.deepEqual(f.submissions, ["Ireadbooks"]); f.dom.window.close();
});
test("drill 3 manual destination is detected on desktop", () => {
  const f = fixture({ drill: "3", answer: "ab", words: ["a", "b"] });
  f.doc.querySelector(".selectItemList").innerHTML = '<div class="drillMain3SelItemCls" id="destItem2">b</div>';
  assert.equal(f.run().stop, true); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("incorrect grade stops and never proceeds", () => {
  const f = fixture(); f.m.selectedFlg = true; f.m.studyResords[0].isCorrect = false;
  assert.equal(f.run().stop, true); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("loading and dialog overlays block all actions", () => {
  const f = fixture(); const overlay = f.doc.createElement("div"); overlay.id = "loadInfo"; f.doc.body.append(overlay);
  assert.equal(f.run().phase, "loading"); overlay.id = "dialogInfo"; assert.equal(f.run().phase, "dialog"); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("speech evaluation waits when the noise controller is unavailable", () => {
  const f = fixture({ url: "https://www.digcbt.com/dig/studyTest2/pages/speechEvaluation.php" });
  assert.equal(f.run().phase, "speech"); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("unsupported origins never read or operate page state", () => {
  const f = fixture({ url: "https://example.com/dig/studyTest2/pages/main1.php" });
  assert.equal(f.run().phase, "unsupported"); assert.deepEqual(f.clicks, []); f.dom.window.close();
});
test("start click is guarded against repeat while navigation is pending", () => {
  const f = fixture({ url: "https://www.digcbt.com/dig/studyTest2/pages/drill1.php" });
  const node = f.doc.createElement("div"); node.id = "btnStart"; node.textContent = "開始"; let n = 0; node.onclick = () => n++; f.doc.body.append(node);
  f.run(); f.advance(); f.run(); assert.equal(n, 1); f.dom.window.close();
});
test("result progression can be disabled and retry is not looped", () => {
  const f = fixture({ url: "https://www.digcbt.com/dig/studyTest2/pages/result.php" });
  assert.equal(f.run("step", { autoNextSet: false }).phase, "complete"); assert.deepEqual(f.clicks, []);
  f.doc.getElementById("btnNext").textContent = "もう一度"; f.run(); assert.deepEqual(f.clicks, []); f.dom.window.close();
});

test("final grades remain open even with auto-next enabled and a loading overlay", () => {
  const f = fixture({ url: "https://www.digcbt.com/dig/studyTest2/pages/drillTestEnd.php" });
  try {
    const loading = f.doc.createElement("div"); loading.id = "loadInfo"; f.doc.body.append(loading);
    const result = f.run("step", { autoNextSet: true });
    assert.equal(result.phase, "complete"); assert.equal(result.stop, true);
    assert.deepEqual(f.clicks, []);
    assert.equal(f.w.sessionStorage.getItem("__testudyNoiseEnabledV1"), null);
  } finally { f.dom.window.close(); }
});

test("intermediate exercise results still advance to the next exercise", () => {
  const f = fixture({ url: "https://www.digcbt.com/dig/studyTest2/pages/result.php" });
  try {
    f.w.ssmgr = { isTestMode: () => false };
    const result = f.run("step", { autoNextSet: true });
    assert.equal(result.action, "navigate"); assert.notEqual(result.stop, true);
    assert.deepEqual(f.clicks, ["next"]);
  } finally { f.dom.window.close(); }
});

test("test grades using the shared result route also stop instead of clicking next", () => {
  const f = fixture({ url: "https://www.digcbt.com/dig/studyTest2/pages/result.php" });
  try {
    f.w.ssmgr = { isTestMode: () => true };
    assert.equal(f.run("step", { autoNextSet: true }).stop, true);
    assert.deepEqual(f.clicks, []);
  } finally { f.dom.window.close(); }
});
test("missing grade is not resubmitted after timeout", () => {
  const f = fixture(); f.doc.getElementById("bar2").onclick = () => f.clicks.push("bar2");
  f.run(); f.advance(); assert.equal(f.run().stop, true); assert.deepEqual(f.clicks, ["bar2"]); f.dom.window.close();
});
test("next record resets submission guard even if question ID repeats", () => {
  const f = fixture(); f.run(); f.m.studyResords.push({ correctId: "q1", correctIdx: 1 }); f.m.curItemIdx = 1; f.m.selectedFlg = false; f.advance();
  assert.equal(f.run().action, "choose"); assert.deepEqual(f.clicks, ["bar2", "bar1"]); f.dom.window.close();
});

test("reading pause is scheduled once per question and waits in real elapsed time", () => {
  const f = fixture();
  try {
    assert.equal(f.run("step", { naturalTiming: true }).phase, "pacing");
    assert.deepEqual(f.clicks, []); f.elapse(20000);
    assert.equal(f.run("step", { naturalTiming: true }).action, "choose");
  } finally { f.dom.window.close(); }
});

test("question audio must finish before answering with paced timing", () => {
  const f = fixture();
  try {
    const audio = f.doc.createElement("audio"); audio.id = "soundObj";
    Object.defineProperties(audio, { paused: { value: false, configurable: true }, ended: { value: false }, duration: { value: 4 }, currentTime: { value: 1 } });
    f.doc.body.append(audio);
    f.run("step", { naturalTiming: true }); f.elapse(20000);
    assert.equal(f.run("step", { naturalTiming: true }).phase, "pacing"); assert.deepEqual(f.clicks, []);
    Object.defineProperty(audio, "paused", { value: true });
    assert.equal(f.run("step", { naturalTiming: true }).action, "choose");
  } finally { f.dom.window.close(); }
});
