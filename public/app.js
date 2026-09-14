// The client. Three views on one page, landing, solo setup and the carriage,
// picked by query string so the build works at any prefix. Solo mode runs
// the engine and the bots right here; bots act on timers so the carriage
// reads as people doing things one after another. The room mode (M4) will
// feed the same renderers a view from the Durable Object.
import * as E from "./shared/engine.js";
import * as B from "./shared/bots.js";
import { sayAction, sayResult } from "./shared/talk.js";
import en from "./i18n/en.js";
import zh from "./i18n/zh-Hant.js";
import { PASSENGERS, FACE_IDS, isFace, passengerName, freeFaces } from "./shared/passengers.js";

const LANGS = { en, "zh-Hant": zh };
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "onclick") el.addEventListener("click", v);
    else if (k === "onchange") el.addEventListener("change", v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "disabled" || k === "checked" || k === "hidden") el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------- icons (stroke-based, 24 grid) ----------
const svg = (body, size = 18) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.6"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true"); s.innerHTML = body; return s; };
const PATHS = {
  watch: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 1.5"/><path d="M10 3h4"/><path d="M12 3v3"/>',
  seal: '<rect x="6" y="12" width="12" height="9" rx="1"/><path d="M9 12V8a3 3 0 0 1 6 0v4"/><path d="M9 17h6"/>',
  case_watch: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/><circle cx="12" cy="16" r="2"/>',
  case_seal: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/><rect x="10" y="14" width="4" height="4"/>',
  dagger: '<path d="M5 19l9-9"/><path d="M14 10l3-3 1 1-3 3"/><path d="M9 15l3 3"/>',
  gloves: '<path d="M7 12V6a1.5 1.5 0 0 1 3 0v5"/><path d="M10 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M13 11V6a1.5 1.5 0 0 1 3 0v6"/><path d="M16 12V8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4 13.5a1.5 1.5 0 0 1 2.6-1.5L7 13"/>',
  poison_ring: '<circle cx="12" cy="14" r="6"/><path d="M9 6l3-3 3 3-3 3z"/>',
  knives: '<path d="M4 20l7-7"/><path d="M10 14l3-3 2 2-3 3"/><path d="M12 20l7-7"/><path d="M18 14l3-3"/>',
  cane: '<path d="M8 21V8a4 4 0 0 1 8 0"/><path d="M6 21h4"/>',
  codebook: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M8 4v13h11"/><path d="M11 9h5"/>',
  trench_coat: '<path d="M8 3l4 2 4-2 3 4-2 2v12H7V9L5 7z"/><path d="M12 5v16"/>',
  warrant: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  monocle: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/>',
  timetable: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16"/><path d="M9 4v16"/><path d="M12 13h5"/><path d="M12 16h5"/>',
  black_letter: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M3 7l9 6 9-6"/>',
  broken_mirror: '<ellipse cx="12" cy="10" rx="6" ry="7"/><path d="M12 17v4"/><path d="M9 21h6"/><path d="M10 5l3 4-2 3 3 3"/>',
  first_class_ticket: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 6v12"/>',
  drink: '<path d="M7 3h10l-1 9a4 4 0 0 1-8 0z"/><path d="M12 16v5"/><path d="M9 21h6"/>',
  sword: '<path d="M4 20l11-11"/><path d="M14 5l5 5"/><path d="M12 7l5 5"/><path d="M6 14l4 4"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  out: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
};
const icon = (kind, size = 18) => svg(PATHS[kind] || '<circle cx="12" cy="12" r="7"/>', size);

// ---------- language ----------
let lang = "en", S = en;
function t(key, p = {}) {
  const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), S);
  return String(v ?? key).replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? `{${k}}`));
}
function setLang(l) {
  lang = LANGS[l] ? l : "en";
  S = LANGS[lang];
  store.set("lt.lang", lang);
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll("[data-ph]").forEach((el) => { el.placeholder = t(el.dataset.ph); });
  renderSetup();
  if (game.mode === "solo" && game.st) { game.names = soloNames(); rebuildLog(); render(); }
  if (game.mode === "net") { if (game.lobby) renderLobby(); if (game.view) { rebuildLog(); render(); } }
}
$("langBtn").addEventListener("click", () => setLang(lang === "en" ? "zh-Hant" : "en"));
const num = (n) => (S.nums && S.nums[n - 1]) || String(n);
const gangName = (g) => t("gang." + g);
const itemName = (kind) => t("items." + kind);
const tradeName = (tr) => t("trades." + tr);
const nameOf = (s) => game.names[s] ?? "?";
const nameList = (seats) => seats.map(nameOf).join(lang === "en" ? ", " : "、");

// ---------- solo setup ----------
const setup = {
  n: Number(store.get("lt.n", 6)),
  level: store.get("lt.level", "normal"),
  name: store.get("lt.name", ""),
  smuggling: store.get("lt.smug", "0") === "1",
  face: store.get("lt.face", ""),
};
if (!isFace(setup.face)) setup.face = FACE_IDS[Math.floor(Math.random() * FACE_IDS.length)];
// Solo names come from the faces; the human's typed name, if any, wins for their seat.
const soloNames = () => game.faces.map((f, i) => (i === game.me && setup.name ? setup.name : passengerName(f, lang)));
function renderSetup() {
  $("nameInput").placeholder = passengerName(setup.face, lang);
  const grid = clear($("facePick"));
  for (const p of PASSENGERS) grid.append(h("button", { type: "button", class: p.id === setup.face ? "on" : "", title: passengerName(p.id, lang), "aria-label": passengerName(p.id, lang),
    onclick: () => { setup.face = p.id; store.set("lt.face", p.id); renderSetup(); } }, h("img", { src: "art/face_" + p.id + ".jpg", alt: "" })));
  $("pCount").textContent = num(setup.n);
  $("pMinus").disabled = setup.n <= E.MIN_PLAYERS;
  $("pPlus").disabled = setup.n >= E.MAX_PLAYERS;
  document.querySelectorAll("#levelSeg button").forEach((b) => b.classList.toggle("on", b.dataset.level === setup.level));
  $("nameInput").value = setup.name;
  $("smugChk").checked = setup.smuggling;
}
$("pMinus").addEventListener("click", () => { setup.n = Math.max(E.MIN_PLAYERS, setup.n - 1); store.set("lt.n", setup.n); renderSetup(); });
$("pPlus").addEventListener("click", () => { setup.n = Math.min(E.MAX_PLAYERS, setup.n + 1); store.set("lt.n", setup.n); renderSetup(); });
document.querySelectorAll("#levelSeg button").forEach((b) => b.addEventListener("click", () => { setup.level = b.dataset.level; store.set("lt.level", setup.level); renderSetup(); }));
$("nameInput").addEventListener("input", (e) => { setup.name = e.target.value.trim().slice(0, 16); store.set("lt.name", setup.name); });
$("smugChk").addEventListener("change", (e) => { setup.smuggling = e.target.checked; store.set("lt.smug", setup.smuggling ? "1" : "0"); });
$("btnStart").addEventListener("click", () => startGame());
$("btnPlay").addEventListener("click", () => go("?play"));

// ---------- game ----------
const game = {
  mode: "solo",       // "solo" | "net"
  st: null,           // solo: the full engine state
  view: null, legal: [], // net: this seat's view and legal actions from the room
  me: 0, names: [], faces: [], level: "normal", rng: E.makeRng(E.randomSeed()), botTimer: null, netTimer: null,
  log: [], logSeen: 0, flashUntil: 0, auto: false,
  ws: null, code: null, lobby: null, closed: false, clock: null, gen: -1, deadline: 0,
  ui: freshUi(),
};
const curView = () => (game.mode === "solo" ? (game.st ? E.view(game.st, game.me) : null) : game.view);
const curLegal = () => (game.mode === "solo" ? (game.st ? E.legalActions(game.st, game.me) : []) : game.legal);
// Per-tab: the reconnect token, so two tabs in one browser are two players.
const sess = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};
function freshUi() { return { mode: null, item: null, kind: null, holders: {}, picks: [], showItems: new Set(), showTrade: false, winner: null, announce: true }; }
const DELAY = { reveal: 150, turn: 1200, peek: 900, handLimit: 600, answer: 900, return: 700, codebook: 700, coat: 700, direction: 600, passItems: 400,
  priest: 300, gunman: 300, doctor: 350, priestPay: 600, support: 550, hypnotist: 450, powers: 450, choice: 700, take: 600 };

function startGame() {
  leaveRoom(true);
  game.mode = "solo"; game.view = null; game.legal = [];
  const n = setup.n;
  game.rng = E.makeRng(E.randomSeed());
  game.st = E.createGame(E.randomSeed(), n, { smuggling: setup.smuggling });
  game.me = 0; game.level = setup.level;
  game.faces = [setup.face, ...freeFaces(game.rng, [setup.face], E.shuffle).slice(0, n - 1)];
  game.names = soloNames();
  game.log = []; game.logSeen = 0; game.flashUntil = 0; game.ui = freshUi();
  clearTimeout(game.botTimer);
  show("table");
  tick();
}

// Everything the bots decide, and what the human is not asked because it
// could not matter: a window for a power they do not hold, a powers round
// with nothing to show, a hypnotist step without the hypnotist.
function autoAnswer(st, legal) {
  if (st.phase === "scuffle") {
    const f = st.scuffle;
    if (["priest", "gunman", "doctor"].includes(f.step)) return legal.some((a) => a.use) ? null : legal.find((a) => a.type === "window");
    if (f.step === "hypnotist") return legal.length === 1 ? legal[0] : null;
    if (f.step === "powers") return legal.length === 1 ? legal[0] : null;
  }
  return null;
}
function delayFor(st) {
  const step = st.phase === "scuffle" ? st.scuffle.step : st.phase === "trade" ? st.trade.step : st.phase;
  let d = DELAY[step] ?? 600;
  if (Date.now() < game.flashUntil) d += 1400;
  return d;
}

// Bots act one at a time, on a timer, whenever the phase is waiting on them;
// the human's automatic answers go the same way, a beat later.
function tick() {
  clearTimeout(game.botTimer);
  render();
  const st = game.st;
  if (!st || st.phase === "over") return;
  const who = E.mustAct(st);
  if (!who.length) return;
  if (who.includes(game.me) && !game.auto) {
    const auto = autoAnswer(st, E.legalActions(st, game.me));
    if (auto) { game.botTimer = setTimeout(() => humanAct(auto), 250); return; }
  }
  const bots = who.filter((s) => s !== game.me || game.auto);
  if (!bots.length) return;
  const seat = bots[game.rng.int(bots.length)];
  game.botTimer = setTimeout(() => botAct(seat), delayFor(st));
}
function botAct(seat) {
  const st = game.st;
  if (!st || st.phase === "over" || !E.mustAct(st).includes(seat)) { tick(); return; }
  const view = E.view(st, seat);
  const legal = E.legalActions(st, seat);
  const a = B.decide(view, legal, game.level, game.rng);
  if (!a) { tick(); return; }
  const line = sayAction(a, view, { rng: game.rng, names: game.names, T: S.talk });
  if (line) addSay(seat, line);
  step(a);
}
function humanAct(a) {
  closeSheet();
  if (game.mode === "net") {
    if (!game.view || !game.view.waitingOn.includes(game.me)) return;
    const { seat, why, ...action } = a;
    send({ type: "act", action });
    game.ui = freshUi();
    return;
  }
  if (!game.st || !E.mustAct(game.st).includes(game.me)) return;
  step(a);
}
function step(a) {
  try { game.st = E.apply(game.st, a); }
  catch (err) { console.error(err, a); tick(); return; }
  game.ui = freshUi();
  afterStep();
  tick();
}
// New public log entries become lines people can read; a scuffle's result
// also holds the bots for a moment so it can be read before the next thing.
function afterStep() {
  const st = game.st;
  for (; game.logSeen < st.log.length; game.logSeen++) {
    const e = st.log[game.logSeen];
    addSys(describe(e), e.type === "scuffle" || e.type === "declare" || e.type === "solo");
    if (e.type === "scuffle" || e.type === "declare") game.flashUntil = Date.now() + 1500;
    for (let s = 0; s < st.n; s++) {
      if (s === game.me && !game.auto) continue;
      const line = sayResult(e, s, { rng: game.rng, names: game.names, T: S.talk });
      if (line) addSay(s, line);
    }
  }
}

// ---------- log lines ----------
function addSay(seat, text) { game.log.push({ seat, text, entry: null }); renderLog(); }
function addSys(text, hot = false, entry = null) { game.log.push({ seat: null, text, hot, entry }); renderLog(); }
function rebuildLog() {
  // after a language switch, redo the engine's lines in the new language
  const v = curView();
  if (!v) return;
  const talk = game.log.filter((l) => l.seat !== null || l.room);
  game.log = v.log.map((e) => ({ seat: null, text: describe(e), hot: e.type === "scuffle" || e.type === "declare" || e.type === "solo" }));
  game.log.push(...talk);
}

// ---------- compartments ----------
const wsBase = () => (location.protocol === "https:" ? "wss://" : "ws://") + location.host + location.pathname.replace(/[^/]*$/, "") + "ws";
function connect(params) {
  leaveRoom(true);
  clearTimeout(game.botTimer);
  game.mode = "net"; game.st = null; game.view = null; game.legal = []; game.lobby = null; game.closed = false;
  game.log = []; game.logSeen = 0; game.names = []; game.me = null; game.gen = -1; game.ui = freshUi();
  const q = new URLSearchParams({ name: setup.name || t("setup.defaultName"), lang, face: setup.face });
  if (params.create) q.set("create", "1");
  else { q.set("room", params.code); const tok = sess.get("lt.token." + params.code); if (tok) q.set("token", tok); }
  const ws = game.ws = new WebSocket(wsBase() + "?" + q.toString());
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
  ws.onclose = () => {
    if (game.ws !== ws) return;
    game.ws = null;
    if (game.closed) return;
    if (game.code) { setStatus(t("lobby.err.closed"), true); setTimeout(() => { if (!game.ws && !game.closed) connect({ code: game.code }); }, 2500); }
  };
}
function send(m) { if (game.ws && game.ws.readyState === 1) game.ws.send(JSON.stringify(m)); }
function leaveRoom(silent = false) {
  if (game.mode !== "net") return;
  game.closed = true;
  if (game.ws) { if (!silent) send({ type: "leave" }); try { game.ws.close(); } catch {} }
  game.ws = null; game.lobby = null; game.view = null; game.legal = []; game.code = null;
  clearInterval(game.clock); clearTimeout(game.netTimer);
}
const roomLine = (e) => ({ seat: e.sys ? null : e.seat, text: e.text, hot: e.hot, room: true });
function onMsg(m) {
  switch (m.type) {
    case "joined":
      game.code = m.code; game.me = m.seat >= 0 ? m.seat : null;
      if (m.token) sess.set("lt.token." + m.code, m.token);
      if (!location.search.includes("room=" + m.code)) history.replaceState(null, "", location.pathname + "?room=" + m.code);
      break;
    case "lobby":
      game.lobby = m;
      if (m.phase === "lobby" || !game.view) { game.view = null; show("lobby"); }
      renderLobby();
      break;
    case "log":
      game.log = m.entries.map(roomLine); game.logSeen = 0;
      renderLog(); renderLobbyLog(); break;
    case "say":
      game.log.push(roomLine(m));
      renderLog(); renderLobbyLog(); break;
    case "view": {
      if (!m.view) { game.view = null; game.legal = []; if (game.lobby) { show("lobby"); renderLobby(); } break; }
      if (m.gen !== game.gen) { game.gen = m.gen; game.log = game.log.filter((l) => l.room); game.logSeen = 0; game.ui = freshUi(); }
      game.view = m.view; game.legal = m.legal || []; game.names = m.names; game.faces = m.faces || []; game.me = m.me; game.deadline = m.deadline || 0;
      // the engine's public log becomes lines here, in this tab's language
      for (; game.logSeen < m.view.log.length; game.logSeen++) {
        const e = m.view.log[game.logSeen];
        game.log.push({ seat: null, text: describe(e), hot: e.type === "scuffle" || e.type === "declare" || e.type === "solo" });
      }
      show("table"); render(); startClock(); netAuto();
      break;
    }
    case "error":
      if (m.fatal) { leaveRoom(true); game.mode = "solo"; show("landing"); setStatus(m.key ? t("lobby.err." + m.key) : m.message, true); }
      else setStatus(m.key ? t("lobby.err." + m.key) : m.message, true);
      break;
  }
}
// The same courtesy the solo driver extends: answer for the human what cannot matter.
function netAuto() {
  clearTimeout(game.netTimer);
  const v = game.view;
  if (!v || game.me === null || !v.waitingOn.includes(game.me)) return;
  const fake = { phase: v.phase, scuffle: v.scuffle };
  const auto = autoAnswer(fake, game.legal);
  if (auto) game.netTimer = setTimeout(() => humanAct(auto), 250);
}
function setStatus(text, err = false) {
  const el = $("view-lobby").hidden ? $("landStatus") : $("lbStatus");
  el.textContent = text; el.classList.toggle("err", err);
}
function startClock() {
  clearInterval(game.clock);
  game.clock = setInterval(() => { const v = curView(); if (game.mode === "net" && v) renderBar(v); }, 1000);
}
function renderLobbyLog() {
  const box = clear($("lbLog"));
  for (const l of game.log.filter((x) => x.room).slice(-30)) {
    if (l.seat === null) box.append(h("div", {}, l.text));
    else box.append(h("div", { class: "say" }, faceEl(l.seat, "xs"), h("span", {}, h("b", {}, nameOfLobby(l.seat)), h("i", {}, "："), l.text)));
  }
  box.scrollTop = box.scrollHeight;
}
const nameOfLobby = (s) => game.lobby?.seats?.find((x) => x.idx === s)?.name ?? nameOf(s);
function renderLobby() {
  const L = game.lobby; if (!L) return;
  const host = game.me === 0;
  $("lbCode").textContent = L.code;
  $("lbSeatsLab").textContent = t("lobby.seats", { n: L.seats.length, max: E.MAX_PLAYERS });
  $("lbNeed").textContent = L.seats.length < E.MIN_PLAYERS ? t("lobby.need", { min: E.MIN_PLAYERS }) : "";
  const box = clear($("lbSeats"));
  for (const s of L.seats) {
    const tags = [];
    if (s.idx === 0) tags.push(h("span", { class: "tag host" }, t("lobby.host")));
    if (s.ai) tags.push(h("span", { class: "tag ai" }, t("lobby.bot")));
    else if (!s.connected) tags.push(h("span", { class: "tag off" }, t("lobby.away")));
    else if (s.idx !== 0) tags.push(h("span", { class: "tag" + (s.ready ? " ok" : "") }, s.ready ? t("lobby.ready") : t("lobby.notReady")));
    if (host && s.ai && L.phase === "lobby") tags.push(h("button", { type: "button", class: "tag x", onclick: () => send({ type: "removeBot", idx: s.idx }) }, t("lobby.remove")));
    box.append(h("tr", {}, h("td", { class: "no lat" }, String(s.idx + 1)),
      h("td", { class: "av" }, s.face ? h("img", { class: "face sm", src: "art/face_" + s.face + ".jpg", alt: "" }) : h("span", { class: "face sm init" }, [...s.name][0] || "?")),
      h("td", { class: "nm" }, s.name, s.idx === game.me ? h("small", { class: "muted" }, ` · ${t("lobby.you")}`) : null),
      h("td", { class: "tags" }, h("div", { class: "row", style: "justify-content:flex-end;gap:6px" }, ...tags))));
  }
  let next = L.seats.length + 1;
  if (host && L.phase === "lobby" && L.seats.length < E.MAX_PLAYERS) box.append(h("tr", { class: "add", onclick: () => send({ type: "addBot" }) }, h("td", { class: "no lat" }, String(next++)), h("td", { colspan: "3" }, t("lobby.addBot"))));
  if (next <= E.MAX_PLAYERS) box.append(h("tr", { class: "empty" }, h("td", { class: "no lat" }, String(next)), h("td", { colspan: "3" }, t("lobby.empty"))));
  $("lbHost").hidden = !host || L.phase !== "lobby";
  document.querySelectorAll("#lbLevel button").forEach((b) => b.classList.toggle("on", b.dataset.level === L.settings.level));
  $("lbSmug").checked = !!L.settings.smuggling;
  const me = L.seats.find((s) => s.idx === game.me);
  $("lbReady").hidden = host || !me || L.phase !== "lobby";
  $("lbReady").textContent = me && me.ready ? t("lobby.notReady") : t("lobby.ready");
  $("lbReady").classList.toggle("p", !(me && me.ready));
  $("lbStart").hidden = !host || L.phase !== "lobby";
  $("lbStart").textContent = t("lobby.start", { n: L.seats.length });
  const waiting = L.seats.filter((s) => !s.ai && s.idx !== 0 && !s.ready).length;
  $("lbStatus").classList.remove("err");
  $("lbStatus").textContent = !me ? t("lobby.spectating")
    : L.phase !== "lobby" ? t("lobby.rematchWait")
    : waiting ? t("lobby.waiting", { n: waiting })
    : host ? t("lobby.canStart") : t("lobby.hostStarts");
  renderLobbyLog();
}
$("lbLeave").addEventListener("click", () => { leaveRoom(); go(""); });
$("tableLeave").addEventListener("click", () => { leaveRoom(); go(""); });
$("lbCopy").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "?room=" + game.code;
  try { await navigator.clipboard.writeText(url); $("lbCopy").textContent = t("lobby.copied"); setTimeout(() => { $("lbCopy").textContent = t("lobby.copy"); }, 1500); } catch {}
});
$("lbShare").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "?room=" + game.code;
  if (navigator.share) { try { await navigator.share({ title: t("title"), text: game.code, url }); } catch {} } else $("lbCopy").click();
});
$("lbReady").addEventListener("click", () => { const me = game.lobby?.seats.find((s) => s.idx === game.me); send({ type: "ready", ready: !(me && me.ready) }); });
$("lbStart").addEventListener("click", () => send({ type: "start" }));
document.querySelectorAll("#lbLevel button").forEach((b) => b.addEventListener("click", () => send({ type: "settings", level: b.dataset.level })));
$("lbSmug").addEventListener("change", (e) => send({ type: "settings", smuggling: e.target.checked }));
const chatSend = (inp) => { const text = inp.value.trim(); if (!text) return; send({ type: "chat", text }); inp.value = ""; };
$("lbSend").addEventListener("click", () => chatSend($("lbChat")));
$("lbChat").addEventListener("keydown", (e) => { if (e.key === "Enter") chatSend($("lbChat")); });
$("chatSend").addEventListener("click", () => chatSend($("chatIn")));
$("chatIn").addEventListener("keydown", (e) => { if (e.key === "Enter") chatSend($("chatIn")); });
$("btnCreate").addEventListener("click", () => {
  if (!setup.name) { setStatus(t("lobby.err.needName"), true); $("landName").focus(); return; }
  connect({ create: true });
  show("lobby"); $("lbCode").textContent = "····"; clear($("lbSeats")); $("lbStatus").textContent = t("lobby.connecting");
});
$("btnJoin").addEventListener("click", () => {
  const code = $("joinCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { setStatus(t("lobby.err.badCode"), true); return; }
  go("?room=" + code);
});
$("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnJoin").click(); });
$("landName").addEventListener("input", (e) => { setup.name = e.target.value.trim().slice(0, 16); store.set("lt.name", setup.name); $("nameInput").value = setup.name; });
function describe(e) {
  const L = (k, p) => t("log." + k, p);
  const parts = [];
  const out = describeParts(e, L, parts);
  return out !== undefined ? out : parts.join(lang === "en" ? " " : "");
}
function describeParts(e, L, parts) {
  switch (e.type) {
    case "start": return L("start", { name: nameOf(e.first) });
    case "pass": return L("pass", { name: nameOf(e.seat) });
    case "trade": {
      if (!e.accepted) return L("tradeNo", { from: nameOf(e.from), to: nameOf(e.to) });
      parts.push(L(e.forced ? "tradeForced" : "tradeOk", { from: nameOf(e.from), to: nameOf(e.to) }));
      for (const a of e.announced || []) parts.push(L("announced", { name: nameOf(a.seat), kind: itemName(a.kind) }));
      for (const s of e.drew || []) parts.push(L("drew", { name: nameOf(s) }));
      return undefined;
    }
    case "codebook": return L(e.swapped ? "codebookYes" : "codebookNo", { name: nameOf(e.seat), partner: nameOf(e.partner) });
    case "coat": return L(e.changed ? "coatYes" : "coatNo", { name: nameOf(e.seat) });
    case "timetable": return L("timetable", { name: nameOf(e.seat), dir: L(e.dir === "left" ? "dirLeft" : "dirRight") });
    case "scuffle": {
      if (e.stopped != null) { parts.push(L("stopped", { p: nameOf(e.stopped), a: nameOf(e.attacker), b: nameOf(e.defender) })); if (e.paid) parts.push(L("paid", { a: nameOf(e.attacker) })); return undefined; }
      parts.push(L("scuffle", { a: nameOf(e.attacker), b: nameOf(e.defender) }));
      const sup = Object.entries(e.support || {}).filter(([, side]) => side !== "out").map(([s, side]) => L("supports", { name: nameOf(Number(s)), side: t(side === "attacker" ? "table.backA" : "table.backD") }));
      if (sup.length) parts.push(sup.join(lang === "en" ? ", " : "、") + (lang === "en" ? "." : "。"));
      for (const [s, x] of Object.entries(e.shown || {})) {
        const what = [...(x.items || []).map(itemName), ...(x.trade ? [tradeName(x.trade)] : [])];
        if (what.length) parts.push(L("shown", { name: nameOf(Number(s)), what: what.join(lang === "en" ? ", " : "、") }) + (lang === "en" ? "." : "。"));
      }
      if (e.doctored != null) { parts.push(L("doctored", { d: nameOf(e.doctored) })); return undefined; }
      parts.push(L("count", { swords: e.swords, shields: e.shields }));
      if (e.pharmacist != null) parts.push(L("pharm", { name: nameOf(e.pharmacist), w: nameOf(e.winner) }));
      if (e.tie) parts.push(L(e.drew ? "tie" : "drewNothing", { a: nameOf(e.attacker) }));
      else {
        const loser = e.winner === e.attacker ? e.defender : e.attacker;
        parts.push(L(e.choice === "take" ? "take" : "peek", { w: nameOf(e.winner), l: nameOf(loser) }));
      }
      return undefined;
    }
    case "gift": return L("gift", { from: nameOf(e.from), to: nameOf(e.to) });
    case "demand": return L(e.had ? "demandYes" : "demandNo", { name: nameOf(e.seat), target: nameOf(e.target), kind: itemName(e.kind) });
    case "fortune": return L("fortune", { name: nameOf(e.seat) });
    case "declare": {
      const gangWrong = e.revealed.slice(1).some((r) => r.gang !== e.gang);
      return L("declare", { name: nameOf(e.seat), gang: gangName(e.gang), result: L(e.correct ? "right" : gangWrong ? "wrongGang" : "wrongCount") });
    }
    case "solo": return L("solo", { name: nameOf(e.seat) });
    default: return "";
  }
}

// ---------- rendering ----------
let handPick = null; // { ids: Set, on: (id) => void, dim: bool }
function render() {
  const v = curView();
  if (!v) return;
  const legal = curLegal();
  handPick = null;
  $("chatRow").hidden = game.mode !== "net";
  $("tableLeave").textContent = game.mode === "net" ? t("lobby.leave") : t("table.lobby");
  renderBar(v);
  renderPanel(v, legal);
  renderSeats(v, legal);
  renderHand(v);
  renderKnown(v);
  renderOverlay(v);
}
function renderBar(v) {
  $("barLeft").textContent = v.phase === "reveal" ? "" : t("table.stop", { n: num(Math.max(1, Math.ceil(v.turnNo / v.n))) });
  let right = `${t("table.pile", { n: v.pile })} · ${t("table.limit", { n: v.handLimit })}`;
  if (game.mode === "net" && game.deadline && v.phase !== "over") {
    const s = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
    right += ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  $("barRight").textContent = right;
}

function seatPickTargets(v, legal) {
  const ui = game.ui;
  if (v.phase === "turn" && v.turn === game.me) {
    if (ui.mode === "offer" && ui.item) return legal.filter((a) => a.type === "offer" && a.item === ui.item).map((a) => a.to);
    if (ui.mode === "attack") return legal.filter((a) => a.type === "attack").map((a) => a.target);
    if (ui.mode === "demand" && ui.kind) return legal.filter((a) => a.type === "demand" && a.kind === ui.kind).map((a) => a.target);
  }
  if (v.phase === "handLimit" && ui.item) return legal.filter((a) => a.type === "gift" && a.item === ui.item).map((a) => a.to);
  if (v.phase === "scuffle" && v.scuffle.step === "hypnotist" && v.scuffle.attacker === game.me) return legal.filter((a) => a.target != null).map((a) => a.target);
  return [];
}
function onSeatPick(v, legal, seat) {
  const ui = game.ui;
  if (v.phase === "turn") {
    if (ui.mode === "offer") return humanAct({ type: "offer", seat: game.me, to: seat, item: ui.item, announce: ui.announce });
    if (ui.mode === "attack") return humanAct({ type: "attack", seat: game.me, target: seat });
    if (ui.mode === "demand") return humanAct({ type: "demand", seat: game.me, target: seat, kind: ui.kind });
  }
  if (v.phase === "handLimit") return humanAct({ type: "gift", seat: game.me, item: ui.item, to: seat });
  if (v.phase === "scuffle") return humanAct({ type: "hypnotize", seat: game.me, target: seat });
}
function renderSeats(v, legal) {
  const box = clear($("seats"));
  const targets = seatPickTargets(v, legal);
  const f = v.scuffle;
  const top = Math.ceil(v.n / 2);
  const sits = [h("div", { class: "sit" }), h("div", { class: "sit" })];
  for (let s = 0; s < v.n; s++) {
    const sd = v.seats[s];
    const me = s === game.me;
    const pick = targets.includes(s);
    let faceCls = "", side = null;
    if (f) {
      if (s === f.attacker) { faceCls = "atk"; side = h("span", { class: "atk" }, t("table.swords")); }
      else if (s === f.defender) { faceCls = "def"; side = h("span", { class: "def" }, t("table.shields")); }
      else if (f.support[s] === "attacker") { faceCls = "atk"; side = h("span", { class: "atk" }, t("table.backA")); }
      else if (f.support[s] === "defender") { faceCls = "def"; side = h("span", { class: "def" }, t("table.backD")); }
      else if (f.support[s] === "out") { faceCls = "dim"; side = h("span", {}, t(f.hypnotized === s ? "table.named" : "table.out")); }
    }
    const bag = h("span", { class: "bag" }, t("table.bags", { n: sd.items }));
    if (sd.trade) bag.append(" · " + tradeName(sd.trade) + (sd.tradeUsed ? " ✓" : ""));
    if (sd.drink) bag.append(icon("drink", 12));
    const extra = v.phase === "over" && sd.gang ? h("span", { class: "bag " + (sd.gang === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(sd.gang)) : side ? h("span", { class: "bag" }, side) : null;
    const canSheet = !pick && !!sd.trade;
    const you = me ? (lang === "en" ? ` (${t("table.you")})` : `（${t("table.you")}）`) : "";
    const el = h("button", { type: "button",
      class: "fig" + (me ? " me" : "") + (v.turn === s && v.phase !== "over" && v.phase !== "reveal" ? " turn" : "") + (pick ? " pick" : ""),
      disabled: !pick && !canSheet,
      onclick: pick ? () => onSeatPick(v, legal, s) : canSheet ? () => openTradeSheet(sd.trade, s) : null },
      faceEl(s, faceCls), h("span", { class: "plate" }, nameOf(s) + you), bag, extra);
    sits[s < top ? 0 : 1].append(el);
  }
  for (const sit of sits) if (sit.childElementCount) box.append(h("div", { class: "bench" }, h("div", { class: "shade" }), sit));
}

// ---------- pictures ----------
function faceEl(seat, cls = "") {
  const id = game.faces[seat] || game.lobby?.seats?.find((x) => x.idx === seat)?.face;
  if (id) return h("img", { class: "face " + cls, src: "art/face_" + id + ".jpg", alt: "" });
  return h("span", { class: "face init " + cls }, [...(nameOf(seat) || "?")][0]);
}
const itemImg = (kind, cls = "") => h("img", { class: cls, src: "art/item_" + kind + ".jpg", alt: "" });
const tradeImg = (tr, cls = "") => h("img", { class: cls, src: "art/trade_" + tr + ".jpg", alt: "" });
// A luggage card: the picture and its name. Tapping it picks it when a pick is
// on, otherwise opens its text.
const pic = (kind, o = {}) => h("button", { type: "button", class: "pic" + (o.cls || ""), disabled: !!o.disabled, onclick: o.onclick || null }, itemImg(kind), h("span", {}, (o.label || "") + itemName(kind)));
const thumb = (kind, onclick) => h("button", { type: "button", class: "thumbbtn", title: itemName(kind), onclick }, itemImg(kind, "thumb"));

// ---------- the bottom sheet: what a card or a trade does ----------
function openSheet(...children) { const sh = clear($("sheet")); sh.append(h("div", { class: "grip" }), ...children); sh.hidden = false; $("scrim").hidden = false; }
function closeSheet() { $("sheet").hidden = true; $("scrim").hidden = true; }
$("scrim").addEventListener("click", closeSheet);
function openItemSheet(kind, where = "") {
  const def = E.ITEM_BY_KIND[kind] || {};
  openSheet(
    h("div", { class: "row", style: "gap:14px;align-items:flex-start" }, itemImg(kind, "art"),
      h("div", { class: "stack", style: "gap:4px;flex:1;min-width:0" },
        h("div", { class: "row between" }, h("span", { class: "disp ttl" }, itemName(kind)), h("span", { class: "tag" }, t("sheet.inDeck", { n: def.count || 1 }))),
        h("p", { class: "small" }, t("itemText." + kind)))),
    h("div", { class: "rule" }),
    h("div", { class: "row between" }, h("span", { class: "hint" }, where), btn(t("sheet.close"), "ghost sm", closeSheet)));
}
function openTradeSheet(tr, seat = null) {
  const def = E.TRADE_BY_ID[tr] || {};
  const who = seat === null ? null : seat === game.me ? h("span", { class: "hint" }, t("sheet.yours"))
    : h("div", { class: "row", style: "gap:8px" }, faceEl(seat, "sm"), h("span", { class: "hint" }, t("sheet.shownBy", { name: nameOf(seat) })));
  openSheet(
    h("div", { class: "row", style: "gap:14px;align-items:flex-start" }, tradeImg(tr, "art"),
      h("div", { class: "stack", style: "gap:4px;flex:1;min-width:0" }, who,
        h("div", { class: "row between" }, h("span", { class: "disp ttl" }, tradeName(tr)), h("span", { class: "tag" }, t(def.once ? "reveal.once" : "reveal.always"))),
        h("p", { class: "small" }, t("tradeText." + tr)))),
    h("div", { class: "rule" }),
    h("div", { class: "row between" }, h("span", {}), btn(t("sheet.close"), "ghost sm", closeSheet)));
}

function renderHand(v) {
  const box = clear($("hand"));
  if (v.phase === "reveal" || !v.me) return;
  const mine = v.me.items;
  box.append(h("span", { class: "lab" }, t("table.yourBag", { n: mine.length, max: v.handLimit }) + (handPick || !mine.length ? "" : " · " + t("table.tapHint"))));
  const row = h("div", { class: "hand" });
  for (const it of mine) {
    const pickable = handPick && handPick.ids.has(it.id);
    const sel = game.ui.item === it.id || game.ui.picks.includes(it.id) || game.ui.showItems.has(it.id);
    row.append(pic(it.kind, { cls: (pickable ? " pick" : handPick ? " dim" : "") + (sel ? " sel" : ""), disabled: !!handPick && !pickable,
      onclick: pickable ? () => handPick.on(it.id) : handPick ? null : () => openItemSheet(it.kind, t("sheet.inHand")) }));
  }
  if (!mine.length) row.append(h("span", { class: "hint" }, t("table.empty")));
  box.append(row);
}

function renderKnown(v) {
  const box = $("knownBox");
  const list = clear($("knownList"));
  const latest = {};
  for (const k of v.knowledge) {
    if (k.k === "gang") latest["g" + k.seat] = t("table.known.gang", { name: nameOf(k.seat), gang: gangName(k.gang) });
    if (k.k === "trade") latest["t" + k.seat] = t("table.known.trade", { name: nameOf(k.seat), trade: tradeName(k.trade) });
    if (k.k === "hand") latest["h" + k.seat] = t("table.known.hand", { name: nameOf(k.seat), items: k.items.map((x) => itemName(x.kind)).join(lang === "en" ? ", " : "、") }) + ` (${t("table.stop", { n: num(Math.max(1, Math.ceil(k.at / v.n))) })})`;
  }
  const lines = Object.values(latest);
  box.hidden = !lines.length || v.phase === "over";
  for (const l of lines) list.append(h("li", {}, l));
}

function renderLog() {
  const box = clear($("log"));
  for (const l of game.log.slice(-60)) {
    if (l.seat === null) box.append(h("div", { class: l.hot ? "hot" : "" }, l.text));
    else box.append(h("div", { class: "say" }, faceEl(l.seat, "xs"), h("span", {}, h("b", {}, nameOf(l.seat)), h("i", {}, "："), l.text)));
  }
  box.scrollTop = box.scrollHeight;
}

// ---------- the panel ----------
const btn = (label, cls, onclick, disabled = false) => h("button", { type: "button", class: "btn " + (cls || ""), onclick, disabled }, label);
function waiting(v) {
  const who = v.waitingOn.filter((s) => s !== game.me);
  if (!who.length) return null;
  return h("p", { class: "hint" }, who.length === 1 ? t("table.waitingOne", { name: nameOf(who[0]) }) : t("table.waiting", { names: nameList(who) }));
}
const itemCard = (it, big = false) => pic(it.kind, { cls: big ? " big" : "", onclick: () => openItemSheet(it.kind) });
function renderPanel(v, legal) {
  const box = clear($("panel"));
  const p = h("div", { class: "panel" });
  box.append(p);
  const ui = game.ui;
  const me = game.me;
  const mineOnTurn = v.phase === "turn" && v.turn === me;

  if (v.phase === "over") return p.append(overCard(v));

  if (v.phase === "turn" && !mineOnTurn) {
    p.append(h("div", { class: "card" }, h("div", { class: "title disp" }, t("table.turnOf", { name: nameOf(v.turn) })), waiting(v)));
    return;
  }

  if (mineOnTurn) {
    const solo = legal.find((a) => a.type === "solo");
    const card = h("div", { class: "card hot" });
    if (!ui.mode) {
      card.append(h("div", { class: "title disp" }, h("span", {}, t("table.yourTurn")), h("span", { class: "hint" }, t("table.pick"))));
      const canOffer = legal.some((a) => a.type === "offer"), canAttack = legal.some((a) => a.type === "attack");
      const declare = legal.find((a) => a.type === "declare");
      card.append(h("div", { class: "toolbar" },
        btn(t("table.trade"), "", () => { ui.mode = "offer"; render(); }, !canOffer),
        btn(t("table.fight"), "warn", () => { ui.mode = "attack"; render(); }, !canAttack),
        btn(t("table.declare"), "brass", () => { ui.mode = "declare"; render(); }, !declare),
        btn(t("table.pass"), "ghost", () => humanAct({ type: "pass", seat: me }))));
      const extras = [];
      if (legal.some((a) => a.type === "fortune")) extras.push(btn(t("table.fortune"), "sm", () => humanAct({ type: "fortune", seat: me })));
      if (legal.some((a) => a.type === "demand")) extras.push(btn(t("table.demand"), "sm", () => { ui.mode = "demand"; render(); }));
      if (solo) extras.push(btn(t("table.solo"), "sm brass", () => humanAct(solo)));
      if (extras.length) card.append(h("div", { class: "row wrap" }, ...extras));
      if (!declare) card.append(h("p", { class: "hint" }, v.me.items.some((x) => x.kind === "black_letter") ? t("table.declareBlocked") : t("table.declareNone")));
    } else if (ui.mode === "offer") {
      const kinds = legal.filter((a) => a.type === "offer");
      handPick = { ids: new Set(kinds.map((a) => a.item)), on: (id) => { ui.item = id; render(); } };
      card.append(h("div", { class: "title disp" }, ui.item ? t("table.offerWho", { item: itemName(kindOf(v, ui.item)) }) : t("table.offerWhat")));
      if (v.options.smuggling && ui.item && E.ITEM_BY_KIND[kindOf(v, ui.item)].trade) {
        card.append(h("label", { class: "opt" }, h("input", { type: "checkbox", checked: ui.announce, onchange: (e) => { ui.announce = e.target.checked; } }), t("table.offerAnnounce")));
      }
      if (ui.item) card.append(h("p", { class: "hint" }, t("itemText." + kindOf(v, ui.item))));
      card.append(btn(t("table.cancel"), "ghost sm", () => { game.ui = freshUi(); render(); }));
    } else if (ui.mode === "attack") {
      card.append(h("div", { class: "title disp" }, t("table.attackWho")));
      card.append(btn(t("table.cancel"), "ghost sm", () => { game.ui = freshUi(); render(); }));
    } else if (ui.mode === "demand") {
      card.append(h("div", { class: "title disp" }, ui.kind ? t("table.demandWho") : t("table.demandWhat")));
      const kinds = [...new Set(legal.filter((a) => a.type === "demand").map((a) => a.kind))];
      card.append(h("div", { class: "row wrap" }, ...kinds.map((k) => h("button", { type: "button", class: "pill" + (ui.kind === k ? " on" : ""), onclick: () => { ui.kind = k; render(); } }, itemName(k)))));
      card.append(btn(t("table.cancel"), "ghost sm", () => { game.ui = freshUi(); render(); }));
    } else if (ui.mode === "declare") {
      const gang = v.me.gang, other = E.other(gang);
      const mine = v.me.items.filter((x) => x.kind === E.GOAL[gang] || (v.pile === 0 && x.kind === `case_${E.GOAL[gang]}`)).length;
      card.append(h("div", { class: "title disp" }, t("table.declareTitle")));
      card.append(h("p", { class: "small" }, t("table.declareText", { gang: gangName(gang), goal: t("goal." + gang), other: gangName(other) })));
      const total = mine + Object.values(ui.holders).reduce((a, b) => a + b, 0);
      card.append(h("div", { class: "row between" }, h("span", {}, t("table.declareMine", { n: mine })), h("span", { class: "hint" }, total >= E.NEEDED ? "" : t("table.declareNeed", { n: E.NEEDED - total }) + (v.me.drink ? " " + t("table.declareDrink") : ""))));
      card.append(h("span", { class: "lab" }, t("table.declareWho")));
      const lines = h("div", { class: "lines" });
      for (let s = 0; s < v.n; s++) {
        if (s === me || !v.seats[s].items) continue;
        const k = ui.holders[s] || 0;
        lines.append(h("div", {}, h("span", {}, nameOf(s)), h("span", { class: "row" },
          btn("−", "ghost sm", () => { ui.holders[s] = Math.max(0, k - 1); if (!ui.holders[s]) delete ui.holders[s]; render(); }, k === 0),
          h("b", {}, String(k)),
          btn("+", "ghost sm", () => { ui.holders[s] = Math.min(3, k + 1); render(); }, k >= 3))));
      }
      card.append(lines);
      card.append(h("div", { class: "grid2" },
        btn(t("table.cancel"), "ghost", () => { game.ui = freshUi(); render(); }),
        btn(t("table.declareGo"), "p", () => humanAct({ type: "declare", seat: me, holders: { ...ui.holders } }))));
    }
    p.append(card);
    return;
  }

  if (v.phase === "peek") {
    if (v.turn !== me) { p.append(h("div", { class: "card" }, waiting(v))); return; }
    const card = h("div", { class: "card hot" }, h("div", { class: "title disp" }, t("table.fortune")), h("p", { class: "hint" }, t("table.peek")));
    const row = h("div", { class: "hand" });
    for (const it of v.peek) {
      const idx = ui.picks.indexOf(it.id);
      row.append(pic(it.kind, { cls: " pick" + (idx >= 0 ? " sel" : ""), label: idx >= 0 ? `${idx + 1}. ` : "", onclick: () => { if (idx >= 0) ui.picks.splice(idx, 1); else if (ui.picks.length < 2) ui.picks.push(it.id); render(); } }));
    }
    card.append(row, btn(t("table.arrange"), "p", () => humanAct({ type: "arrange", seat: me, top: ui.picks.slice() }), ui.picks.length !== 2));
    p.append(card);
    return;
  }

  if (v.phase === "handLimit") {
    if (v.waitingOn[0] !== me) { p.append(h("div", { class: "card" }, waiting(v))); return; }
    handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => { ui.item = id; render(); } };
    p.append(h("div", { class: "card hot" }, h("div", { class: "title disp" }, ui.item ? t("table.giveTo") : t("table.overLimit"))));
    return;
  }

  if (v.phase === "trade") {
    const tr = v.trade;
    const card = h("div", { class: "card hot" });
    if (tr.step === "answer" && tr.to === me) {
      const offered = tr.offered;
      const returns = legal.filter((a) => a.accept).map((a) => a.item);
      const refuse = legal.find((a) => !a.accept);
      handPick = { ids: new Set(returns), on: (id) => { ui.item = id; render(); } };
      card.append(h("div", { class: "title disp" }, h("span", {}, t("table.offered", { name: nameOf(tr.from) })), h("span", { class: "hint" }, t("table.offeredOnly"))));
      card.append(h("div", { class: "row", style: "align-items:flex-start" }, itemCard(offered, true), h("div", { class: "stack" }, h("b", {}, itemName(offered.kind)), h("p", { class: "hint" }, t("itemText." + offered.kind)), !refuse ? h("p", { class: "hint" }, t("table.mustAccept")) : null)));
      card.append(h("div", { class: "rule" }), h("span", { class: "lab" }, t("table.returnWhat")));
      if (v.options.smuggling && ui.item && E.ITEM_BY_KIND[kindOf(v, ui.item)].trade) {
        card.append(h("label", { class: "opt" }, h("input", { type: "checkbox", checked: ui.announce, onchange: (e) => { ui.announce = e.target.checked; } }), t("table.offerAnnounce")));
      }
      card.append(h("div", { class: "grid2" },
        btn(t("table.refuse"), "ghost", () => humanAct({ type: "answer", seat: me, accept: false }), !refuse),
        btn(ui.item ? t("table.accept", { item: itemName(kindOf(v, ui.item)) }) : t("table.returnWhat"), "p", () => humanAct({ type: "answer", seat: me, accept: true, item: ui.item, announce: ui.announce }), !ui.item)));
    } else if (tr.step === "return" && tr.from === me) {
      handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => humanAct({ type: "give", seat: me, item: id }) };
      card.append(h("div", { class: "title disp" }, t("table.forcedReturn", { item: itemName(tr.wanted.kind), name: nameOf(tr.to) })));
    } else if (tr.step === "codebook" && tr.actor === me) {
      const partner = tr.from === me ? tr.to : tr.from;
      card.append(h("div", { class: "title disp" }, t("table.codebook", { name: nameOf(partner) })));
      card.append(h("div", { class: "grid2" }, btn(t("table.swapNo"), "ghost", () => humanAct({ type: "codebook", seat: me, swap: false })), btn(t("table.swapYes"), "p", () => humanAct({ type: "codebook", seat: me, swap: true }))));
    } else if (tr.step === "coat" && tr.actor === me) {
      card.append(h("div", { class: "title disp" }, t("table.coat")));
      card.append(h("div", { class: "stack" }, btn(t("table.keepTrade", { trade: tradeName(v.me.trade) }), "ghost", () => humanAct({ type: "coat", seat: me, trade: null })),
        ...v.coatChoices.map((tr2) => btn(tradeName(tr2), "split", () => humanAct({ type: "coat", seat: me, trade: tr2 })))));
      card.append(...v.coatChoices.map((tr2) => h("p", { class: "hint" }, h("b", {}, tradeName(tr2) + ": "), t("tradeText." + tr2))));
    } else if (tr.step === "direction" && tr.actor === me) {
      card.append(h("div", { class: "title disp" }, t("table.direction")));
      card.append(h("div", { class: "grid2" }, btn(t("table.left"), "", () => humanAct({ type: "direction", seat: me, dir: "left" })), btn(t("table.right"), "", () => humanAct({ type: "direction", seat: me, dir: "right" }))));
    } else if (tr.step === "passItems" && v.waitingOn.includes(me)) {
      handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => humanAct({ type: "passItem", seat: me, item: id }) };
      card.append(h("div", { class: "title disp" }, t("table.passItem")));
    } else {
      card.className = "card";
      card.append(h("div", { class: "title disp" }, t("table.turnOf", { name: nameOf(tr.from) })), waiting(v));
    }
    p.append(card);
    return;
  }

  if (v.phase === "scuffle") p.append(scuffleCard(v, legal));
}

function scuffleCard(v, legal) {
  const f = v.scuffle, me = game.me, ui = game.ui;
  const card = h("div", { class: "card fight" });
  const counted = ["doctor", "choice", "take"].includes(f.step);
  const tally = (side) => 1 + Object.values(f.support).filter((x) => x === side).length;
  const sw = counted ? f.swords : tally("attacker"), sh = counted ? f.shields : tally("defender");
  const title = counted && f.tie ? t("table.tie", { name: nameOf(f.attacker) }) : counted && f.winner != null ? t("table.won", { name: nameOf(f.winner) })
    : f.defender === me ? t("table.attackOnYou", { a: nameOf(f.attacker) }) : f.attacker === me ? t("table.youAttack", { b: nameOf(f.defender) }) : t("table.attackOn", { a: nameOf(f.attacker), b: nameOf(f.defender) });
  card.append(h("div", { class: "title disp" }, h("span", {}, title), counted ? h("span", { class: "hint nowrap" }, t("log.count", { swords: sw, shields: sh }).replace(/[。.]$/, "")) : null));
  const side = (s, cls, ic, n) => h("div", { class: "side" }, faceEl(s, "lg " + cls), h("span", { class: "nm" }, nameOf(s)), h("div", { class: "row", style: "gap:6px" }, h("span", { class: cls }, icon(ic, 20)), h("span", { class: "num " + cls }, String(n))));
  card.append(h("div", { class: "duel" }, side(f.attacker, "atk", "sword", sw), h("span", { class: "vs lat" }, "vs"), side(f.defender, "def", "shield", sh)));
  const shownOf = (s) => { const x = f.shown[s]; const out = []; if (!x) return out; for (const k of x.items) out.push(thumb(k, () => openItemSheet(k))); if (x.trade) out.push(h("button", { type: "button", class: "thumbbtn", title: tradeName(x.trade), onclick: () => openTradeSheet(x.trade, s) }, tradeImg(x.trade, "thumb"))); return out; };
  const sup = h("div", { class: "sup" });
  const started = Object.keys(f.support).length > 0 || Object.keys(f.shown).length > 0;
  for (let s = 0; s < v.n && started; s++) {
    if (s === f.attacker || s === f.defender) continue;
    const st = f.support[s];
    const cls = st === "attacker" ? "atk" : st === "defender" ? "def" : st === "out" ? "dim" : "";
    const right = h("div", { class: "row", style: "gap:8px" }, ...shownOf(s));
    if (st === "attacker") right.append(h("span", { class: "atk" }, t("table.backA")), h("span", { class: "atk" }, icon("sword", 18)));
    else if (st === "defender") right.append(h("span", { class: "def" }, t("table.backD")), h("span", { class: "def" }, icon("shield", 18)));
    else if (st === "out") right.append(...(f.hypnotized === s ? [h("span", { class: "tag" }, t("table.named"))] : []), h("span", { class: "hint" }, t("table.out")), h("span", { class: "hint" }, icon("out", 18)));
    else right.append(h("span", { class: "hint" }, "…"));
    sup.append(h("div", {}, h("div", { class: "row", style: "gap:8px" }, faceEl(s, "sm " + cls), h("span", {}, nameOf(s))), right));
  }
  for (const s of [f.attacker, f.defender]) {
    const shown = shownOf(s);
    if (shown.length) sup.append(h("div", {}, h("div", { class: "row", style: "gap:8px" }, faceEl(s, "sm"), h("span", {}, nameOf(s))), h("div", { class: "row", style: "gap:8px" }, ...shown)));
  }
  if (sup.childElementCount) card.append(sup);
  const iAct = v.waitingOn.includes(me);
  if (!iAct) { card.append(waiting(v)); return card; }

  switch (f.step) {
    case "priest": case "gunman": case "doctor": {
      const use = legal.find((a) => a.use), skip = legal.find((a) => !a.use);
      card.append(h("p", {}, t("table.window." + f.step)));
      card.append(h("div", { class: "grid2" }, btn(t("table.skip"), "ghost", () => humanAct(skip)), btn(t("table.use"), "p", () => humanAct(use), !use)));
      break;
    }
    case "priestPay":
      handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => humanAct({ type: "give", seat: me, item: id }) };
      card.append(h("p", {}, t("table.priestPay", { name: nameOf(f.priest) })));
      break;
    case "support":
      card.append(h("p", {}, t("table.supportQ")));
      card.append(h("div", { class: "grid3" },
        btn(t("table.backA"), "warn", () => humanAct({ type: "support", seat: me, side: "attacker" })),
        btn(t("table.out"), "ghost", () => humanAct({ type: "support", seat: me, side: "out" })),
        btn(t("table.backD"), "", () => humanAct({ type: "support", seat: me, side: "defender" }))));
      break;
    case "hypnotist":
      card.append(h("p", {}, t("table.hypnoQ")));
      card.append(btn(t("table.hypnoNone"), "ghost", () => humanAct({ type: "hypnotize", seat: me, target: null })));
      break;
    case "powers": {
      const withItems = legal.find((a) => a.items.length);
      const usable = withItems ? withItems.items : [];
      const tradeOpt = legal.find((a) => a.trade);
      card.append(h("p", {}, t("table.powersQ")));
      for (const id of usable) {
        card.append(h("label", { class: "opt" }, h("input", { type: "checkbox", checked: ui.showItems.has(id), onchange: (e) => { if (e.target.checked) ui.showItems.add(id); else ui.showItems.delete(id); } }), itemName(kindOf(v, id)), h("span", { class: "hint" }, t("itemText." + kindOf(v, id)))));
      }
      if (tradeOpt) {
        card.append(h("label", { class: "opt" }, h("input", { type: "checkbox", checked: ui.showTrade, onchange: (e) => { ui.showTrade = e.target.checked; render(); } }), t("table.useTrade", { trade: tradeName(v.me.trade) })));
        if (v.me.trade === "pharmacist" && ui.showTrade) {
          card.append(h("p", { class: "hint" }, t("table.pharmWinner")));
          card.append(h("div", { class: "grid2" }, ...[f.attacker, f.defender].map((s) => h("button", { type: "button", class: "pill" + (ui.winner === s ? " on" : ""), onclick: () => { ui.winner = s; render(); } }, nameOf(s)))));
        }
      }
      const needWinner = ui.showTrade && v.me.trade === "pharmacist" && ui.winner == null;
      card.append(btn(usable.length || tradeOpt ? t("table.count") : t("table.showNothing"), "p", () => humanAct({ type: "show", seat: me, items: [...ui.showItems], trade: ui.showTrade, winner: ui.winner }), needWinner));
      break;
    }
    case "choice": {
      const loser = f.winner === f.attacker ? f.defender : f.attacker;
      const take = legal.find((a) => a.take);
      card.append(h("p", {}, t("table.choiceQ")));
      card.append(h("div", { class: "stack" }, btn(t("table.peekChoice", { name: nameOf(loser) }), "", () => humanAct({ type: "choice", seat: me, take: false })),
        btn(t("table.takeChoice", { name: nameOf(loser) }), "p", () => humanAct({ type: "choice", seat: me, take: true }), !take)));
      break;
    }
    case "take": {
      card.append(h("p", {}, t("table.takeWhich")));
      const row = h("div", { class: "hand" });
      for (const it of f.loserHand) row.append(pic(it.kind, { cls: " pick", onclick: () => humanAct({ type: "takeItem", seat: me, item: it.id }) }));
      card.append(row);
      break;
    }
  }
  return card;
}

function overCard(v) {
  const wrap = h("div", { class: "stack" });
  const soloWin = typeof v.winner === "number";
  const head = h("div", { class: "card dark ticket over" });
  if (soloWin) head.append(itemImg("first_class_ticket", "medal"), h("div", { class: "disp g" }, t("over.soloWins", { name: nameOf(v.winner) })), h("span", { class: "hint" }, t("over.solo")));
  else {
    const by = v.event && v.event.by != null ? nameOf(v.event.by) : "";
    head.append(h("img", { class: "medal", src: "art/gang_" + E.GOAL[v.winner] + ".jpg", alt: "" }), h("div", { class: "disp g " + (v.winner === E.TIMEKEEPERS ? "watch" : "seal") }, t("over.gangWins", { gang: gangName(v.winner) })), h("span", { class: "hint" }, t(v.reason === "declared" ? "over.declared" : "over.wrong", { name: by })));
  }
  wrap.append(head);
  const table = h("table", {}, h("tr", {}, h("th", {}, t("over.passengers")), h("th", {}, t("over.gangCol")), h("th", {}, t("over.tradeCol")), h("th", {}, t("over.bagsCol"))));
  for (let s = 0; s < v.n; s++) {
    const sd = v.seats[s];
    table.append(h("tr", {}, h("td", { class: "nowrap" }, h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, faceEl(s, "xs"), h("span", {}, nameOf(s) + (s === game.me ? ` (${t("table.you")})` : "")))), h("td", { class: "nowrap " + (sd.gang === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(sd.gang)), h("td", {}, h("button", { type: "button", class: "linkish plain", onclick: () => openTradeSheet(sd.trade, s) }, tradeName(sd.trade))), h("td", { class: "icons" }, h("div", { class: "row" }, ...sd.hand.map((x) => thumb(x.kind, () => openItemSheet(x.kind)))))));
  }
  wrap.append(h("div", { class: "card" }, table));
  if (game.mode === "solo") wrap.append(btn(t("table.again"), "p", () => startGame()));
  else if (game.me === 0) wrap.append(btn(t("table.again"), "p", () => send({ type: "rematch" })));
  else wrap.append(h("p", { class: "hint center" }, t("lobby.rematchWait")));
  return wrap;
}

function renderOverlay(v) {
  const ov = $("overlay");
  if (v.phase !== "reveal" || game.me === null || v.ready[game.me]) { ov.hidden = true; return; }
  ov.hidden = false;
  clear(ov);
  const me = v.me, gang = me.gang, other = E.other(gang);
  const tr = E.TRADE_BY_ID[me.trade];
  const rowCard = (img, ...body) => h("div", { class: "card row", style: "gap:12px;align-items:flex-start" }, img, h("div", { class: "stack", style: "gap:2px;flex:1;min-width:0" }, ...body));
  ov.append(h("main", { class: "scr" },
    h("div", { class: "row", style: "justify-content:center;gap:12px" }, faceEl(game.me, "me"), h("span", { class: "hint" }, t("reveal.only"))),
    h("div", { class: "card dark gangcard" }, h("img", { src: "art/gang_" + E.GOAL[gang] + ".jpg", alt: "" }),
      h("div", { class: "cap" }, h("span", { class: "lab" }, t("reveal.yourGang")), h("div", { class: "disp g " + (gang === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(gang)),
        h("span", { class: "lat sub2" }, t("gang." + gang + "Lat") + " · " + t("goal." + gang)),
        h("p", { class: "small" }, t("reveal.goalText", { goal: t("goal." + gang), other: gangName(other), otherGoal: t("goal." + other) })))),
    rowCard(tradeImg(me.trade, "art sm"), h("span", { class: "lab" }, t("reveal.yourTrade")), h("div", { class: "row between" }, h("span", { class: "disp", style: "font-size:22px" }, tradeName(me.trade)), h("span", { class: "tag" }, t(tr.once ? "reveal.once" : "reveal.always"))), h("p", { class: "small" }, t("tradeText." + me.trade))),
    ...me.items.map((it, i) => rowCard(itemImg(it.kind, "art sm"), i === 0 ? h("span", { class: "lab" }, t("reveal.yourBag")) : null, h("span", { class: "disp", style: "font-size:20px" }, itemName(it.kind)), h("p", { class: "small" }, t("itemText." + it.kind)))),
    me.drink ? h("p", { class: "hint" }, t("reveal.drink")) : null,
    h("div", { class: "spacer" }),
    btn(t("reveal.ready"), "p", () => humanAct({ type: "ready", seat: game.me }))));
}

const kindOf = (v, id) => (v.me.items.find((x) => x.id === id) || {}).kind || id.replace(/\d+$/, "");

// ---------- routing ----------
const views = ["landing", "setup", "lobby", "table"];
function show(name) { closeSheet(); for (const v of views) $("view-" + v).hidden = v !== name; if (name !== "table") $("overlay").hidden = true; }
function go(q) { history.pushState(null, "", location.pathname + q); route(); }
function route() {
  const q = new URLSearchParams(location.search);
  const code = (q.get("room") || "").toUpperCase();
  $("landStatus").textContent = ""; $("landStatus").classList.remove("err");
  $("landName").value = setup.name;
  if (q.has("play")) {
    leaveRoom(true); game.mode = "solo";
    game.auto = q.get("auto") === "1";
    if (game.auto && !game.st) { show("setup"); startGame(); return; }
    if (!game.st) show("setup"); else show("table");
    return;
  }
  if (/^[A-Z0-9]{4}$/.test(code)) {
    if (game.mode === "net" && game.code === code && game.ws) { show(game.view ? "table" : "lobby"); return; }
    if (!setup.name) { show("landing"); $("joinCode").value = code; setStatus(t("lobby.err.needName"), true); $("landName").focus(); return; }
    connect({ code });
    show("lobby"); $("lbCode").textContent = code; clear($("lbSeats")); $("lbStatus").textContent = t("lobby.connecting");
    return;
  }
  leaveRoom(true);
  clearTimeout(game.botTimer);
  game.mode = "solo"; game.st = null; game.view = null;
  show("landing");
}
document.querySelectorAll("[data-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); leaveRoom(); go(""); }));
window.addEventListener("popstate", route);

setLang(new URLSearchParams(location.search).get("lang") || store.get("lt.lang", navigator.language.startsWith("zh") ? "zh-Hant" : "en"));
route();
