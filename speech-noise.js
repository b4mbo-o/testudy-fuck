// SPDX-License-Identifier: GPL-3.0-or-later
/* MAIN-world recorder for the speech page. Only synthesized PCM is supplied;
 * the site's token acquisition, request and server grading remain unchanged. */
(() => {
  "use strict";
  const FLAG = "__testudyNoiseEnabledV1";
  function makeNoiseWav(seconds, seed, style = "rustle") {
    const sampleRate = 16000;
    const duration = Math.max(0.05, Math.min(60, Number(seconds) || 8));
    const length = Math.round(duration * sampleRate);
    const bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes);
    const ascii = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    ascii(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, length * 2, true);
    let rng = (seed >>> 0) || 0x27d4eb2d;
    const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
    if (style !== "taps") {
      const continuous = style === "continuous";
      // Sustained, band-limited rustling, with brief gaps and slower variations.
      // These are generated noise samples, not synthesized words or recordings.
      const samples = new Float32Array(length);
      let low = 0, high = 0, midLo = 0, midHi = 0, previous = 0;
      let burstStart = 0, burstLength = 0.25, nextBurst = 0, strength = 0.8;
      let sum = 0, peak = 0;
      const aLow = Math.exp(-2 * Math.PI * 180 / sampleRate);
      const aHigh = Math.exp(-2 * Math.PI * 3400 / sampleRate);
      const aMidLo = Math.exp(-2 * Math.PI * 650 / sampleRate);
      const aMidHi = Math.exp(-2 * Math.PI * 1800 / sampleRate);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        if (t >= nextBurst) {
          burstStart = t;
          burstLength = (continuous ? 0.28 : 0.16) + random() * 0.32;
          strength = (continuous ? 0.72 : 0.55) + random() * (continuous ? 0.28 : 0.45);
          nextBurst = t + burstLength + (continuous ? 0.01 : 0.025) + random() * (continuous ? 0.035 : 0.09);
        }
        const white = random() * 2 - 1;
        low = low * aLow + white * (1 - aLow);
        high = high * aHigh + white * (1 - aHigh);
        midLo = midLo * aMidLo + white * (1 - aMidLo);
        midHi = midHi * aMidHi + white * (1 - aMidHi);
        const age = t - burstStart;
        const pulse = age < burstLength ? Math.min(1, age / (continuous ? 0.015 : 0.02), (burstLength - age) / (continuous ? 0.045 : 0.06)) : 0;
        const envelope = (continuous ? 0.17 : 0.05) + Math.max(0, pulse) * strength;
        const fade = Math.min(1, t / 0.025, (duration - t) / 0.05);
        const band = (high - low) * 0.7 + (midHi - midLo) * 0.3;
        // A small transient component retains some tapping texture.
        const sample = (band + (white - previous) * 0.025) * envelope * fade;
        previous = white;
        samples[i] = sample;
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sum / length);
      // Standard: -19 dBFS RMS. Continuous candidate: -18 dBFS RMS.
      const gain = Math.min((continuous ? 0.126 : 0.112) / Math.max(rms, 1e-9), 0.8 / Math.max(peak, 1e-9));
      for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(samples[i] * gain * 32767), true);
      return bytes;
    }
    let low = 0, dc = 0, nextTap = 0, tapAge = 1, tapScale = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      if (t >= nextTap) { tapAge = 0; tapScale = 0.3 + random() * 0.45; nextTap = t + 0.16 + random() * 0.43; }
      low = low * 0.86 + (random() * 2 - 1) * 0.14;
      dc = dc * 0.995 + low * 0.005;
      const envelope = Math.exp(-tapAge * 20) * tapScale + 0.018;
      const fade = Math.min(1, t / 0.025, (duration - t) / 0.05);
      const sample = Math.max(-0.8, Math.min(0.8, (low - dc) * envelope * 2.2)) * fade;
      view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
      tapAge += 1 / sampleRate;
    }
    return bytes;
  }

  function install() {
    if (window.__testudyNoiseV1) return window.__testudyNoiseV1;
    const u = new URL(location.href);
    if (u.origin !== "https://www.digcbt.com" || !/\/dig\/studyTest2\/pages\/speechEvaluation\.php$/i.test(u.pathname)) return null;
    const s = { enabled: false, recording: null, pending: null, error: null, lastKey: null, seconds: 8, natural: true, startPlan: null, style: "rustle" };
    const clock = () => performance.now();
    const styleName = style => style === "taps" ? "打音" : style === "continuous" ? "連続ざわつき" : "ざわつき";
    let originalGetUserMedia, virtualGetUserMedia, originalStart, originalStop, fakeStart, fakeStop;
    const current = () => typeof getSpeechEvalInfo === "function" ? getSpeechEvalInfo() : null;
    const visible = (node) => {
      if (!node) return false;
      for (let p = node; p && p.nodeType === 1; p = p.parentElement) {
        const css = getComputedStyle(p);
        if (p.hidden || css.display === "none" || css.visibility === "hidden") return false;
      }
      return true;
    };
    function enable() {
      if (s.enabled) return;
      const devices = navigator.mediaDevices;
      if (!devices?.getUserMedia || typeof MediaStream !== "function") throw new Error("このブラウザの音声入力には対応していません。");
      originalGetUserMedia = devices.getUserMedia;
      // The site's initial permission check only needs a resolved stream. The
      // generated recorder below handles actual recording without a microphone.
      virtualGetUserMedia = function(constraints) {
        if (s.enabled && constraints?.audio && !constraints.video) return Promise.resolve(new MediaStream());
        return originalGetUserMedia.call(this, constraints);
      };
      devices.getUserMedia = virtualGetUserMedia;
      s.enabled = true;
    }
    function restoreRecorders() {
      if (fakeStart && window.startRecording_safari === fakeStart) window.startRecording_safari = originalStart;
      if (fakeStop && window.stopRecording_safari === fakeStop) window.stopRecording_safari = originalStop;
      fakeStart = fakeStop = null;
    }
    function stop() {
      // Cancel only a recorder owned by this helper. An in-flight request remains
      // under the site's control and its result may still arrive after pausing.
      if (s.recording) {
        s.recording = null;
        s.lastKey = null;
        if (typeof _stopClock === "function") _stopClock();
        if (typeof _stopSttEvalProcess === "function") _stopSttEvalProcess();
        if (typeof _startSttEvalProcess === "function") _startSttEvalProcess();
      }
      s.enabled = false;
      s.startPlan = null;
      if (virtualGetUserMedia && navigator.mediaDevices?.getUserMedia === virtualGetUserMedia) navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      restoreRecorders();
      try { sessionStorage.removeItem(FLAG); } catch {}
    }
    function installRecorders() {
      if (fakeStart) return;
      if (typeof startRecording_safari !== "function" || typeof stopRecording_safari !== "function" || typeof checkAcessToken !== "function" || typeof sendNotifyMessage !== "function") throw new Error("サイトの音声送信処理を確認できません。");
      originalStart = window.startRecording_safari;
      originalStop = window.stopRecording_safari;
      fakeStart = function() {
        try {
          const info = current();
          if (!s.enabled || info?.itemId == null) throw new Error("評価対象の問題を確認できません。");
          const availableTime = typeof g_totalTime !== "undefined" ? Number(g_totalTime) - (typeof itemCnt !== "undefined" ? Number(itemCnt) || 0 : 0) - 2 : 20;
          const prompt = String(info.eval || info.question || "");
          const units = (prompt.match(/[A-Za-z0-9]+/g) || []).length + (prompt.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length / 3;
          const factor = s.natural ? Math.max(0.65, Math.min(1.6, (units || 18) / 18)) * (0.85 + Math.random() * 0.3) : 1;
          const seconds = Math.min(20, s.seconds * factor, Math.max(0.3, availableTime || 8));
          const seed = crypto.getRandomValues(new Uint32Array(1))[0];
          s.recording = { id: info.itemId, started: clock(), seconds, seed, style: s.style };
          sendNotifyMessage(ConstRecordStatus_START);
        } catch (error) { s.error = error.message; }
      };
      fakeStop = function() {
        const recording = s.recording;
        if (!recording || !s.enabled) return;
        s.recording = null;
        try {
          if (current()?.itemId !== recording.id) throw new Error("送信前に問題が変わったため停止しました。");
          const elapsed = (clock() - recording.started) / 1000;
          if (elapsed < 0.05 || elapsed > 60) throw new Error("実際の録音経過時間が送信可能な範囲外です。");
          s.pending = { id: recording.id, at: clock(), style: recording.style, seconds: elapsed };
          // The site's native stop button sets speechEvalStatus before this call.
          sendNotifyMessage(ConstRecordStatus_END);
          // Encode the actual elapsed duration, including a delayed timer tick.
          // The site's own request headers and timestamps are untouched.
          checkAcessToken(new Blob([makeNoiseWav(elapsed, recording.seed, recording.style)], { type: "audio/wav" }));
        } catch (error) { s.error = error.message; }
      };
      window.startRecording_safari = fakeStart;
      window.stopRecording_safari = fakeStop;
    }
    function step(operation, options = {}) {
      if (operation !== "step" || options.speechNoise === false) {
        stop();
        return { phase: "speech", message: "発話評価です。サイトのマイクで発話してください。" };
      }
      try {
        if (s.error) { const message = s.error; stop(); return { phase: "blocked", message: "生成音声を停止しました: " + message, stop: true }; }
        enable(); installRecorders();
        if (typeof isSoeMode === "function" && isSoeMode()) throw new Error("この音声評価エンジンには対応していません。");
        s.seconds = Math.max(3, Math.min(20, Number(options.noiseSeconds) || 8));
        s.natural = options.naturalTiming !== false;
        s.style = ["taps", "continuous"].includes(options.noiseStyle) ? options.noiseStyle : "rustle";
        if (s.pending && typeof evalItems !== "undefined" && Array.isArray(evalItems)) {
          const item = evalItems.find(item => String(item.ID) === String(s.pending.id));
          if (item && String(item.Status) === "3" && item.Mark != null && item.Mark !== "" && Number.isFinite(Number(item.Mark))) {
            const completed = s.pending;
            s.pending = null;
            const score = Number(item.Mark);
            return { phase: "speech-result", action: "noise-result", score, noiseStyle: completed.style,
              message: `${styleName(completed.style)}：${score}点（録音${completed.seconds.toFixed(1)}秒）。`, seconds: completed.seconds };
          }
        }
        const info = current(), button = document.getElementById("recordBtn");
        if (!info || !visible(button)) return { phase: "speech", message: "発話評価の準備を待っています。マイク許可画面が既に出ている場合は、練習を開き直してください。" };
        if (s.recording) {
          if (clock() - s.recording.started >= s.recording.seconds * 1000) {
            if (button.classList.contains("recordBtnEndCls")) {
              button.click();
              if (s.error) throw new Error(s.error);
              return { phase: "speech-grading", message: "生成した雑音を送信しました。音声評価を待っています。", action: "noise-submit" };
            }
            if (clock() - s.recording.started > (s.recording.seconds + 5) * 1000) throw new Error("録音停止ボタンを確認できません。");
          }
          return { phase: "speech-recording", message: `${styleName(s.recording.style)}を生成中（目安${s.recording.seconds.toFixed(1)}秒）。実マイクは使用していません。` };
        }
        const retry = typeof itemTryMap !== "undefined" ? itemTryMap.get(info.itemId) : "0";
        const key = String(info.itemId) + ":" + String(retry);
        if (s.pending && key === s.lastKey && clock() - s.pending.at > 35000) throw new Error("音声評価の応答を確認できません。重複送信を避けて停止しました。");
        if (typeof speechEvalStatus !== "undefined" && speechEvalStatus === "0" && button.classList.contains("recordBtnStartCls") && key !== s.lastKey) {
          if (s.natural) {
            if (s.startPlan?.key !== key) {
              const prompt = String(info.eval || info.question || "");
              const words = (prompt.match(/[A-Za-z0-9]+/g) || []).length;
              s.startPlan = { key, at: clock() + Math.min(5000, 900 + words * 70) * (0.8 + Math.random() * 0.4) };
            }
            if (clock() < s.startPlan.at) return { phase: "speech-preparing", message: "問題を確認する待ち時間です。続いて生成音声で録音します。" };
          }
          s.lastKey = key;
          s.pending = null;
          button.click();
          if (!s.recording) throw new Error(s.error || "録音開始イベントを確認できません。");
          return { phase: "speech-recording", message: `生成した${styleName(s.style)}で音声評価を開始しました。`, action: "noise-start" };
        }
        return { phase: "speech-grading", message: "サイトの音声評価・次の問題への移動を待っています。" };
      } catch (error) { s.error = error.message; stop(); return { phase: "blocked", message: "生成音声を停止しました: " + error.message, stop: true }; }
    }
    const controller = { step, stop, reset: () => {
      s.error = null;
      s.startPlan = null;
      if (!s.pending || clock() - s.pending.at > 35000) { s.pending = null; s.lastKey = null; }
    } };
    window.__testudyNoiseV1 = controller;
    window.addEventListener("pagehide", stop, { once: true });
    try { if (sessionStorage.getItem(FLAG) === "1") enable(); } catch (error) { s.error = error.message; }
    return controller;
  }
  if (typeof module !== "undefined") module.exports = { makeNoiseWav, install };
  if (typeof window !== "undefined") install();
})();
