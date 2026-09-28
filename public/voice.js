// Voice in a compartment. One RTCPeerConnection per passenger, to Cloudflare's
// Realtime SFU: the passenger's microphone goes up as one track, and every other
// passenger's track comes down on the same connection. The room relays each SFU
// call over its WebSocket (the app secret never reaches the page) and tells
// everyone who is in voice; this module turns that list into pulled tracks.
//
// Push-to-talk and open mic differ only in when the microphone track is enabled.
// A disabled track sends silence, so nothing is renegotiated when someone talks.
// Playback goes through Web Audio, so the per-passenger volume works on iPhone
// too; each remote stream is also parked on a muted <audio>, which Chrome needs
// before it will let a WebRTC stream flow into Web Audio.
const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];
const CALL_MS = 15_000;
const SPEAK = 0.02;       // RMS above this counts as talking
const HOLD_MS = 350;      // and stays talking this long after the last loud frame
const TRIES = 3;          // reconnects before falling back to text

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isHomeScreen = () => navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
export const canVoice = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export function createVoice({ send, changed, levels }) {
  const V = {
    status: "none",   // none | joining | on | reconnecting
    notice: null,     // blocked | home | failed | back | null: the card or toast to show
    mic: false,       // this page sends a microphone track
    muted: false,     // the passenger muted themselves
    mode: "ptt",      // the room's setting: ptt | open
    pressing: false,  // push-to-talk is held
    level: {},        // key -> 0..1, "me" for this page
    speaking: {},     // key -> bool
    vol: {}, mutedFor: {}, // by seat, as the passenger sheet sets them; only this page hears the difference
    needTap: false,   // the browser holds the sound until the next tap
  };
  let pc = null, stream = null, ctx = null, meter = null, tries = 0, lostAt = 0, hiddenAt = 0, wantMic = false;
  let nextId = 1, queue = Promise.resolve(), timer = null, loop = null;
  const calls = new Map();
  const pulled = new Map(); // stream key -> { mid, seat, track, audio, src, gain, an }
  let roster = [], me = null;

  const call = (op, body = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    calls.set(id, { resolve, reject });
    send({ type: "voice", op, id, ...body });
    setTimeout(() => { if (calls.delete(id)) reject(new Error("timeout")); }, CALL_MS);
  });
  V.onReply = (m) => {
    const c = calls.get(m.id); if (!c) return;
    calls.delete(m.id);
    if (m.ok) c.resolve(m); else c.reject(Object.assign(new Error(m.message || m.reason || "voice"), { reason: m.reason }));
  };
  // Offers and answers on one connection must not overlap.
  const serial = (fn) => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

  function audio() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    return ctx;
  }
  // A test page without a microphone can send a tone instead: localStorage lt.fakeMic = 1.
  async function getMic() {
    let fake = false; try { fake = localStorage.getItem("lt.fakeMic") === "1"; } catch {}
    if (fake) {
      const a = audio(), osc = a.createOscillator(), g = a.createGain(), dst = a.createMediaStreamDestination();
      osc.frequency.value = 330; g.gain.value = 0.2; osc.connect(g).connect(dst); osc.start();
      return dst.stream;
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  }
  const micTrack = () => (stream ? stream.getAudioTracks()[0] : null);
  function applyMic() {
    const tr = micTrack();
    if (tr) tr.enabled = !V.muted && (V.mode === "open" || V.pressing);
  }

  // ---------- joining and leaving ----------
  V.join = async (withMic) => {
    if (V.status === "joining" || !canVoice()) return;
    V.status = "joining"; V.notice = null; wantMic = withMic; changed();
    audio();
    if (withMic && !stream) {
      try { stream = await getMic(); }
      catch { stream = null; V.notice = isIOS() && isHomeScreen() ? "home" : "blocked"; }
    }
    try {
      await call("session");
      pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
      pc.ontrack = onTrack;
      pc.onconnectionstatechange = onConn;
      if (stream) await serial(publish);
      V.mic = !!stream; V.status = "on";
      if (!V.mic) await call("state", { state: "listen" }).catch(() => {});
      watchLevels();
      changed();
      V.sync(roster, me);
    } catch {
      teardown();
      V.status = "none"; V.notice = "failed"; changed();
    }
  };
  async function publish() {
    applyMic();
    const tx = pc.addTransceiver(micTrack(), { direction: "sendonly" });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await call("publish", { sdp: offer.sdp, mid: tx.mid, muted: V.muted });
    await pc.setRemoteDescription({ type: "answer", sdp: res.sdp });
    if (meter) meter.disconnect();
    meter = { an: audio().createAnalyser() };
    meter.src = audio().createMediaStreamSource(stream);
    meter.an.fftSize = 512; meter.src.connect(meter.an);
    meter.disconnect = () => { try { meter.src.disconnect(); } catch {} };
  }
  // A listener who wants to talk after all, or a second try after the browser said no.
  V.addMic = async () => {
    if (V.status !== "on" || V.mic) return;
    try { stream = await getMic(); }
    catch { stream = null; V.notice = isIOS() && isHomeScreen() ? "home" : "blocked"; changed(); return; }
    wantMic = true;
    try { await serial(publish); V.mic = true; V.notice = null; }
    catch { V.rebuild(null); }
    changed();
  };
  function teardown(keepMic = false) {
    clearTimeout(timer); timer = null;
    for (const key of [...pulled.keys()]) dropLocal(key);
    if (pc) { pc.ontrack = null; pc.onconnectionstatechange = null; try { pc.close(); } catch {} pc = null; }
    if (meter) { meter.disconnect(); meter = null; }
    if (!keepMic && stream) { for (const tr of stream.getTracks()) tr.stop(); stream = null; }
    for (const c of calls.values()) c.reject(new Error("closed"));
    calls.clear();
    queue = Promise.resolve();
    V.mic = false; V.level = {}; V.speaking = {};
  }
  V.leave = (tell = true) => {
    if (V.status === "none" && !pc) { V.notice = null; changed(); return; }
    teardown();
    if (tell) call("leave").catch(() => {});
    V.status = "none"; V.notice = null; V.pressing = false; tries = 0;
    changed();
  };
  // Start again from nothing: a dropped connection, a page back from the background,
  // or the room's socket reconnecting (the room forgets voice when the socket goes).
  V.rebuild = async (why) => {
    if (V.status === "none") return;
    const mic = wantMic;
    const liveMic = micTrack() && micTrack().readyState === "live" && !micTrack().muted;
    teardown(liveMic);
    V.status = "none";
    await V.join(mic);
    if (V.status === "on" && why) { V.notice = why; changed(); }
  };

  function onConn() {
    if (!pc) return;
    const st = pc.connectionState;
    if (st === "connected") {
      tries = 0; lostAt = 0; clearTimeout(timer); timer = null;
      if (V.status === "reconnecting") { V.status = "on"; changed(); }
    } else if (st === "disconnected" || st === "failed") {
      if (V.status === "on") { V.status = "reconnecting"; lostAt = Date.now(); changed(); }
      clearTimeout(timer);
      timer = setTimeout(retry, st === "failed" ? 500 : 6000);
    }
  }
  async function retry() {
    if (++tries > TRIES) { V.leave(); V.notice = "failed"; changed(); return; }
    const mic = wantMic;
    teardown(true);
    V.status = "none";
    await V.join(mic);
    if (V.status !== "on") { V.status = "reconnecting"; changed(); timer = setTimeout(retry, 3000); }
  }

  // ---------- who to hear ----------
  // Called with every roster: pull the streams that are new, close the ones gone.
  V.sync = (seats, mySeat) => {
    roster = seats || []; me = mySeat;
    if (!pc || V.status === "none" || V.status === "joining") return;
    const live = new Set(roster.filter((s) => s.idx !== me && s.voice && s.voice.on).map((s) => s.voice.on));
    const gone = [...pulled.keys()].filter((k) => !live.has(k));
    const fresh = roster.filter((s) => s.idx !== me && s.voice && s.voice.on && !pulled.has(s.voice.on));
    for (const s of fresh) pulled.set(s.voice.on, { mid: null, seat: s.idx, pending: true });
    for (const [k, p] of pulled) { const s = roster.find((x) => x.voice && x.voice.on === k); if (s) { p.seat = s.idx; setGain(p); } }
    if (gone.length) serial(() => closeTracks(gone)).catch(() => V.rebuild(null));
    if (fresh.length) serial(() => pullTracks(fresh)).catch(() => V.rebuild(null));
  };
  async function pullTracks(seats) {
    const res = await call("pull", { seats: seats.map((s) => s.idx) });
    for (const s of seats) {
      const tr = res.tracks.find((x) => x.key === s.voice.on);
      if (!tr || tr.error) { pulled.delete(s.voice.on); continue; }
      const p = pulled.get(s.voice.on); if (p) { p.mid = tr.mid; p.pending = false; }
    }
    if (!res.sdp) return;
    await pc.setRemoteDescription({ type: "offer", sdp: res.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (res.renegotiate) await call("answer", { sdp: answer.sdp });
    for (const tx of pc.getTransceivers()) if (tx.receiver && tx.mid) attach(tx.mid, tx.receiver.track);
  }
  async function closeTracks(keys) {
    const mids = [];
    for (const k of keys) {
      const p = pulled.get(k); if (!p) continue;
      if (p.mid) { mids.push(p.mid); const tx = pc.getTransceivers().find((x) => x.mid === p.mid); if (tx) try { tx.stop(); } catch {} }
      dropLocal(k);
    }
    if (!mids.length) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await call("close", { mids, sdp: offer.sdp });
    if (res.sdp) await pc.setRemoteDescription({ type: "answer", sdp: res.sdp });
  }
  function onTrack(e) { if (e.transceiver && e.transceiver.mid) attach(e.transceiver.mid, e.track); }
  function attach(mid, track) {
    if (!track || track.kind !== "audio") return;
    const p = [...pulled.values()].find((x) => x.mid === mid);
    if (!p || p.track === track) return;
    p.track = track;
    const ms = new MediaStream([track]);
    p.audio = new Audio(); p.audio.muted = true; p.audio.srcObject = ms; p.audio.play().catch(() => {});
    const a = audio();
    p.src = a.createMediaStreamSource(ms);
    p.an = a.createAnalyser(); p.an.fftSize = 512;
    p.gain = a.createGain();
    p.src.connect(p.an); p.src.connect(p.gain); p.gain.connect(a.destination);
    setGain(p);
    if (a.state !== "running") { V.needTap = true; changed(); }
  }
  function setGain(p) {
    if (!p.gain) return;
    const v = V.mutedFor[p.seat] ? 0 : (V.vol[p.seat] ?? 100) / 100;
    p.gain.gain.value = v;
  }
  function dropLocal(k) {
    const p = pulled.get(k); if (!p) return;
    try { if (p.src) p.src.disconnect(); if (p.gain) p.gain.disconnect(); } catch {}
    if (p.audio) { p.audio.srcObject = null; }
    pulled.delete(k);
  }

  // ---------- what the passenger does ----------
  V.setMode = (mode) => { V.mode = mode === "open" ? "open" : "ptt"; applyMic(); };
  V.press = (on) => { if (V.pressing === on) return; V.pressing = on; if (on) audio(); applyMic(); changed(); };
  V.setMuted = (m) => {
    V.muted = m; applyMic();
    if (V.status === "on" && V.mic) call("state", { state: m ? "muted" : "live" }).catch(() => {});
    changed();
  };
  V.setVolume = (seat, v) => { V.vol[seat] = v; for (const p of pulled.values()) if (p.seat === seat) setGain(p); };
  V.setMutedFor = (seat, m) => { V.mutedFor[seat] = m; for (const p of pulled.values()) if (p.seat === seat) setGain(p); };
  // Any tap lets a held-back AudioContext play.
  V.tap = () => { if (ctx && ctx.state !== "running") ctx.resume().then(() => { V.needTap = false; changed(); }).catch(() => {}); else if (V.needTap) { V.needTap = false; changed(); } };
  V.hear = (seat) => [...pulled.values()].some((p) => p.seat === seat && p.track);

  // ---------- the page going to the background ----------
  // iPhone stops the microphone and the sound while Safari is not on screen, and
  // does not always give them back. Others see the passenger as away meanwhile;
  // coming back rebuilds the voice and says what was missed.
  V.visibility = (hidden) => {
    if (V.status === "none") return;
    if (hidden) {
      hiddenAt = Date.now();
      if (isIOS()) call("state", { state: "away" }).catch(() => {});
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
    const broken = !pc || ["failed", "closed", "disconnected"].includes(pc.connectionState) || (V.mic && (!micTrack() || micTrack().readyState !== "live"));
    if (isIOS() && away > 1500) V.rebuild("back");
    else if (broken) V.rebuild("back");
    else if (isIOS()) call("state", { state: V.mic ? (V.muted ? "muted" : "live") : "listen" }).catch(() => {});
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  };

  // ---------- levels ----------
  const buf = new Float32Array(512);
  const rms = (an) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };
  const lastLoud = {};
  function watchLevels() {
    if (loop) return;
    loop = setInterval(() => {
      if (V.status === "none") { clearInterval(loop); loop = null; V.level = {}; V.speaking = {}; levels(); return; }
      const now = Date.now(), next = {};
      const read = (key, an, gate) => {
        const r = gate ? rms(an) : 0;
        next[key] = Math.min(1, r * 6);
        if (r > SPEAK) lastLoud[key] = now;
      };
      if (meter && micTrack()) read("me", meter.an, micTrack().enabled);
      for (const p of pulled.values()) if (p.an) read(p.seat, p.an, true);
      const speaking = {};
      for (const key of Object.keys(next)) speaking[key] = now - (lastLoud[key] || 0) < HOLD_MS;
      V.level = next; V.speaking = speaking;
      levels();
    }, 100);
  }
  return V;
}
