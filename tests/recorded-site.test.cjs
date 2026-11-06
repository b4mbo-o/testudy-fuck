// SPDX-License-Identifier: GPL-3.0-or-later
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { testudyAdapter } = require("../site-adapter.js");
const sitePath = path.join(__dirname, "../.analysis/site-decoded.js");
const available = fs.existsSync(sitePath);

function recorded(drill, markup, setup) {
  const dom = new JSDOM("<!doctype html><body>" + markup + "</body>", {
    url: `https://www.digcbt.com/dig/studyTest2/pages/main${drill}.php`, runScripts: "dangerously", pretendToBeVisual: true
  });
  const c = dom.getInternalVMContext();
  dom.window.XMLHttpRequest = class { constructor() { throw new Error("Network disabled during HAR replay"); } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../.analysis/jquery-3.6.0.min.js"), "utf8"), c);
  vm.runInContext(fs.readFileSync(sitePath, "utf8"), c, { timeout: 5000 });
  vm.runInContext(`
    $.fx.off = true;
    drillMainMgr = new DrillMainMgrClass();
    drillMainMgr.drillType = "${drill}";
    drillMainMgr.curItemIdx = 0;
    drillMainMgr.studyResords = [{ correctId: "sample", correctIdx: 2, sel1: "a", sel2: "sample", sel3: "c" }];
    ssmgr.getEncryptInfo = () => ({ isEncrypt: false });
    infoMgr.getItemSettingInfo = () => ["CN", "Japanese", "Japanese", ""];
    drillMainMgr.showCountInfo = () => {};
    drillMainMgr.setupContentsTip = () => {};
    // Disable sound, navigation timers and decorative grading UI only.
    // The recorded site's form events, database methods and judge remain in use.
    drillMainMgr.onConfirmWithDrill = function(data) {
      if (!data) {
        data = { selText: document.getElementById("userInput")?.value ||
          [...document.querySelectorAll("#selectArea .selectItemList > div")].map(n => n.textContent).join(" "),
          selItemCnt: document.querySelectorAll("#selectArea .selectItemList > div").length };
      }
      mainLogicMgr.onJudgeResultForInput(this.drillType, this.studyResords[0], data);
      this.selectedFlg = true;
    };
    ${setup}
    window.adapter = (${testudyAdapter.toString()});
  `, c, { timeout: 5000 });
  return { dom, c, run: () => dom.window.adapter("step", { delayMs: 500, naturalTiming: false }), record: () => vm.runInContext("drillMainMgr.studyResords[0]", c) };
}

test("HAR site: actual choice event feeds correctIdx into the recorded judge", { skip: !available }, () => {
  const f = recorded("1", '<div id="selectInputArea"></div>', `
    $("#selectInputArea").bind("drill1ChkEvent", (_, data) => drillMainMgr.onConfirmWithDrill(data));
    new DrillMain12MgrClass(drillMainMgr).setupDrill1Items("#selectInputArea", {sel1Title:"first",sel2Title:"correct",sel3Title:"last"});
  `);
  try { assert.equal(f.run().action, "choose"); assert.equal(f.record().isCorrect, true); assert.equal(f.record().checkIdx, "2"); }
  finally { f.dom.window.close(); }
});

test("HAR site: recorded input handler accepts synthesized jQuery Enter", { skip: !available }, () => {
  const f = recorded("6", '<div id="inputArea"></div><div id="selectArea"></div>', `
    sessionStorage.setItem("records_s1", JSON.stringify([{ID:"sample",CN:"hello world"}]));
    new DrillMain46MgrClass(drillMainMgr).setupDrill6Items("#inputArea", "#selectArea", {CorrectAnswer:"hello world"});
  `);
  try { assert.equal(f.run().action, "input"); assert.equal(f.record().isCorrect, true); assert.equal(f.record().input, "hello world"); }
  finally { f.dom.window.close(); }
});

for (const drill of ["3", "5"]) test(`HAR site: drill ${drill} actual tile handlers and judge accept the ordering`, { skip: !available }, () => {
  const f = recorded(drill, '<div id="inputArea"></div><div id="selectArea"><div class="selectItemList"></div></div><div id="btnReset" list=""></div><div id="btnConfirm" status="1"></div>', `
    sessionStorage.setItem("records_word", JSON.stringify([{ID:"sample",CN:"apple"}]));
    sessionStorage.setItem("records_s3", JSON.stringify([{ID:"sample",CN:"I read books.", MaxLength:"3",Word0:"books",Word1:"I",Word2:"read"}]));
    itemdefine.drill5items = ["CN","MaxLength","Word0","Word1","Word2"];
    const words = ${drill === "3" ? '["p","l","a","e","p"]' : '["books","I","read"]'};
    words.forEach((word,i) => {
      const node = $("<div id='selItemId"+(i+1)+"'><span>"+word+"</span></div>");
      node.click(() => ${drill === "3" ? 'DrillMain3MgrClass.onSelDrill3Item' : 'DrillMain57MgrClass.onSelDrill5Item'}("{}","#selectArea","selectItemList","selItemId"+(i+1),i+1,words.length));
      $("#inputArea").append(node);
    });
    $("#btnConfirm").click(() => drillMainMgr.onConfirmWithDrill());
  `);
  try { assert.equal(f.run().action, "order"); assert.equal(f.record().isCorrect, true); }
  finally { f.dom.window.close(); }
});

const dataPath = path.join(__dirname, "../.analysis/exercise-data.json");
const datasets = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : [];
for (const [setIndex, data] of datasets.entries()) {
  for (const [drill, type, field] of [["3", "word", "Chinese"], ["5", "s3", "CN"], ["6", "s1", "CorrectAnswer"]]) {
    test(`HAR content set ${setIndex + 1}: drill ${drill} renders and grades all ${data[type].length} captured exercises`, () => {
      for (const row of data[type]) {
        const safeRow = { ...row, ID: "sample" };
        const f = recorded(drill, '<div id="inputArea"></div><div id="selectArea"></div><div id="confirmArea"></div><div id="btnReset" list=""></div>', `
          const captured = ${JSON.stringify(safeRow)};
          // The recorded course uses research type 5 (English, case-insensitive ordering).
          ssmgr.getResearchType = () => "5";
          sessionStorage.setItem("records_${type}", JSON.stringify([captured]));
          infoMgr.getItemSettingInfo = () => [${JSON.stringify(field)},"Japanese","Japanese",""];
          if (${drill} === 3) new DrillMain3MgrClass(drillMainMgr).setupDrill3Items("#inputArea", "#selectArea", captured);
          if (${drill} === 5) new DrillMain57MgrClass(drillMainMgr).setupDrill5Items("#inputArea", "#selectArea", captured);
          if (${drill} === 6) new DrillMain46MgrClass(drillMainMgr).setupDrill6Items("#inputArea", "#selectArea", captured);
          if (${drill} !== 6) uiCtlMgr.setupConfirmControls("#selectArea", "#confirmArea", () => drillMainMgr.onConfirmWithDrill(), () => {});
          if (${drill} !== 6) $("#selectArea").bind("drill${drill}ChkEvent", () => drillMainMgr.onSwitchConfirmItemStatus());
        `);
        try {
          const result = f.run();
          assert.equal(result.phase, "answering", result.message);
          assert.equal(f.record().isCorrect, true, `Recorded site rejected drill ${drill}`);
        } finally { f.dom.window.close(); }
      }
    });
  }
}
