// SPDX-License-Identifier: GPL-3.0-or-later
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextEncoder } = require("node:util");
const { JSDOM } = require("jsdom");
const { makeNoiseWav } = require("../speech-noise.js");
const script = fs.readFileSync(path.join(__dirname, "../speech-noise.js"), "utf8");
const recordedPath = path.join(__dirname, "../.analysis/speech-decoded.js");

test("noise generator creates bounded, non-silent 16kHz mono PCM WAV", () => {
  const bytes = makeNoiseWav(8, 123);
  const b = Buffer.from(bytes), view = new DataView(bytes);
  assert.equal(b.subarray(0, 4).toString(), "RIFF"); assert.equal(b.subarray(8, 12).toString(), "WAVE");
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16); assert.equal(bytes.byteLength, 44 + 8 * 16000 * 2);
  let square = 0, peak = 0;
  for (let i = 44; i < bytes.byteLength; i += 2) { const value = view.getInt16(i, true) / 32768; square += value * value; peak = Math.max(peak, Math.abs(value)); }
  assert.ok(Math.sqrt(square / (8 * 16000)) > 0.01); assert.ok(peak < 0.81);
  assert.notDeepEqual(b, Buffer.from(makeNoiseWav(8, 124)));
  assert.equal(makeNoiseWav(-10, 1).byteLength, 44 + 0.05 * 16000 * 2);
  assert.equal(makeNoiseWav(100, 1).byteLength, 44 + 60 * 16000 * 2);
});

function waveformStats(bytes) {
  const view = new DataView(bytes);
  let sum = 0, mean = 0, peak = 0, quiet = 0, frames = 0;
  for (let start = 44; start < bytes.byteLength; start += 640) {
    let energy = 0, count = 0;
    for (let i = start; i < Math.min(start + 640, bytes.byteLength); i += 2) {
      const value = view.getInt16(i, true) / 32768;
      energy += value * value; sum += value * value; mean += value; peak = Math.max(peak, Math.abs(value)); count++;
    }
    if (Math.sqrt(energy / count) < 0.01) quiet++;
    frames++;
  }
  const count = (bytes.byteLength - 44) / 2;
  return { rms: Math.sqrt(sum / count), peak, dc: mean / count, quietFraction: quiet / frames };
}

test("rustling maintains stable RMS, headroom and more sustained sound than the old taps", () => {
  for (const seed of [1, 123, 456]) {
    const old = waveformStats(makeNoiseWav(8, seed, "taps"));
    const next = waveformStats(makeNoiseWav(8, seed, "rustle"));
    assert.ok(next.rms > 0.105 && next.rms < 0.12);
    assert.ok(next.rms > old.rms * 1.8);
    assert.ok(next.quietFraction < old.quietFraction);
    assert.ok(next.peak <= 0.801); assert.ok(Math.abs(next.dc) < 0.002);
  }
});

test("all noise profiles preserve duration and produce deterministic data for a supplied seed", () => {
  for (const style of ["taps", "rustle", "continuous"]) {
    const bytes = makeNoiseWav(1.25, 123, style);
    assert.equal(bytes.byteLength, 44 + 1.25 * 16000 * 2);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(makeNoiseWav(1.25, 123, style)));
  }
  assert.notDeepEqual(Buffer.from(makeNoiseWav(1.25, 123, "taps")), Buffer.from(makeNoiseWav(1.25, 123, "rustle")));
});

test("continuous candidate reduces quiet gaps and keeps its configured level without clipping", () => {
  for (const seed of [1, 123, 456]) {
    const standard = waveformStats(makeNoiseWav(8, seed, "rustle"));
    const candidate = waveformStats(makeNoiseWav(8, seed, "continuous"));
    assert.ok(candidate.quietFraction < standard.quietFraction);
    assert.ok(candidate.rms > 0.12 && candidate.rms < 0.13);
    assert.ok(candidate.peak <= 0.801 && Math.abs(candidate.dc) < 0.002);
  }
});

function environment({ initialFlag = false, recorded = false, url } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="contents"><div id="recordBtn" class="recordBtnStartCls"></div></div></body>', {
    url: url || "https://www.digcbt.com/dig/studyTest2/pages/speechEvaluation.php", runScripts: "outside-only", pretendToBeVisual: true
  });
  const w = dom.window, c = dom.getInternalVMContext(), requests = [];
  let now = 100000, wall = 100000, realMic = 0;
  w.Date.now = () => wall;
  Object.defineProperty(w.performance, "now", { value: () => now, configurable: true });
  w.TextEncoder = TextEncoder;
  w.MediaStream = class { getTracks() { return []; } };
  const originalGet = async () => { realMic++; return new w.MediaStream(); };
  Object.defineProperty(w.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: originalGet } });
  if (initialFlag) w.sessionStorage.setItem("__testudyNoiseEnabledV1", "1");
  if (recorded) {
    // No real network calls: capture the site's request and supply test responses.
    w.XMLHttpRequest = class {
      constructor() { this.headers = {}; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(key, value) { this.headers[key.toLowerCase()] = value; }
      send(blob) { this.body = blob; requests.push(this); }
    };
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../.analysis/jquery-3.6.0.min.js"), "utf8"), c);
    vm.runInContext(fs.readFileSync(recordedPath, "utf8"), c, { timeout: 5000 });
    vm.runInContext(`
      $.fx.off = true;
      ssmgr.setResearchType("5"); ssmgr.setDrillType("6");
      evalItems = [{ ID:"sample",ITEM_S:"Hello world.",ITEM_E:"Hello world.",Status:"1",Mark:"0",IsPassed:"0" }];
      g_totoalItemCnt = 1;
      itemTryMap.set("sample", "0");
      setSpeechEvalInfo(evalItems[0]); setSpeechLanguage("en");
      sessionStorage.setItem("IBMToken", "test-token");
      sessionStorage.setItem("TokenExpiredTime", String(Math.floor(new Date().getTime()/1000) + 3600));
      document.body.replaceChildren();
      _setupSpeechEvalControls();
      _startSttEvalProcess();
      // Exclude only decorative sounds and delayed navigation from this replay.
      playEffectSound = () => {};
      delayStart = () => {};
    `, c, { timeout: 5000 });
  } else {
    w.requests = requests;
    vm.runInContext(`
      var speechEvalStatus = "0", recordStatus = "0", g_totalTime = 30;
      const ConstRecordStatus_START = "2", ConstRecordStatus_END = "3";
      var itemTryMap = new Map([["sample", "0"]]);
      var testItem = "sample", testPrompt = "";
      function getSpeechEvalInfo() { return { itemId:testItem, eval:testPrompt }; }
      function sendNotifyMessage(status) { recordStatus = status; if (status === "2") document.getElementById("recordBtn").className = "recordBtnEndCls"; }
      function checkAcessToken(blob) { requests.push(blob); }
      function startRecording_safari() { throw new Error("Real recorder must not run in test"); }
      function stopRecording_safari() { throw new Error("Real recorder must not run in test"); }
      function _stopClock() {}
      function _stopSttEvalProcess() { speechEvalStatus = "0"; }
      function _startSttEvalProcess() { document.getElementById("recordBtn").className = "recordBtnStartCls"; }
      document.getElementById("recordBtn").onclick = () => {
        if (speechEvalStatus === "0") { speechEvalStatus = "1"; startRecording_safari(); }
        else if (speechEvalStatus === "1" && recordStatus === "2") { speechEvalStatus = "2"; stopRecording_safari(); }
      };
    `, c);
  }
  vm.runInContext(script, c);
  return { dom, w, c, requests, originalGet, realMic: () => realMic, advance: ms => { now += ms; wall += ms; }, jumpWall: ms => { wall += ms; }, step: (op = "step", settings = {}) => w.__testudyNoiseV1.step(op, { speechNoise: true, noiseSeconds: 3, naturalTiming: false, ...settings }) };
}

test("early speech permission check uses an empty virtual stream and stop restores native microphone API", async () => {
  const f = environment({ initialFlag: true });
  try {
    await f.w.navigator.mediaDevices.getUserMedia({ audio: true }); assert.equal(f.realMic(), 0);
    f.step("snapshot"); assert.equal(f.w.navigator.mediaDevices.getUserMedia, f.originalGet);
    await f.w.navigator.mediaDevices.getUserMedia({ audio: true }); assert.equal(f.realMic(), 1);
  } finally { f.w.close(); }
});
test("generated recorder starts, stops and submits once without touching a physical microphone", () => {
  const f = environment();
  try {
    assert.equal(f.step().action, "noise-start"); f.advance(3500);
    assert.equal(f.step().action, "noise-submit"); f.step(); f.advance(2000); f.step();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].size, 44 + 3.5 * 16000 * 2); assert.equal(f.realMic(), 0);
  } finally { f.w.close(); }
});
test("pause cancels an owned recording without uploading and permits resuming the same question", () => {
  const f = environment();
  try {
    const nativeStart = f.w.startRecording_safari;
    f.step(); f.advance(1000); f.w.__testudyNoiseV1.stop(); f.advance(5000);
    assert.equal(f.requests.length, 0); assert.equal(f.w.startRecording_safari, nativeStart);
    assert.equal(f.step().action, "noise-start"); f.advance(3100); f.step(); assert.equal(f.requests.length, 1);
  } finally { f.w.close(); }
});
test("noise setting OFF never starts the generated recorder", () => {
  const f = environment();
  try { assert.equal(f.step("step", { speechNoise: false }).phase, "speech"); assert.equal(f.w.navigator.mediaDevices.getUserMedia, f.originalGet); assert.equal(f.requests.length, 0); }
  finally { f.w.close(); }
});
test("missing speech response stops after timeout without repeated uploads", () => {
  const f = environment();
  try { f.step(); f.advance(3100); f.step(); f.advance(36000); assert.equal(f.step().stop, true); assert.equal(f.requests.length, 1); }
  finally { f.w.close(); }
});
test("speech controller is not installed on unrelated websites", () => {
  const f = environment({ url: "https://example.com/speechEvaluation.php" });
  try { assert.equal(f.w.__testudyNoiseV1, undefined); assert.equal(f.w.navigator.mediaDevices.getUserMedia, f.originalGet); }
  finally { f.w.close(); }
});
test("HAR speech code: native button sends generated WAV through native XHR and uses only the returned score", { skip: !fs.existsSync(recordedPath) }, () => {
  const f = environment({ recorded: true });
  try {
    assert.equal(f.step().action, "noise-start"); f.advance(3100);
    const result = f.step(); assert.equal(result.action, "noise-submit", result.message);
    assert.equal(f.requests.length, 1); const request = f.requests[0];
    assert.equal(request.method, "POST"); assert.ok(request.url.startsWith("https://japaneast.stt.speech.microsoft.com/"));
    assert.equal(request.headers["content-type"], "audio/wav; codecs=audio/pcm; samplerate=16000");
    assert.equal(request.body.size, 44 + 3.1 * 16000 * 2); assert.equal(f.realMic(), 0);
    assert.equal(vm.runInContext("evalItems[0].Mark", f.c), "0");
    request.response = vm.runInContext('({RecognitionStatus:"Success",NBest:[{AccuracyScore:42}]})', f.c);
    request.status = 200; request.readyState = 4; request.onload();
    assert.equal(vm.runInContext("evalItems[0].Mark", f.c), 42);
    assert.equal(vm.runInContext("evalItems[0].Status", f.c), "3");
    const report = f.step();
    assert.equal(report.action, "noise-result"); assert.equal(report.score, 42);
    assert.equal(report.noiseStyle, "rustle"); assert.equal(report.seconds, 3.1);
    assert.match(report.message, /42点/);
    assert.notEqual(f.step().action, "noise-result");
    assert.equal(f.requests.length, 1);
  } finally { f.w.close(); }
});

test("low score is reported unchanged once and does not trigger an extra submission", () => {
  const f = environment();
  try {
    assert.match(f.step("step", { noiseStyle: "continuous" }).message, /連続ざわつき/);
    f.advance(3100); f.step("step", { noiseStyle: "continuous" });
    vm.runInContext('var evalItems = [{ ID:"sample", Status:"3", Mark:59 }]', f.c);
    const report = f.step("step", { noiseStyle: "rustle" });
    assert.equal(report.action, "noise-result"); assert.equal(report.score, 59);
    assert.equal(report.noiseStyle, "continuous"); assert.match(report.message, /連続ざわつき：59点/);
    f.step(); assert.equal(f.requests.length, 1);
    assert.equal(vm.runInContext("evalItems[0].Mark", f.c), 59);
  } finally { f.w.close(); }
});

test("clock changes cannot shorten the recording and WAV follows the actual elapsed duration", () => {
  const f = environment();
  try {
    f.step(); f.jumpWall(600000);
    assert.equal(f.step().phase, "speech-recording"); assert.equal(f.requests.length, 0);
    f.jumpWall(-1200000); f.advance(4700); f.step();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].size, 44 + 4.7 * 16000 * 2);
  } finally { f.w.close(); }
});

test("manual early stop encodes the real short recording rather than the configured target", () => {
  const f = environment();
  try {
    f.step(); f.advance(1250); f.w.document.getElementById("recordBtn").click();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].size, 44 + 1.25 * 16000 * 2);
  } finally { f.w.close(); }
});

test("paced speech starts after a reading pause and longer prompts receive longer recording targets", () => {
  const f = environment();
  try {
    f.w.Math.random = () => 0.5;
    f.w.testPrompt = "word ".repeat(40);
    assert.equal(f.step("step", { naturalTiming: true }).phase, "speech-preparing");
    assert.equal(f.requests.length, 0); f.advance(4000);
    assert.equal(f.step("step", { naturalTiming: true }).action, "noise-start");
    f.advance(3100); assert.equal(f.step("step", { naturalTiming: true }).phase, "speech-recording");
    f.advance(1900); assert.equal(f.step("step", { naturalTiming: true }).action, "noise-submit");
    assert.equal(f.requests[0].size, 44 + 5 * 16000 * 2);
  } finally { f.w.close(); }
});

test("profile is fixed at recording start even when the setting changes before sending", async () => {
  const f = environment();
  try {
    f.w.crypto.getRandomValues = values => { values[0] = 123; return values; };
    assert.match(f.step("step", { noiseStyle: "taps" }).message, /打音/);
    f.advance(3100); f.step("step", { noiseStyle: "rustle" });
    const blob = f.requests[0];
    const actual = await new Promise((resolve, reject) => {
      const reader = new f.w.FileReader();
      reader.onload = () => resolve(Buffer.from(new Uint8Array(reader.result)));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    assert.deepEqual(actual, Buffer.from(makeNoiseWav(3.1, 123, "taps")));
  } finally { f.w.close(); }
});
