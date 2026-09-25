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
import { DWELL, moveTier } from "./shared/pace.js";
import { looksFromLog, isStale } from "./shared/seen.js";

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
  // the tutorial's entry line steps aside once it has been run
  const done = store.get("lt.tutDone", "0") === "1";
  $("tutLink").textContent = t(done ? "tutorial.linkDone" : "tutorial.link");
  $("tutLink").parentElement.classList.toggle("done", done);
  if (!$("view-tutorial").hidden) renderTutorial();
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
  dlc: store.get("lt.dlc", "0") === "1",
  events: store.get("lt.ev", "0") === "1",
  film: store.get("lt.film", "1") === "1",
  face: store.get("lt.face", ""),
};
const ALL_DLC = Object.fromEntries(E.EXPANSIONS.map((k) => [k, true]));
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
  $("dlcChk").checked = setup.dlc;
  dlcCards($("dlcCards"), setup.dlc);
  $("evChk").checked = setup.events;
  eventCards($("evCards"), setup.events);
  $("filmChk").checked = setup.film;
}
$("pMinus").addEventListener("click", () => { setup.n = Math.max(E.MIN_PLAYERS, setup.n - 1); store.set("lt.n", setup.n); renderSetup(); });
$("pPlus").addEventListener("click", () => { setup.n = Math.min(E.MAX_PLAYERS, setup.n + 1); store.set("lt.n", setup.n); renderSetup(); });
document.querySelectorAll("#levelSeg button").forEach((b) => b.addEventListener("click", () => { setup.level = b.dataset.level; store.set("lt.level", setup.level); renderSetup(); }));
$("nameInput").addEventListener("input", (e) => { setup.name = e.target.value.trim().slice(0, 16); store.set("lt.name", setup.name); });
$("smugChk").addEventListener("change", (e) => { setup.smuggling = e.target.checked; store.set("lt.smug", setup.smuggling ? "1" : "0"); });
$("dlcChk").addEventListener("change", (e) => { setup.dlc = e.target.checked; store.set("lt.dlc", setup.dlc ? "1" : "0"); renderSetup(); });
$("evChk").addEventListener("change", (e) => { setup.events = e.target.checked; store.set("lt.ev", setup.events ? "1" : "0"); renderSetup(); });
$("filmChk").addEventListener("change", (e) => { setup.film = e.target.checked; store.set("lt.film", setup.film ? "1" : "0"); });

// ---------- the short films ----------
// Boarding as the train leaves, and how the journey ended. They play full screen
// over everything; a tap, the skip button or the end of the clip hands the game
// back. Off when the setting is off, when the system asks for less motion, or
// when a seat is playing itself.
const FILMS = { board: "video/board.mp4", win: "video/win.mp4", lose: "video/lose.mp4" };
// How the screen turns over when a film ends: to black, then the black lifts on
// the carriage, and only after a breath does anybody move.
const FADE = { black: 1000, lift: 1000, settle: 1000 };
let endFilm = null; // what to do once the film is done, while one is playing
function filmsOn() {
  if (!setup.film || game.auto) return false;
  try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
}
function playFilm(kind, then) {
  const box = $("film"), vid = $("filmVid");
  if (!filmsOn() || !FILMS[kind]) { if (then) then(); return; }
  endFilm = () => { endFilm = null; closeFilm(then); };
  vid.src = FILMS[kind];
  vid.muted = false;
  box.hidden = false;
  // a film that will not play with sound plays without it; one that will not
  // play at all gets out of the way
  vid.play().catch(() => { vid.muted = true; vid.play().catch(() => endFilm && endFilm()); });
}
// The film fades to black; behind the black the game takes its place; the black
// lifts, and the carriage waits a second before anyone acts.
function closeFilm(then) {
  const box = $("film"), vid = $("filmVid");
  game.hold = true;
  box.classList.add("toblack");
  setTimeout(() => {
    try { vid.pause(); vid.removeAttribute("src"); vid.load(); } catch {}
    if (then) then();
    box.classList.add("out");
    setTimeout(() => {
      box.hidden = true;
      box.classList.remove("toblack", "out");
      // the fade this undoing starts can never finish behind a hidden screen,
      // and a leftover one holds the next film at nothing: drop it here
      box.getAnimations().forEach((a) => a.cancel());
      setTimeout(() => { game.hold = false; tick(); }, FADE.settle);
    }, FADE.lift);
  }, FADE.black);
}
// The result stays on screen until the player says they have seen it. Then the
// black closes over the carriage and the film comes up out of the black.
function playFilmFromBlack(kind, then) {
  const box = $("film");
  if (!kind || !filmsOn() || !FILMS[kind]) { if (then) then(); return; }
  box.hidden = false;
  box.classList.add("out", "toblack"); // invisible, and the film waiting behind the black
  box.getAnimations().forEach((a) => a.cancel());
  void box.offsetWidth;                // the fade needs somewhere to start from
  box.classList.remove("out");         // the black closes over the result
  setTimeout(() => { box.classList.remove("toblack"); playFilm(kind, then); }, FADE.black);
}
$("film").addEventListener("click", () => endFilm && endFilm());
$("filmVid").addEventListener("ended", () => endFilm && endFilm());
$("filmVid").addEventListener("error", () => endFilm && endFilm());
$("btnStart").addEventListener("click", () => startGame());
$("btnPlay").addEventListener("click", () => go("?play"));
$("tutLink").addEventListener("click", () => go("?tutorial"));
$("btnTutStart").addEventListener("click", () => go("?play=tutorial"));
$("btnTutSkip").addEventListener("click", () => go("?play"));

// ---------- game ----------
const game = {
  mode: "solo",       // "solo" | "net"
  st: null,           // solo: the full engine state
  view: null, legal: [], // net: this seat's view and legal actions from the room
  me: 0, names: [], faces: [], level: "normal", rng: E.makeRng(E.randomSeed()), botTimer: null, netTimer: null,
  log: [], logSeen: 0, auto: false, lastTier: "silent", says: [], sayTimer: null, sayTip: null,
  ws: null, code: null, lobby: null, closed: false, clock: null, gen: -1, deadline: 0,
  ui: freshUi(), peekSeat: null, result: null, evCard: null, seenCount: null, viewKey: "",
  tut: null,          // the guided game: { seen: { coachKey: true }, pending: coachKey | null }
  hold: false, filmOver: false, // the screen is turning over after a film; the ending film has been settled
  filmWait: null,     // the ending film, waiting for the player to say they have read the result
};
const curView = () => (game.mode === "solo" ? (game.st ? E.view(game.st, game.me) : null) : game.view);
const curLegal = () => (game.mode === "solo" ? (game.st ? E.legalActions(game.st, game.me) : []) : game.legal);
// Per-tab: the reconnect token, so two tabs in one browser are two players.
const sess = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};
function freshUi() { return { mode: null, item: null, kind: null, holders: {}, picks: [], showItems: new Set(), showTrade: false, winner: null, announce: true }; }
// How long the table holds still after each move: see shared/pace.js. A copy,
// so the self-playing check mode can run it at speed.
const WAIT = { ...DWELL };

function startGame() {
  leaveRoom(true);
  game.mode = "solo"; game.view = null; game.legal = [];
  const n = setup.n;
  game.rng = E.makeRng(E.randomSeed());
  game.st = E.createGame(E.randomSeed(), n, { smuggling: setup.smuggling, events: setup.events, dlc: setup.dlc ? ALL_DLC : undefined });
  game.me = 0; game.level = setup.level;
  game.faces = [setup.face, ...freeFaces(game.rng, [setup.face], E.shuffle).slice(0, n - 1)];
  game.names = soloNames();
  game.log = []; game.logSeen = 0; game.lastTier = "silent"; game.says = []; game.sayTip = null; game.ui = freshUi(); game.result = null; game.evCard = null; game.seenCount = null;
  game.tut = null; game.filmOver = false; game.filmWait = null; game.hold = false; resetJourney();
  clearTimeout(game.botTimer);
  show("table");
  tick();
}

// ---------- the guided game ----------
// A fixed four-seat table: you are seat 0 with a watch and the monocle, 花子
// (seat 2) is with you and holds the second watch, 陳老闆 (seat 3) holds the
// third, and 伊凡 (seat 1) is the one who comes at you. The bots follow a script
// while the game is on its rails and think for themselves the moment it leaves
// them, so going off script only means fewer guide slips. The script is written
// so the player gets there: the third watch is won two backers against one, and
// the declaration they are walked through is true.
const TUT_FACES = ["lin", "ivan", "hana", "chen"];
const TUT_HANDS = [["watch1", "monocle"], ["warrant"], ["watch2"], ["watch3", "dagger"]];
// The player's trade is the bodyguard on purpose: it only speaks up when you
// back somebody else, which the script never asks of you, so the guided game
// never stops for a power the guide has not explained.
const TUT_TRADES = ["bodyguard", "thug", "master", "gunman"];
const COACH_ORDER = ["reveal", "trade", "peeked", "scuffle", "attack", "declare"];
const TUT_P = () => ({ mate: nameOf(2), foe: nameOf(1), third: nameOf(3) });

function tutorialState() {
  const st = E.createGame(20260916, 4, {});
  const dealt = new Set(TUT_HANDS.flat());
  st.seats.forEach((sd, s) => {
    sd.items = TUT_HANDS[s].slice();
    sd.gang = s % 2 === 0 ? E.TIMEKEEPERS : E.SEALBEARERS;
    sd.trade = TUT_TRADES[s]; sd.tradeUsed = false; sd.tradeRevealed = false; sd.drink = false;
  });
  st.pile = Object.keys(st.items).filter((id) => !dealt.has(id));
  st.gangSizes = { [E.TIMEKEEPERS]: 2, [E.SEALBEARERS]: 2 };
  st.minority = null;
  st.spareTrades = E.TRADE_IDS.filter((tr) => !TUT_TRADES.includes(tr));
  st.turn = 0;
  return st;
}
function startTutorial() {
  leaveRoom(true);
  clearTimeout(game.botTimer);
  game.mode = "solo"; game.view = null; game.legal = []; game.auto = false;
  game.rng = E.makeRng(E.randomSeed());
  game.st = tutorialState();
  game.me = 0; game.level = "normal";
  game.faces = TUT_FACES.slice();
  game.names = soloNames();
  game.log = []; game.logSeen = 0; game.lastTier = "silent"; game.says = []; game.sayTip = null; game.ui = freshUi(); game.result = null; game.evCard = null; game.seenCount = null;
  game.tut = { seen: {}, pending: null }; game.filmOver = false; game.filmWait = null; game.hold = false; resetJourney();
  show("table");
  tick();
}
// What a bot does while the tutorial is on its rails, or null to let it think.
function tutorialAction(seat) {
  const st = game.st;
  if (st.phase === "turn" && st.turn === seat) {
    if (st.turnNo === 2 && seat === 1) return { type: "attack", seat, target: 0 };
    return { type: "pass", seat };
  }
  if (st.phase === "trade" && st.trade.step === "answer" && st.trade.to === seat) {
    const keep = E.legalActions(st, seat).filter((a) => a.accept);
    return keep.length ? keep[0] : null;
  }
  if (st.phase === "scuffle") {
    const f = st.scuffle;
    const loser = f.winner === f.attacker ? f.defender : f.attacker;
    if (["priest", "gunman", "doctor"].includes(f.step)) return { type: "window", seat, use: false };
    if (f.step === "support" && f.next === seat) {
      const withAttacker = f.attacker === 1 ? seat === 3 : seat === 2;
      return { type: "support", seat, side: withAttacker ? "attacker" : "out" };
    }
    if (f.step === "hypnotist" && f.attacker === seat) return { type: "hypnotize", seat, target: null };
    if (f.step === "powers") return { type: "show", seat, items: [], trade: false };
    if (f.step === "choice" && f.winner === seat) return { type: "choice", seat, take: true };
    if (f.step === "take" && f.winner === seat) {
      // never take the player's watch: the tutorial is a game they win
      const id = st.seats[loser].items.find((x) => st.items[x] !== "watch") || st.seats[loser].items[0];
      return id ? { type: "takeItem", seat, item: id } : null;
    }
  }
  return null;
}
// The scripted action only stands if the engine actually offers it.
function scriptedAction(seat, legal) {
  const a = tutorialAction(seat);
  if (!a) return null;
  const same = (x, y) => x === undefined || x === y;
  return legal.some((l) => l.type === a.type && same(l.item, a.item) && same(l.target, a.target)
    && same(l.side, a.side) && same(l.take, a.take) && same(l.use, a.use)) ? a : null;
}
function coachKey(v) {
  if (!game.tut) return null;
  const me = game.me;
  if (v.phase === "reveal") return "reveal";
  if (v.phase === "over") return null;
  if (v.phase === "turn" && v.turn === me) {
    const watches = v.me.items.filter((x) => x.kind === "watch").length;
    if (watches >= 2) return "declare";
    if (v.me.items.some((x) => x.kind === "monocle")) return "trade";
    return "attack";
  }
  if (v.phase === "scuffle" && v.scuffle.defender === me && v.scuffle.attacker !== me) return "scuffle";
  if (v.knowledge.some((k) => k.k === "gang" && k.seat === 1)) return "peeked";
  return null;
}
// The guide's slip: one step at a time, and a way to be rid of it. The reveal
// page carries its own, since it covers the table.
function renderCoach(v) {
  const el = clear($("coach"));
  if (!game.tut || v.phase === "reveal") { el.hidden = true; if (game.tut) game.tut.pending = null; return; }
  const key = coachKey(v);
  const on = !!key && !game.tut.seen[key];
  game.tut.pending = on ? key : null;
  el.hidden = !on;
  if (!on) return;
  el.append(coachSlip(key));
}
function coachSlip(key) {
  const i = COACH_ORDER.indexOf(key);
  return h("div", { class: "coach" },
    h("span", { class: "k" }, t("tutorial.guide")),
    h("div", { class: "b" },
      h("p", { html: t("tutorial.coach." + key, TUT_P()) }),
      h("div", { class: "f" },
        h("small", {}, t("tutorial.stepOf", { i: num(i + 1), n: num(COACH_ORDER.length) })),
        h("div", { class: "row", style: "gap:10px" },
          h("button", { type: "button", class: "linkish", onclick: () => { game.tut = null; render(); tick(); } }, t("tutorial.off")),
          btn(t("tutorial.ok"), "p sm", () => { game.tut.seen[key] = true; render(); tick(); })))));
}
function renderTutorial() {
  const box = clear($("tutSteps"));
  const sq = (el) => { el.classList.add("sq"); return el; };
  const pill = (key, cls = "") => h("span", { class: "pill " + cls }, t(key));
  const illos = [
    () => [h("img", { class: "tok", src: "art/gang_watch.jpg", alt: "" }), sq(tradeImg("bodyguard")), sq(itemImg("watch")), h("span", { class: "mini" }, t("reveal.yourGang") + " · " + t("reveal.yourTrade") + " · " + t("reveal.yourBag"))],
    () => [pill("table.trade"), pill("table.fight", "atk"), pill("table.declare", "brass"), pill("table.pass")],
    () => [sq(itemImg("monocle")), h("span", { class: "mini" }, "→"), faceEl(1), h("span", { class: "mini" }, t("itemText.monocle"))],
    () => [h("span", { class: "mini atk" }, t("table.swords") + " 3"), h("span", { class: "mini" }, "vs"), h("span", { class: "mini def" }, t("table.shields") + " 2"), sq(itemImg("dagger")), sq(itemImg("gloves"))],
    () => [sq(itemImg("watch")), sq(itemImg("watch")), h("span", { class: "mini" }, "＋"), faceEl(2), sq(itemImg("watch"))],
  ];
  const saved = game.faces;
  game.faces = TUT_FACES.slice();
  (S.tutorial.steps || []).forEach((step, i) => {
    box.append(h("div", { class: "tut-step" }, h("span", { class: "n lat" }, num(i + 1)),
      h("div", {}, h("b", {}, step.t), h("p", {}, step.d), h("div", { class: "illo" }, ...illos[i]()))));
  });
  game.faces = saved;
}
// The tutorial's own ending: what happened, what a real game adds, and a way on.
function tutorialOverCard(v) {
  const won = v.me && (typeof v.winner === "number" ? v.winner === game.me : v.me.gang === v.winner);
  store.set("lt.tutDone", "1");
  const list = (lab, lines) => h("div", { class: "card" }, h("span", { class: "lab" }, lab),
    h("div", { class: "tips" }, ...lines.map((x, i) => h("div", {}, h("b", {}, String(i + 1)), h("span", { html: x })))));
  return h("div", { class: "stack" },
    h("div", { class: "card dark ticket over" },
      h("img", { class: "medal", src: "art/gang_watch.jpg", alt: "" }),
      h("span", { class: "lab" }, t("tutorial.endTitle")),
      h("div", { class: "disp g watch" }, t(won ? "tutorial.endWin" : "tutorial.endLose")),
      h("span", { class: "hint" }, t(won ? "tutorial.endWinText" : "tutorial.endLoseText", TUT_P()))),
    list(t("tutorial.recapLab"), (S.tutorial.recap || []).map((x) => x.replace(/\{(\w+)\}/g, (_, k) => TUT_P()[k] ?? ""))),
    list(t("tutorial.tipsLab"), S.tutorial.tips || []),
    game.filmWait ? btn(t("table.gotIt"), "p", seenResult) : null,
    btn(t("tutorial.playReal"), "p", () => { setup.n = 6; store.set("lt.n", 6); game.tut = null; startGame(); }),
    h("div", { class: "grid2" },
      h("a", { class: "btn ghost", href: "rules" }, t("nav.rules")),
      btn(t("tutorial.again"), "ghost", () => startTutorial())));
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
    // everyone who loses is asked about the gold bar, everyone looked at about lying;
    // without the card there is only one answer
    if (f.step === "bribe" || f.step === "disguise") return legal.length === 1 ? legal[0] : null;
  }
  if (st.phase === "trade" && st.trade && st.trade.step === "disguise") return legal.length === 1 ? legal[0] : null;
  return null;
}
function delayFor(st) {
  if (st.phase === "reveal") return 225; // bots are ready at once; the wait is the player reading their card
  return WAIT[game.lastTier] ?? WAIT.silent;
}

// Bots act one at a time, on a timer, whenever the phase is waiting on them;
// the human's automatic answers go the same way, a beat later.
function tick() {
  clearTimeout(game.botTimer);
  render();
  const st = game.st;
  if (!st || st.phase === "over") return;
  if ((game.result || game.evCard) && !game.auto) return; // the carriage holds until the result, or the stop's event, is read
  if (game.tut && game.tut.pending) return; // and until the guide's slip is read
  if (game.hold) return; // and while the screen is turning over after a film
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
  const a = (game.tut && scriptedAction(seat, legal)) || B.decide(view, legal, game.level, game.rng);
  if (!a) { tick(); return; }
  const line = sayAction(a, view, { rng: game.rng, names: game.names, T: S.talk });
  if (line) addSay(seat, line);
  step(a);
}
function humanAct(a) {
  closeSheet();
  if (a.type === "choice" && !a.take) { const f = curView()?.scuffle; if (f) game.peekSeat = f.winner === f.attacker ? f.defender : f.attacker; }
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
  const before = game.st;
  try { game.st = E.apply(game.st, a); }
  catch (err) { console.error(err, a); tick(); return; }
  game.lastTier = moveTier(before, game.st);
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
    if (e.type === "scuffle" && !game.auto) game.result = e;
    if (e.type === "event" && e.id && !e.done && !game.auto) game.evCard = e;
    for (let s = 0; s < st.n; s++) {
      if (s === game.me && !game.auto) continue;
      const line = sayResult(e, s, { rng: game.rng, names: game.names, T: S.talk });
      if (line) addSay(s, line);
    }
  }
}

// ---------- log lines ----------
function addSay(seat, text) { game.log.push({ seat, text, entry: null }); noteSay(seat, text); renderLog(); }
// A line said at the table also shows over the speaker for a few seconds.
const SAY_MS = 4000;
function noteSay(seat, text) {
  if (seat === null || seat === undefined) return;
  const now = Date.now();
  game.says = game.says.filter((x) => now - x.at < SAY_MS && x.seat !== seat);
  game.says.push({ seat, text, at: now });
  clearTimeout(game.sayTimer);
  game.sayTimer = setTimeout(renderSays, SAY_MS + 50);
  renderSays();
}
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
      if (!m.sys) noteSay(m.seat, m.text);
      renderLog(); renderLobbyLog(); break;
    case "view": {
      if (!m.view) { game.view = null; game.legal = []; if (game.lobby) { show("lobby"); renderLobby(); } break; }
      if (m.gen !== game.gen) { game.gen = m.gen; game.log = game.log.filter((l) => l.room); game.logSeen = 0; game.ui = freshUi(); game.evCard = null; game.seenCount = null; game.filmOver = false; game.filmWait = null; resetJourney(); }
      const key = `${m.view.phase}/${m.view.scuffle?.step || m.view.trade?.step || ""}/${m.view.turnNo}/${(m.view.waitingOn || []).join(",")}/${m.view.log.length}`;
      if (key !== game.viewKey) { game.viewKey = key; game.ui = freshUi(); }
      game.view = m.view; game.legal = m.legal || []; game.names = m.names; game.faces = m.faces || []; game.me = m.me; game.deadline = m.deadline || 0;
      // the engine's public log becomes lines here, in this tab's language
      for (; game.logSeen < m.view.log.length; game.logSeen++) {
        const e = m.view.log[game.logSeen];
        game.log.push({ seat: null, text: describe(e), hot: e.type === "scuffle" || e.type === "declare" || e.type === "solo" });
        if (e.type === "scuffle") game.result = e;
        if (e.type === "event" && e.id && !e.done) game.evCard = e;
      }
      show("table"); render(); startClock(); netAuto();
      break;
    }
    case "error":
      if (m.fatal) { leaveRoom(true); game.mode = "solo"; show("landing"); setStatus(m.key ? t("lobby.err." + m.key) : m.message, true); }
      else if (game.view && !$("view-table").hidden) { addSys(m.key ? t("lobby.err." + m.key) : m.message, true); render(); }
      else setStatus(m.key ? t("lobby.err." + m.key) : m.message, true);
      break;
  }
}
// The same courtesy the solo driver extends: answer for the human what cannot matter.
function netAuto() {
  clearTimeout(game.netTimer);
  const v = game.view;
  if (!v || game.me === null || !v.waitingOn.includes(game.me)) return;
  const fake = { phase: v.phase, scuffle: v.scuffle, trade: v.trade };
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
  $("lbDlc").checked = !!L.settings.dlc;
  dlcCards($("lbDlcCards"), !!L.settings.dlc);
  $("lbEv").checked = !!L.settings.events;
  eventCards($("lbEvCards"), !!L.settings.events);
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
$("lbDlc").addEventListener("change", (e) => send({ type: "settings", dlc: e.target.checked }));
$("lbEv").addEventListener("change", (e) => send({ type: "settings", events: e.target.checked }));
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
      if (e.dice) parts.push(L("dice", { name: nameOf(e.dice.seat), n: e.dice.roll }));
      if (e.doctored != null) { parts.push(L("doctored", { d: nameOf(e.doctored) })); return undefined; }
      parts.push(L("count", { swords: e.swords, shields: e.shields }));
      if (e.pharmacist != null) parts.push(L("pharm", { name: nameOf(e.pharmacist), w: nameOf(e.winner) }));
      if (e.tie) parts.push(L(e.drew ? "tie" : "drewNothing", { a: nameOf(e.attacker) }));
      else {
        const loser = e.winner === e.attacker ? e.defender : e.attacker;
        parts.push(L(e.choice === "bribe" ? "bribe" : e.yielded ? "yield" : e.choice === "take" ? "take" : "peek", { w: nameOf(e.winner), l: nameOf(loser) }));
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
    case "event": {
      const sep = lang === "en" ? ", " : "、";
      if (!e.id) return L("evNone");
      if (e.id === "dining") return L("evDining", { items: (e.kinds || []).map(itemName).join(sep) });
      if (e.id === "speaker") return L(e.cases ? "evSpeaker" : "evSpeakerNo", { w: e.watches, s: e.seals, c: e.cases });
      if (e.id === "customs") return e.done ? L("evCustoms", { n: e.shown || 0 }) : L("evCustomsStart");
      if (e.id === "password") {
        if (!e.done) return L("evPasswordStart");
        return e.seat != null ? L("evPasswordShow", { name: nameOf(e.seat), n: e.votes, item: itemName(e.kind) }) : L("evPasswordTie");
      }
      return L(e.id === "boiler" ? "evBoiler" : "evLights");
    }
    default: return "";
  }
}

// ---------- rendering ----------
let handPick = null; // { ids: Set, on: (id) => void, dim: bool }
// While a result waits to be confirmed, the table is drawn as the scuffle ended:
// glows, sides and the count stay put, and nothing else is offered.
function frozen(v, e) {
  const counted = e.swords != null;
  return { ...v, phase: "scuffle", scuffle: { step: counted ? "take" : "priest", attacker: e.attacker, defender: e.defender, support: e.support || {}, shown: e.shown || {},
    swords: e.swords, shields: e.shields, winner: e.winner, tie: !!e.tie, dice: e.dice || null, hypnotized: null, next: null } };
}
function render() {
  const live = curView();
  if (!live) return;
  if (live.phase === "over") {
    game.result = null; game.evCard = null;
    // how your journey ended, once
    if (!game.filmOver && game.me !== null && live.me) {
      game.filmOver = true;
      const won = typeof live.winner === "number" ? live.winner === game.me : live.me.gang === live.winner;
      // Solo, the journey ends where it started: the platform. A compartment
      // keeps the result on screen, since the others are still there, and so
      // does the tutorial, whose closing page is the point of it.
      const platform = game.mode === "solo" && !game.tut;
      const kind = won ? "win" : "lose";
      const then = platform ? () => { leaveRoom(true); go(""); } : null;
      const film = filmsOn() && !!FILMS[kind];
      if (film || then) game.filmWait = { kind: film ? kind : null, then };
    }
  }
  const v = game.result ? frozen(live, game.result) : live;
  const legal = curLegal();
  handPick = null;
  $("chatRow").hidden = game.mode !== "net";
  renderQuick(v);
  $("tableLeave").textContent = game.mode === "net" ? t("lobby.leave") : t("table.lobby");
  renderBar(v);
  renderCoach(v);
  renderPanel(v, legal);
  renderSeats(v, legal);
  renderHand(v);
  renderKnown(v);
  renderOverlay(v);
  // the answer to a peek: a private line, and the passenger's sheet with what was seen
  // a bag shown to you alone at a stop deserves a line of its own
  const seen = v.knowledge.filter((k) => k.k === "seen" && k.via === "customs");
  if (game.seenCount === null) game.seenCount = seen.length;
  else if (seen.length > game.seenCount) {
    for (const k of seen.slice(game.seenCount)) addSys(t("table.sawBag", { name: nameOf(k.seat), item: itemName(k.kind) }), true);
    game.seenCount = seen.length;
  }
  if (game.peekSeat != null) {
    const seat = game.peekSeat;
    const gang = (v.knowledge.filter((k) => k.k === "gang" && k.seat === seat).pop() || {}).gang;
    const trade = (v.knowledge.filter((k) => k.k === "trade" && k.seat === seat).pop() || {}).trade;
    if (gang) {
      game.peekSeat = null;
      addSys(t("table.peeked", { name: nameOf(seat), gang: gangName(gang), trade: trade ? tradeName(trade) : "?" }), true);
    }
  }
}
function renderBar(v) {
  const flags = [];
  if (v.stop && v.stop.boiler) flags.push(t("events.boiler"));
  if (v.stop && v.stop.lights) flags.push(t("events.lights"));
  const stop = v.phase === "reveal" ? "" : t("table.stop", { n: num(Math.max(1, Math.ceil(v.turnNo / v.n))) }) + (flags.length ? " · " + flags.join(" · ") : "");
  $("barLeft").textContent = game.tut ? `${t("tutorial.bar")} · ${stop}` : stop;
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
  if (v.phase === "event" && v.ev && v.ev.step === "vote") return legal.filter((a) => a.type === "vote").map((a) => a.target);
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
  if (v.phase === "event") return humanAct({ type: "vote", seat: game.me, target: seat });
  if (v.phase === "scuffle") return humanAct({ type: "hypnotize", seat: game.me, target: seat });
}
const RING_FACES = {};
function ringFace(seat) {
  const id = game.faces[seat] || "";
  const key = seat + ":" + id;
  if (!RING_FACES[key]) RING_FACES[key] = faceEl(seat, "");
  return RING_FACES[key];
}
function renderSeats(v, legal) {
  const box = $("seats");
  const targets = seatPickTargets(v, legal);
  const f = v.scuffle;
  const sig = JSON.stringify([lang, v.n, game.me, v.phase, v.turn, v.turnNo, v.winner, f && [f.step, f.attacker, f.defender, f.support, f.shown, f.swords, f.shields, f.winner, f.tie, f.hypnotized, f.dice], v.seats.map((sd) => [sd.items, sd.trade, sd.tradeUsed, sd.drink, sd.gang]), targets, game.faces, game.names]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  clear(box);
  box._pos = [];
  const counted = !!f && COUNTED.includes(f.step);
  const tally = (side) => 1 + Object.values(f.support).filter((x) => x === side).length;
  const sw = f ? (counted ? f.swords : tally("attacker")) : 0, sh = f ? (counted ? f.shields : tally("defender")) : 0;
  const n = v.n, me0 = game.me ?? 0;
  const CX = 173, CY = 148, R = 112;
  const size = n <= 6 ? [52, 64] : n <= 8 ? [46, 56] : [40, 48];
  box.append(h("div", { class: "table" }));
  // what the middle says
  const mid = h("div", { class: "mid" });
  if (f) mid.append(h("span", { class: "lab" }, t("sheet.vs", { a: nameOf(f.attacker), b: nameOf(f.defender) })),
    h("div", { class: "row", style: "gap:6px" }, h("span", { class: "atk" }, icon("sword", 18)), h("span", { class: "n atk lat" }, String(sw)), h("span", { class: "vs lat" }, "vs"), h("span", { class: "n def lat" }, String(sh)), h("span", { class: "def" }, icon("shield", 18))));
  else if (v.phase === "over") mid.append(h("span", { class: "lab" }, t("table.stop", { n: num(Math.max(1, Math.ceil(v.turnNo / v.n))) })), h("span", { class: "who" }, typeof v.winner === "number" ? t("over.soloWins", { name: nameOf(v.winner) }) : t("over.gangWins", { gang: gangName(v.winner) })));
  else if (v.phase !== "reveal") mid.append(h("span", { class: "lab" }, t("table.stop", { n: num(Math.max(1, Math.ceil(v.turnNo / v.n))) })), h("span", { class: "who" }, v.turn === game.me ? t("table.yourTurn") : t("table.turnOf", { name: nameOf(v.turn) })));
  box.append(mid);
  for (let s = 0; s < n; s++) {
    const sd = v.seats[s];
    const me = s === game.me;
    const pick = targets.includes(s);
    const k = (s - me0 + n) % n;
    const ang = Math.PI / 2 + (2 * Math.PI * k) / n;
    const x = CX + R * Math.cos(ang), y = CY + R * Math.sin(ang);
    let role = "", big = false, stat;
    if (f) {
      const won = counted && !f.tie && f.winner === s ? " · " + t("table.win") : "";
      if (s === f.attacker) { role = "a"; big = true; stat = h("span", { class: "stat atk" }, `${t("table.swords")} ${sw}${won}`); }
      else if (s === f.defender) { role = "d"; big = true; stat = h("span", { class: "stat def" }, `${t("table.shields")} ${sh}${won}`); }
      else if (f.support[s] === "attacker") { role = "a-sup"; stat = h("span", { class: "stat atk" }, t("table.backA")); }
      else if (f.support[s] === "defender") { role = "d-sup"; stat = h("span", { class: "stat def" }, t("table.backD")); }
      else if (f.support[s] === "out") { role = "out"; stat = h("span", { class: "stat" }, t(f.hypnotized === s ? "table.named" : "table.out")); }
      else stat = h("span", { class: "stat" }, "…");
    } else {
      if (v.turn === s && v.phase !== "over" && v.phase !== "reveal") { role = "turn"; big = true; }
      if (v.phase === "over" && sd.gang) stat = h("span", { class: "stat " + (sd.gang === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(sd.gang));
      else {
        stat = h("span", { class: "stat" }, t("table.bags", { n: sd.items }) + (sd.trade ? " · " + tradeName(sd.trade) + (sd.tradeUsed ? " ✓" : "") : ""));
        if (sd.drink) stat.append(icon("drink", 11));
      }
    }
    // what they showed in this scuffle, beside the face on the outer side
    const shown = f && f.shown[s] ? shownThumbs(f.shown[s], s, role, f.dice && f.dice.seat === s ? f.dice.roll : null) : null;
    const face = ringFace(s);
    face.style.width = face.style.height = (big ? size[1] : size[0]) + "px";
    const you = me ? (lang === "en" ? ` (${t("table.you")})` : `（${t("table.you")}）`) : "";
    const el = h("div", { class: "seat" + (me ? " me" : "") + (role ? " " + role : "") + (big ? " big" : "") + (pick ? " pick" : ""), style: `left:${x}px;top:${y}px` },
      h("button", { type: "button", class: "pp", onclick: pick ? () => onSeatPick(v, legal, s) : () => openPassengerSheet(v, s) }, face, shown && x <= CX ? shown : null, shown && x > CX ? shown : null),
      h("span", { class: "plate" }, nameOf(s) + you), stat);
    if (shown) shown.classList.add(x <= CX ? "l" : "r");
    box.append(el);
    box._pos[s] = { x, y, px: big ? size[1] : size[0] };
  }
  box._n = n;
  renderSays();
}

// Who is talking, drawn over the ring. Up to six seats the words themselves sit
// in a bubble by the speaker, leaning away from the middle of the table so the
// turn line stays readable, and never more than two at once. From seven seats
// the faces are too close for words: the speaker gets a small mark, and a tap on
// the mark opens the bubble. The line is in the carriage talk either way.
function renderSays() {
  const box = $("seats");
  if (!box || !box._pos) return;
  box.querySelectorAll(".say").forEach((el) => el.remove());
  const now = Date.now();
  game.says = game.says.filter((x) => now - x.at < SAY_MS);
  if (!game.says.length) { game.sayTip = null; return; }
  const W = 346, H = 336, CX = 173, few = box._n <= 6;
  const bubble = (x0, cls) => {
    const p = box._pos[x0.seat]; if (!p) return null;
    const el = h("div", { class: "say bub", "aria-hidden": "true" }, x0.text);
    el.style.animationDelay = -(now - x0.at) + "ms";
    if (p.y < 70) { el.classList.add("side"); el.style.left = (p.x + p.px / 2 + 8) + "px"; el.style.top = (p.y - 30 + 4) + "px"; }
    else {
      el.style.bottom = (H - (p.y - 30) + 8) + "px";
      if (p.x < CX - 20) { el.classList.add("lean-l"); el.style.right = (W - p.x - 26) + "px"; }
      else if (p.x > CX + 20) { el.classList.add("lean-r"); el.style.left = (p.x - 26) + "px"; }
      else { el.classList.add("mid"); el.style.left = p.x + "px"; }
    }
    if (cls) el.classList.add(cls);
    return el;
  };
  if (few) {
    for (const x0 of game.says.slice(-2)) { const el = bubble(x0); if (el) box.append(el); }
    return;
  }
  for (const x0 of game.says) {
    const p = box._pos[x0.seat]; if (!p) continue;
    const mark = h("button", { type: "button", class: "say mark", "aria-label": nameOf(x0.seat) + "：" + x0.text,
      onclick: (ev) => { ev.stopPropagation(); game.sayTip = game.sayTip === x0.seat ? null : x0.seat; renderSays(); } },
      h("i", {}), h("i", {}), h("i", {}));
    mark.style.left = (p.x + p.px / 2 - 12) + "px"; mark.style.top = (p.y - 30 - 6) + "px";
    mark.style.animationDelay = -(now - x0.at) + "ms";
    box.append(mark);
    if (game.sayTip === x0.seat) { const el = bubble(x0, "tip"); if (el) box.append(el); }
  }
}
// Thumbnails of what a passenger showed in the scuffle: red for an attack bonus,
// blue for a defence bonus, grey for anything else. Tapping one opens its text.
// The gambler's thumbnail also carries what the coin gave.
function shownThumbs(x, seat, role, roll = null) {
  const wrap = h("span", { class: "shown" });
  const sideCls = role === "a" || role === "a-sup" ? "atk" : role === "d" || role === "d-sup" ? "def" : "";
  const itemCls = (kind) => { const fx = (E.ITEM_BY_KIND[kind] || {}).fight || ""; return fx.includes("attack") ? "atk" : fx.includes("defend") ? "def" : ""; };
  const tradeCls = (tr) => tr === "thug" ? "atk" : tr === "master" ? "def" : tr === "bodyguard" || tr === "gambler" ? sideCls : "";
  for (const kind of x.items) wrap.append(h("button", { type: "button", class: "sh " + itemCls(kind), title: itemName(kind), onclick: (e) => { e.stopPropagation(); openItemSheet(kind); } }, itemImg(kind)));
  if (x.trade) wrap.append(h("button", { type: "button", class: "sh " + tradeCls(x.trade), title: tradeName(x.trade), onclick: (e) => { e.stopPropagation(); openTradeSheet(x.trade, seat); } },
    tradeImg(x.trade), roll != null && x.trade === "gambler" ? h("b", { class: "roll" }, "+" + roll) : null));
  return wrap;
}
// Everything this seat knows about another passenger's hand, replayed from the
// public log and the private facts in time order. Whenever an item leaves a
// hand unseen, that hand's list is dropped rather than guessed.
function whatIKnow(v, seat) {
  const known = {}; // id -> kind
  const ids = new Set();
  const facts = v.knowledge.filter((k) => ["hand", "got", "gave", "lost", "offered"].includes(k.k));
  const events = [...v.log.map((e) => ({ t: e.t, o: 0, log: e })), ...facts.map((k) => ({ t: k.at, o: 1, fact: k }))].sort((a, b) => a.t - b.t || a.o - b.o);
  const forget = () => { for (const id of Object.keys(known)) delete known[id]; };
  const involves = (e, s) => [e.from, e.to, e.seat, e.target, e.attacker, e.defender, e.winner].includes(s);
  for (const ev of events) {
    if (ev.log) {
      const e = ev.log;
      if (e.type === "trade" && e.accepted && (e.from === seat || e.to === seat) && e.from !== game.me && e.to !== game.me) forget();
      if (e.type === "demand" && e.had && (e.seat === seat || e.target === seat) && e.seat !== game.me && e.target !== game.me) forget();
      if (e.type === "scuffle" && e.choice === "take" && e.winner !== game.me) { const loser = e.winner === e.attacker ? e.defender : e.attacker; if (loser === seat && loser !== game.me) forget(); }
      if (e.type === "scuffle" && e.paid && e.attacker === seat && e.stopped !== game.me && e.attacker !== game.me) forget();
      // a paid gold bar is public, and there is only one
      if (e.type === "scuffle" && e.choice === "bribe") { const loser = e.winner === e.attacker ? e.defender : e.attacker; if (loser === seat) delete known.gold_bar; if (e.winner === seat) known.gold_bar = "gold_bar"; }
      if (e.type === "gift" && e.from === seat && e.to !== game.me && e.from !== game.me) forget();
      if (e.type === "timetable") forget();
    } else {
      const k = ev.fact;
      if (k.k === "hand" && k.seat === seat) { forget(); for (const it of k.items) known[it.id] = it.kind; }
      if (k.k === "got" && k.from === seat) delete known[k.id];
      if ((k.k === "gave" && k.to === seat) || (k.k === "lost" && k.to === seat) || (k.k === "offered" && k.from === seat)) known[k.id] = k.kind;
      if (k.k === "seen" && k.seat === seat) known[k.id] = k.kind; // shown at a stop
    }
    void ids;
  }
  return known;
}
function openPassengerSheet(v, seat) {
  const sd = v.seats[seat];
  const me = seat === game.me;
  const gangKnown = me ? v.me.gang : (v.phase === "over" && sd.gang) || (v.knowledge.filter((k) => k.k === "gang" && k.seat === seat).pop() || {}).gang || null;
  const tradeKnown = me ? v.me.trade : sd.trade || (v.knowledge.filter((k) => k.k === "trade" && k.seat === seat).pop() || {}).trade || null;
  const items = me ? Object.fromEntries(v.me.items.map((it) => [it.id, it.kind])) : (v.phase === "over" && sd.hand ? Object.fromEntries(sd.hand.map((it) => [it.id, it.kind])) : whatIKnow(v, seat));
  const kinds = Object.values(items).slice(0, sd.items);
  const unknown = Math.max(0, sd.items - kinds.length);
  const q = () => h("span", { class: "q lat" }, "?");
  const tradeDef = tradeKnown ? E.TRADE_BY_ID[tradeKnown] : null;
  openSheet(
    h("div", { class: "row", style: "gap:12px" }, faceEl(seat, "lg2"), h("div", { class: "stack", style: "gap:2px;flex:1;min-width:0" }, h("span", { class: "disp ttl" }, nameOf(seat)), h("span", { class: "hint" }, t("table.stop", { n: num(Math.max(1, Math.ceil(v.turnNo / v.n))) }) + " · " + t("sheet.bags", { n: sd.items }))),
      h("div", { class: "stack", style: "gap:4px;align-items:flex-end" }, h("span", { class: "hint" }, t("sheet.gang")),
        // the token says which gang it is faster than the name does
        ...(gangKnown
          ? [itemImg(E.GOAL[gangKnown], "thumb56 gangtok " + (gangKnown === E.TIMEKEEPERS ? "watch" : "seal")),
             h("span", { class: "tag " + (gangKnown === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(gangKnown))]
          : [q()]))),
    h("div", { class: "rule" }),
    h("span", { class: "hint" }, t("sheet.trade")),
    tradeKnown ? h("div", { class: "row", style: "gap:10px" }, h("button", { type: "button", class: "thumbbtn", onclick: () => openTradeSheet(tradeKnown, seat) }, tradeImg(tradeKnown, "thumb56")), h("div", { class: "stack", style: "gap:0" }, h("b", {}, tradeName(tradeKnown)), h("span", { class: "hint" }, t(tradeDef && tradeDef.once ? "reveal.once" : "reveal.always") + (sd.tradeUsed ? " · " + t("sheet.used") : "")))) : q(),
    h("div", { class: "row between" }, h("span", { class: "hint" }, t("sheet.bags", { n: sd.items })), h("span", { class: "hint" }, me ? "" : t("sheet.knownHint"))),
    h("div", { class: "row wrap", style: "gap:8px" }, ...kinds.map((kind) => h("button", { type: "button", class: "thumbbtn", onclick: () => openItemSheet(kind) }, itemImg(kind, "thumb56"))), ...Array.from({ length: unknown }, q)),
    h("div", { class: "rule" }),
    h("div", { class: "row between" }, h("span", { class: "hint" }, t("sheet.tapAny")), btn(t("sheet.close"), "ghost sm", closeSheet)));
}

// The quick lines under the talk: one tap sends them, so nobody has to type on a phone.
function renderQuick(v) {
  const box = clear($("quick"));
  box.hidden = game.mode !== "net" || !v.me;
  if (box.hidden) return;
  const gang = v.me.gang;
  for (const line of S.table.quick || []) {
    const text = line.replace("{gang}", gangName(gang)).replace("{goal}", itemName(E.GOAL[gang]));
    box.append(h("button", { type: "button", class: "chip", onclick: () => send({ type: "chat", text }) }, text));
  }
}

// ---------- pictures ----------
function faceEl(seat, cls = "") {
  const id = game.faces[seat] || game.lobby?.seats?.find((x) => x.idx === seat)?.face;
  if (id) return h("img", { class: "face " + cls, src: "art/face_" + id + ".jpg", alt: "" });
  return h("span", { class: "face init " + cls }, [...(nameOf(seat) || "?")][0]);
}
const itemImg = (kind, cls = "") => h("img", { class: cls, src: "art/item_" + kind + ".jpg", alt: "" });
const eventImg = (id, cls = "") => h("img", { class: cls, src: "art/event_" + (id || "none") + ".jpg", alt: "" });
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
  box.append(h("span", { class: "lab" }, t("table.yourBag", { n: mine.length, max: v.me.limit ?? v.handLimit }) + (handPick || !mine.length ? "" : " · " + t("table.tapHint"))));
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
  const lines = game.log.slice(-30);
  for (const l of lines) {
    if (l.seat === null) box.append(h("div", { class: "sys" + (l.hot ? " hot" : "") }, l.text));
    else box.append(h("div", { class: "msg" + (l.seat === game.me ? " me" : "") }, faceEl(l.seat, "xs"), h("div", { class: "bub" }, h("b", {}, nameOf(l.seat)), l.text)));
  }
  const last = lines[lines.length - 1];
  $("talkCount").textContent = folds.talk ? t("table.talkRecent", { n: lines.length }) : last ? (last.seat === null ? last.text : nameOf(last.seat) + "：" + last.text) : "";
  box.scrollTop = box.scrollHeight;
  renderJourney();
}
// Two folding panels; the choice is remembered per browser. Talk starts open in a compartment, closed solo.
const folds = { talk: null, log: store.get("lt.logOpen", "0") === "1" };
function applyFolds() {
  if (folds.talk === null) folds.talk = store.get("lt.talkOpen", "") === "" ? game.mode === "net" : store.get("lt.talkOpen") === "1";
  $("talk").classList.toggle("open", folds.talk); $("talkBody").hidden = !folds.talk;
  $("glog").classList.toggle("open", folds.log); $("glogBody").hidden = !folds.log;
}
$("talkHd").addEventListener("click", () => { folds.talk = !folds.talk; store.set("lt.talkOpen", folds.talk ? "1" : "0"); applyFolds(); renderLog(); });
$("glogHd").addEventListener("click", () => { folds.log = !folds.log; store.set("lt.logOpen", folds.log ? "1" : "0"); applyFolds(); renderJourney(); });
// The journey log: the engine's public record, grouped by stop, the actor's face on the left,
// the items involved as small pictures below.
const actorOf = (e) => e.first ?? e.seat ?? e.from ?? e.attacker ?? e.winner ?? null;

// ---------- the journey log ----------
// By stop, newest first, and a stop folds when its name is tapped. Every turn
// keeps its number. What this seat alone saw -- a hand it looked through, what
// it was handed, what was taken from it -- is slipped in under the turn it
// happened on, so the record reads the way the player lived it. Nobody else's
// log has those lines: they come from this seat's own knowledge list.
const journey = { tab: "log", seenDir: "of", filter: "all", person: null, picking: false, open: {} };
function resetJourney() { journey.tab = "log"; journey.seenDir = "of"; journey.filter = "all"; journey.person = null; journey.picking = false; journey.open = {}; }
const stopOf = (turn, n) => Math.max(1, Math.ceil(turn / n));
const LOCK_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7.5" width="9" height="6" rx="1"/><path d="M5.5 7.5V5.5a2.5 2.5 0 015 0v2"/></svg>';

// The thumbnails under a public entry: what was announced, shown or paid.
function entryTags(e) {
  const tags = [];
  if (e.type === "event" && e.kind) tags.push(thumb(e.kind, () => openItemSheet(e.kind)));
  for (const k of e.kinds || []) tags.push(thumb(k, () => openItemSheet(k)));
  for (const a of e.announced || []) tags.push(thumb(a.kind, () => openItemSheet(a.kind)));
  if (e.type !== "event" && e.kind) tags.push(thumb(e.kind, () => openItemSheet(e.kind)));
  if (e.choice === "bribe") tags.push(thumb("gold_bar", () => openItemSheet("gold_bar")));
  for (const [sid, x] of Object.entries(e.shown || {})) {
    const side = Number(sid) === e.attacker || e.support?.[sid] === "attacker" ? "atk" : Number(sid) === e.defender || e.support?.[sid] === "defender" ? "def" : "";
    for (const k of x.items || []) { const b = thumb(k, () => openItemSheet(k)); if (side) b.firstChild.classList.add(side); tags.push(b); }
    if (x.trade) tags.push(h("button", { type: "button", class: "thumbbtn", title: tradeName(x.trade), onclick: () => openTradeSheet(x.trade, Number(sid)) }, tradeImg(x.trade, "thumb " + side)));
  }
  return tags;
}

// What this seat alone learned, by turn. What the whole carriage was shown (a
// password, the dining car) is already in the public record, so it is not here.
function notesByTurn(v) {
  const by = {};
  const join = (items) => items.map((x) => itemName(x.kind)).join(lang === "en" ? ", " : "、");
  // an offer that was taken up is told as what you got, not twice
  const got = new Set(v.knowledge.filter((k) => k.k === "got").map((k) => k.at + ":" + k.id));
  for (const k of v.knowledge) {
    let line = null;
    const N = (key, p, kinds = [], seats = [], trade = null) => { line = { text: t("journey.note." + key, p), kinds, seats, trade }; };
    if (k.k === "gang") N("gang", { name: nameOf(k.seat), gang: gangName(k.gang) }, [], [k.seat]);
    else if (k.k === "trade") N("trade", { name: nameOf(k.seat), trade: tradeName(k.trade) }, [], [k.seat], { id: k.trade, seat: k.seat });
    else if (k.k === "hand") N(k.items.length ? "hand" : "handEmpty", { name: nameOf(k.seat), items: join(k.items) }, k.items.map((x) => x.kind), [k.seat]);
    else if (k.k === "got") N("got", { name: nameOf(k.from), item: itemName(k.kind) }, [k.kind], [k.from]);
    else if (k.k === "gave") N("gave", { name: nameOf(k.to), item: itemName(k.kind) }, [k.kind], [k.to]);
    else if (k.k === "lost") N("lost", { name: nameOf(k.to), item: itemName(k.kind) }, [k.kind], [k.to]);
    else if (k.k === "offered" && !got.has(k.at + ":" + k.id)) N("offered", { name: nameOf(k.from), item: itemName(k.kind) }, [k.kind], [k.from]);
    else if (k.k === "pile") N("pile", { items: join(k.items) }, k.items.map((x) => x.kind), []);
    if (line) (by[k.at] = by[k.at] || []).push(line);
  }
  return by;
}
const JOURNEY_KIND = { scuffle: "scuffle", trade: "trade", gift: "trade", demand: "trade", timetable: "trade", codebook: "trade", coat: "trade" };
function involves(e, s) {
  if ([e.first, e.seat, e.from, e.to, e.target, e.partner, e.attacker, e.defender, e.winner, e.stopped, e.doctored, e.pharmacist].includes(s)) return true;
  if (e.support && e.support[s] && e.support[s] !== "out") return true;
  return !!(e.shown && e.shown[s]);
}

// ---------- who has seen whom ----------
// Built only from what the whole carriage saw happen -- a scuffle's winner
// choosing to look, a monocle handed over, two passengers trading trades with a
// codebook, a trade shown in the open -- plus what this seat saw with its own
// eyes. Of anyone else's look you learn that it happened, never what they saw.
function seenLooks(v) {
  const looks = looksFromLog(v.log);
  // what this seat saw, word for word (and anything it learned that the log does not show)
  if (game.me !== null) for (const k of v.knowledge) {
    if (k.k !== "gang" && k.k !== "trade") continue;
    const key = game.me + "|" + k.seat + "|" + k.k, old = looks.get(key);
    if (!old || old.at <= k.at) looks.set(key, { by: game.me, of: k.seat, what: k.k, at: k.at, via: old && old.at === k.at ? old.via : "", value: k.k === "gang" ? gangName(k.gang) : tradeName(k.trade) });
  }
  for (const l of looks.values()) l.stale = isStale(l, v.log);
  return [...looks.values()];
}

function renderSeen(v, body) {
  const looks = seenLooks(v);
  const dir = journey.seenDir; // "of": who has seen this one; "by": whom this one has seen
  const seg = (key, label) => h("button", { type: "button", class: "jchip" + (dir === key ? " on" : ""), onclick: () => { journey.seenDir = key; renderJourney(); } }, label);
  body.append(h("div", { class: "jchips" }, seg("of", t("journey.seenOf")), seg("by", t("journey.seenBy"))));
  const me = game.me;
  const order = Array.from({ length: v.n }, (_, i) => ((me ?? 0) + i) % v.n);
  const nm = (s) => (s === me ? t("journey.you") : nameOf(s));
  const pill = (l) => {
    const other = dir === "of" ? l.by : l.of;
    const bits = [t("table.stop", { n: num(stopOf(l.at, v.n)) })];
    if (l.via === "monocle" || l.via === "codebook") bits.push(t("journey.via." + l.via));
    if (l.stale) bits.push(t("journey.stale"));
    return h("span", { class: "spill" + (l.by === me ? " you" : "") + (l.stale ? " old" : "") },
      faceEl(other, "xs"), h("span", {}, nm(other) + (l.value ? (lang === "en" ? ": " : "：") + l.value : "")), h("span", { class: "st" }, bits.join(" · ")));
  };
  const line = (label, pills) => h("div", { class: "sline" }, h("span", { class: "k" }, label),
    h("div", { class: "pills" }, ...(pills.length ? pills : [h("span", { class: "hint" }, t(dir === "of" ? "journey.nobody" : "journey.noOne"))])));
  for (const s of order) {
    const mine = looks.filter((l) => (dir === "of" ? l.of : l.by) === s).sort((a, b) => a.at - b.at);
    const gang = mine.filter((l) => l.what === "gang").map(pill);
    const trade = mine.filter((l) => l.what === "trade").map(pill);
    // a trade shown in the open: everyone has seen it
    const open = dir === "of" && (s === me ? v.me && v.me.tradeRevealed && v.me.trade : v.seats[s].trade);
    if (open) trade.push(h("span", { class: "spill pub" }, t("journey.public", { trade: tradeName(open) })));
    body.append(h("div", { class: "srow" + (mine.some((l) => l.by === me && me !== null && dir === "of") ? " mine" : "") },
      faceEl(s, "sm"), h("div", { class: "sbody" }, h("span", { class: "who" }, s === me ? nameOf(s) + (lang === "en" ? ` (${t("table.you")})` : `（${t("table.you")}）`) : nameOf(s)),
        line(t("journey.gangK"), gang), line(t("journey.tradeK"), trade))));
  }
  body.append(h("p", { class: "hint jempty" }, t("journey.seenHint")));
}

function renderJourney() {
  const v = curView(); if (!v) return;
  applyFolds();
  const events = v.log;
  const notes = game.me === null ? {} : notesByTurn(v);
  const noteCount = Object.values(notes).reduce((a, b) => a + b.length, 0);
  const played = (list) => new Set(list.filter((e) => e.type !== "event" && e.type !== "start").map((e) => e.t)).size;
  const lastText = events.length ? describe(events[events.length - 1]) : "";
  const turnsText = (n) => t(n === 1 ? "journey.turn1" : "journey.turns", { n });
  const notesText = (n) => (n ? t(n === 1 ? "journey.note1" : "journey.notes", { n }) : t("journey.noNotes"));
  $("glogPreview").textContent = folds.log ? turnsText(played(events)) + (game.me === null ? "" : " · " + notesText(noteCount)) : lastText;
  // the list is rebuilt on every move the carriage makes: keep the reader's place
  const keepY = $("glogBody").scrollTop;
  const body = clear($("glogBody"));
  if (!folds.log) return;
  const tab = (key, label) => h("button", { type: "button", role: "tab", "aria-selected": journey.tab === key ? "true" : "false", class: "jtab" + (journey.tab === key ? " on" : ""),
    onclick: () => { journey.tab = key; renderJourney(); } }, label);
  body.append(h("div", { class: "jtabs", role: "tablist" }, tab("log", t("journey.tabLog")), tab("seen", t("journey.tabSeen"))));
  if (journey.tab === "seen") { renderSeen(v, body); body.scrollTop = keepY; return; }
  const F = journey.filter, who = journey.person;

  // the filters
  const chip = (key, label, cls = "") => h("button", { type: "button", class: "jchip " + cls + (F === key ? " on" : ""),
    onclick: () => {
      // "about…" opens the row of faces; tapped again while it is filtering, it lets go
      if (key !== "person") { journey.filter = key; journey.picking = false; }
      else if (F === "person") { journey.filter = "all"; journey.person = null; journey.picking = false; }
      else journey.picking = !journey.picking;
      renderJourney();
    } }, label);
  const chips = h("div", { class: "jchips" }, chip("all", t("journey.all")), chip("scuffle", t("journey.scuffle")), chip("trade", t("journey.trade")));
  if (game.me !== null) chips.append(chip("notes", t("journey.mine"), "note"));
  chips.append(chip("person", who === null || F !== "person" ? t("journey.about") : t("journey.aboutName", { name: nameOf(who) })));
  body.append(chips);
  if (journey.picking) {
    const row = h("div", { class: "jfaces" });
    for (let s = 0; s < v.n; s++) {
      if (s === game.me) continue;
      row.append(h("button", { type: "button", class: who === s && F === "person" ? "on" : "", title: nameOf(s),
        onclick: () => { journey.person = s; journey.filter = "person"; journey.picking = false; renderJourney(); } }, faceEl(s, "xs"), h("span", {}, nameOf(s))));
    }
    body.append(row);
  }

  // every turn that has something to say, oldest first, bucketed by stop
  const turns = [...new Set([...events.map((e) => e.t), ...Object.keys(notes).map(Number)])].sort((a, b) => a - b);
  const latest = stopOf(turns.length ? turns[turns.length - 1] : 1, v.n);
  const stops = new Map();
  for (const T of turns) {
    const st = stopOf(T, v.n);
    if (!stops.has(st)) stops.set(st, { event: undefined, turns: [] });
    const mine = events.filter((e) => e.t === T);
    const ev = mine.find((e) => e.type === "event" && !e.done);
    if (ev) stops.get(st).event = ev;
    stops.get(st).turns.push({ T, entries: mine, notes: notes[T] || [] });
  }

  let shown = 0;
  for (const st of [...stops.keys()].sort((a, b) => b - a)) {
    const S = stops.get(st);
    const rows = [];
    for (const { T, entries, notes: ns } of S.turns) {
      let es = entries, keep = ns;
      if (F === "scuffle" || F === "trade") { es = entries.filter((e) => JOURNEY_KIND[e.type] === F); keep = es.length ? ns : []; }
      else if (F === "notes") { if (!ns.length) es = []; else es = entries.filter((e) => e.type !== "event"); }
      else if (F === "person") { es = entries.filter((e) => involves(e, who)); keep = ns.filter((n) => n.seats.includes(who)); }
      let numbered = false;
      for (const e of es) {
        const isEvent = e.type === "event";
        const actor = isEvent ? null : actorOf(e);
        const tags = entryTags(e);
        const hot = e.type === "scuffle" || e.type === "declare" || e.type === "solo" || (isEvent && e.id);
        rows.push(h("div", { class: "jturn" + (hot ? " hot" : "") },
          h("span", { class: "no lat" }, isEvent || e.type === "start" || numbered ? "" : String(T)),
          isEvent ? eventImg(e.id, "thumb ev") : actor != null ? faceEl(actor, "xs") : h("span", {}),
          h("div", {}, describe(e), tags.length ? h("div", { class: "tags" }, ...tags) : null)));
        if (!isEvent && e.type !== "start") numbered = true;
      }
      if (keep.length) {
        rows.push(h("div", { class: "jnote" }, h("span", { class: "lk", html: LOCK_SVG + "<span>" + t("journey.onlyYou") + "</span>" }),
          ...keep.map((n) => h("div", { class: "ln" }, h("span", {}, n.text),
            n.kinds.length || n.trade ? h("div", { class: "tags" },
              ...n.kinds.map((k) => thumb(k, () => openItemSheet(k))),
              n.trade ? h("button", { type: "button", class: "thumbbtn", title: tradeName(n.trade.id), onclick: () => openTradeSheet(n.trade.id, n.trade.seat) }, tradeImg(n.trade.id, "thumb")) : null) : null))));
      }
    }
    if (!rows.length) continue;
    shown++;
    // a stop stays shut unless it is the one the train is at, or a filter found something in it
    const open = journey.open[st] ?? (F === "all" ? st === latest : true);
    const nTurns = played(S.turns.flatMap((x) => x.entries)), nNotes = S.turns.reduce((a, x) => a + x.notes.length, 0);
    const sum = (st === latest && v.phase !== "over" ? t("journey.now") + " · " : "") + turnsText(nTurns) + " · " + notesText(nNotes);
    body.append(h("div", { class: "jstop" + (open ? " open" : "") + (st === latest ? " now" : "") },
      h("button", { type: "button", class: "jhead", "aria-expanded": open ? "true" : "false", onclick: () => { journey.open[st] = !open; renderJourney(); } },
        h("span", { class: "name" }, t("table.stop", { n: num(st) })),
        S.event !== undefined ? h("span", { class: "tag" + (S.event.id ? " turn" : "") }, S.event.id ? t("events." + S.event.id) : t("journey.none")) : null,
        h("span", { class: "sum" }, game.me === null ? turnsText(nTurns) : sum)),
      open ? h("div", { class: "jbody" }, ...rows) : null));
  }
  if (!shown) body.append(h("p", { class: "hint jempty" }, t(events.length ? "journey.empty" : "journey.nothing")));
  body.scrollTop = keepY;
}

// ---------- the panel ----------
const btn = (label, cls, onclick, disabled = false) => h("button", { type: "button", class: "btn " + (cls || ""), onclick, disabled }, label);
function waiting(v) {
  const who = v.waitingOn.filter((s) => s !== game.me);
  if (!who.length) return null;
  return h("p", { class: "hint" }, who.length === 1 ? t("table.waitingOne", { name: nameOf(who[0]) }) : t("table.waiting", { names: nameList(who) }));
}
const itemCard = (it, big = false) => pic(it.kind, { cls: big ? " big" : "", onclick: () => openItemSheet(it.kind) });
// Scuffle steps whose count is settled, so the table shows it.
const COUNTED = ["doctor", "bribe", "choice", "disguise", "take", "yield"];

// The expansion's four cards, under its switch while it is on.
const DLC_CARDS = [["item", "gold_bar"], ["trade", "double"], ["trade", "porter"], ["trade", "gambler"]];
function dlcCards(box, on) {
  clear(box);
  box.hidden = !on;
  if (!on) return;
  for (const [what, id] of DLC_CARDS) {
    box.append(h("button", { type: "button", class: "dlccard", onclick: () => (what === "item" ? openItemSheet(id) : openTradeSheet(id)) },
      what === "item" ? itemImg(id) : tradeImg(id), h("span", {}, what === "item" ? itemName(id) : tradeName(id))));
  }
}
// The six station events, under their switch while it is on; the deck is
// those six and six blanks, which the line underneath says.
function eventCards(box, on) {
  clear(box);
  box.hidden = !on;
  if (!on) return;
  for (const id of E.EVENTS) {
    box.append(h("button", { type: "button", class: "dlccard", onclick: () => openEventSheet(id) },
      eventImg(id), h("span", {}, t("events." + id))));
  }
  box.append(h("p", { class: "hint deckline" }, t("events.deck")));
}
function openEventSheet(id) {
  openSheet(
    h("div", { class: "row", style: "gap:14px;align-items:flex-start" }, eventImg(id, "art"),
      h("div", { class: "stack", style: "gap:4px;flex:1;min-width:0" },
        h("div", { class: "row between" }, h("span", { class: "disp ttl" }, t("events." + id)), h("span", { class: "tag" }, t("events.inDeck"))),
        h("p", { class: "small" }, t("eventText." + id)))),
    h("div", { class: "rule" }),
    h("div", { class: "row between" }, h("span", { class: "hint" }, t("events.deck")), btn(t("sheet.close"), "ghost sm", closeSheet)));
}

// The double agent's moment: what the one looking gets to see. Only the
// double agent is offered the lie; everyone else is answered for.
function disguiseChoices(v, legal) {
  const gang = v.me.gang, other = E.other(gang);
  const truth = legal.find((a) => !a.lie), lie = legal.find((a) => a.lie);
  const choice = (g, label, hint, cls, act) => h("button", { type: "button", class: "gangpick " + cls, onclick: () => humanAct(act) },
    h("img", { src: "art/gang_" + E.GOAL[g] + ".jpg", alt: "" }), h("span", { class: "stack", style: "gap:0" }, h("b", {}, label), h("span", { class: "hint" }, hint)));
  return h("div", { class: "stack" },
    choice(gang, t("table.truth"), gangName(gang), "", truth),
    lie ? choice(other, t("table.lie", { gang: gangName(other) }), t("table.disguiseHint"), "brass", lie) : null);
}
function renderPanel(v, legal) {
  const box = clear($("panel"));
  const p = h("div", { class: "panel" });
  box.append(p);
  const ui = game.ui;
  const me = game.me;
  const mineOnTurn = v.phase === "turn" && v.turn === me;
  if (game.result) { p.append(resultCard(v, game.result)); return; }
  if (game.evCard) { p.append(eventCard(game.evCard)); return; }

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

  if (v.phase === "event" && v.ev) {
    const ev = v.ev;
    const mineNow = v.waitingOn.includes(me);
    const card = h("div", { class: "card hot" });
    if (ev.step === "customs") {
      card.append(h("div", { class: "title disp" }, h("span", {}, t("events.customs")), h("span", { class: "hint" }, t("table.together"))));
      if (mineNow) {
        handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => { ui.item = id; render(); } };
        card.append(h("p", { class: "small" }, t("table.customsQ", { name: nameOf((me + 1) % v.n) })));
        card.append(btn(ui.item ? t("table.customsGo", { item: itemName(kindOf(v, ui.item)) }) : t("table.bagPick"), "p", () => humanAct({ type: "customsPick", seat: me, item: ui.item }), !ui.item));
      }
    } else if (ev.step === "vote") {
      const done = Object.values(ev.votes || {}).filter(Boolean).length;
      card.append(h("div", { class: "title disp" }, h("span", {}, t("events.password")), h("span", { class: "hint" }, t("table.together"))));
      card.append(h("p", { class: "small" }, t("table.voteQ")));
      card.append(h("p", { class: "hint" }, t("table.voteCount", { n: done, max: v.n })));
    } else if (ev.step === "showBag") {
      card.append(h("div", { class: "title disp" }, t("events.password")));
      if (mineNow) {
        handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => { ui.item = id; render(); } };
        card.append(h("p", { class: "small" }, t("table.showBagQ")));
        card.append(btn(ui.item ? t("table.showBagGo", { item: itemName(kindOf(v, ui.item)) }) : t("table.bagPick"), "p", () => humanAct({ type: "showBag", seat: me, item: ui.item }), !ui.item));
      } else card.append(h("p", { class: "small" }, t("table.showBagWait", { name: nameOf(ev.shower) })));
    }
    const still = waiting(v);
    if (still) card.append(still);
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
    } else if (tr.step === "disguise" && tr.actor === me) {
      card.append(h("div", { class: "title disp" }, t("table.disguiseTrade", { name: nameOf(tr.looker) })), disguiseChoices(v, legal));
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
  const counted = COUNTED.includes(f.step);
  const tally = (side) => 1 + Object.values(f.support).filter((x) => x === side).length;
  const sw = counted ? f.swords : tally("attacker"), sh = counted ? f.shields : tally("defender");
  const title = counted && f.tie ? t("table.tie", { name: nameOf(f.attacker) }) : counted && f.winner != null ? t("table.won", { name: nameOf(f.winner) })
    : f.defender === me ? t("table.attackOnYou", { a: nameOf(f.attacker) }) : f.attacker === me ? t("table.youAttack", { b: nameOf(f.defender) }) : t("table.attackOn", { a: nameOf(f.attacker), b: nameOf(f.defender) });
  card.append(h("div", { class: "title disp" }, h("span", {}, title)));
  const iAct = v.waitingOn.includes(me);
  if (!iAct) {
    if (f.step === "yield" && f.winner === me) card.append(h("p", { class: "small" }, t("table.yieldWait", { name: nameOf(f.winner === f.attacker ? f.defender : f.attacker) })));
    card.append(waiting(v));
    return card;
  }

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
        card.append(h("label", { class: "opt" }, h("input", { type: "checkbox", checked: ui.showTrade, onchange: (e) => { ui.showTrade = e.target.checked; render(); } }), t("table.useTrade", { trade: tradeName(v.me.trade) }), h("span", { class: "hint" }, t("tradeText." + v.me.trade))));
        if (v.me.trade === "pharmacist" && ui.showTrade) {
          card.append(h("p", { class: "hint" }, t("table.pharmWinner")));
          card.append(h("div", { class: "grid2" }, ...[f.attacker, f.defender].map((s) => h("button", { type: "button", class: "pill" + (ui.winner === s ? " on" : ""), onclick: () => { ui.winner = s; render(); } }, nameOf(s)))));
        }
      }
      const needWinner = ui.showTrade && v.me.trade === "pharmacist" && ui.winner == null;
      card.append(btn(usable.length || tradeOpt ? t("table.count") : t("table.showNothing"), "p", () => humanAct({ type: "show", seat: me, items: [...ui.showItems], trade: ui.showTrade, winner: ui.winner }), needWinner));
      break;
    }
    case "bribe": {
      const pay = legal.find((a) => a.pay), keep = legal.find((a) => !a.pay);
      card.append(h("p", {}, t("table.bribeQ")));
      card.append(h("div", { class: "row", style: "align-items:flex-start;gap:12px" }, pic("gold_bar", { cls: " pick", onclick: () => openItemSheet("gold_bar") }), h("p", { class: "hint", style: "flex:1" }, t("table.bribeHint", { w: nameOf(f.winner) }))));
      card.append(h("div", { class: "grid2" }, btn(t("table.bribeNo"), "ghost", () => humanAct(keep)), btn(t("table.bribeYes"), "p", () => humanAct(pay), !pay)));
      break;
    }
    case "disguise":
      card.append(h("p", {}, t("table.disguiseScuffle", { name: nameOf(f.winner) })), disguiseChoices(v, legal));
      break;
    case "yield":
      handPick = { ids: new Set(legal.map((a) => a.item)), on: (id) => { ui.item = id; render(); } };
      card.append(h("p", {}, t("table.yieldQ", { name: nameOf(f.winner) })), h("p", { class: "hint" }, t("table.yieldHint")));
      card.append(btn(ui.item ? t("table.yieldGo", { item: itemName(kindOf(v, ui.item)) }) : t("table.yieldPick"), "p", () => humanAct({ type: "yieldItem", seat: me, item: ui.item }), !ui.item));
      break;
    case "choice": {
      const loser = f.winner === f.attacker ? f.defender : f.attacker;
      const take = legal.find((a) => a.take);
      card.append(h("p", {}, t("table.choiceQ")));
      const picks = h("div", { class: "stack" }, btn(t("table.peekChoice", { name: nameOf(loser) }), take ? "" : "p", () => humanAct({ type: "choice", seat: me, take: false })));
      // With the lights out there is nothing to offer but the look.
      if (take) picks.append(btn(t("table.takeChoice", { name: nameOf(loser) }), "p", () => humanAct({ type: "choice", seat: me, take: true })));
      card.append(picks);
      if (!take && v.stop && v.stop.lights) card.append(h("p", { class: "hint" }, t("table.lightsOnly")));
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

// What the last scuffle came to, from the attacker's side, until the player says they saw it.
function resultCard(v, e) {
  const card = h("div", { class: "card fight stack" });
  const a = e.attacker, d = e.defender, loser = e.winner === a ? d : a;
  let title, lines = [];
  if (e.stopped != null) { title = t("table.res.stopped"); lines.push(t("table.res.stoppedBy", { p: nameOf(e.stopped) })); }
  else if (e.doctored != null) { title = t("table.res.doctored"); lines.push(t("table.res.doctoredBy", { d: nameOf(e.doctored) })); }
  else if (e.tie) { title = t("table.res.tie"); lines.push(e.drew ? t("table.res.drew", { a: nameOf(a) }) : t("log.drewNothing")); }
  else {
    title = t(e.winner === a ? "table.res.won" : "table.res.lost", { a: nameOf(a) });
    lines.push(t(e.choice === "bribe" ? "table.res.bribe" : e.yielded ? "table.res.yield" : e.choice === "take" ? "table.res.take" : "table.res.peek", { w: nameOf(e.winner), l: nameOf(loser) }));
    if (e.winner === game.me && e.choice !== "take") {
      const gang = (v.knowledge.filter((k) => k.k === "gang" && k.seat === loser).pop() || {}).gang;
      const trade = (v.knowledge.filter((k) => k.k === "trade" && k.seat === loser).pop() || {}).trade;
      if (gang) lines.push(t("table.res.seen", { gang: gangName(gang), trade: trade ? tradeName(trade) : "?" }));
    }
    if (loser === game.me && e.choice === "take") {
      const lost = v.knowledge.filter((k) => k.k === "lost" && k.at === e.t).pop();
      if (lost) lines.push(t("table.res.taken", { item: itemName(lost.kind) }));
    }
  }
  if (e.dice && e.stopped == null) lines.unshift(t("table.res.dice", { name: nameOf(e.dice.seat), n: e.dice.roll }));
  const count = e.stopped == null && e.doctored == null ? h("span", { class: "hint nowrap" }, t("log.count", { swords: e.swords, shields: e.shields }).replace(/[。.]$/, "")) : null;
  card.append(h("div", { class: "title disp" }, h("span", {}, title), count));
  for (const l of lines) card.append(h("p", { class: "small" }, l));
  card.append(btn(t("table.gotIt"), "p", () => { game.result = null; game.lastTier = "read"; if (game.mode === "solo") tick(); else { render(); netAuto(); } }));
  return card;
}

// The card a stop opens with. The carriage waits until it has been read.
function eventCard(e) {
  const line = e.id === "dining" ? t("events.diningSaw", { items: (e.kinds || []).map(itemName).join(lang === "en" ? ", " : "、") })
    : e.id === "speaker" ? t(e.cases ? "events.speakerSays" : "events.speakerSaysNo", { w: e.watches, s: e.seals, c: e.cases })
    : t("eventText." + e.id);
  return h("div", { class: "card stopcard" }, // not "ev": that is the journey log's row
    eventImg(e.id, "evart"),
    h("span", { class: "lab" }, t("table.stop", { n: num(e.stop) }) + " · " + t("events.head")),
    h("div", { class: "disp g2" }, t("events." + e.id)),
    h("p", { class: "small" }, line),
    btn(t("table.gotIt"), "p", () => { game.evCard = null; game.lastTier = "read"; if (game.mode === "solo") tick(); else { render(); netAuto(); } }));
}

// The player has read the result: now the film may start.
function seenResult() {
  const w = game.filmWait;
  if (!w) return;
  game.filmWait = null; // the card stays as it is behind the closing black
  playFilmFromBlack(w.kind, w.then);
}
function overCard(v) {
  if (game.tut) return tutorialOverCard(v);
  const wrap = h("div", { class: "stack" });
  const soloWin = typeof v.winner === "number";
  const head = h("div", { class: "card dark ticket over" });
  if (soloWin) head.append(itemImg("first_class_ticket", "medal"), h("div", { class: "disp g" }, t("over.soloWins", { name: nameOf(v.winner) })), h("span", { class: "hint" }, t("over.solo")));
  else {
    const by = v.event && v.event.by != null ? nameOf(v.event.by) : "";
    head.append(h("img", { class: "medal", src: "art/gang_" + E.GOAL[v.winner] + ".jpg", alt: "" }), h("div", { class: "disp g " + (v.winner === E.TIMEKEEPERS ? "watch" : "seal") }, t("over.gangWins", { gang: gangName(v.winner) })), h("span", { class: "hint" }, t(v.reason === "declared" ? "over.declared" : "over.wrong", { name: by })));
  }
  if (game.me !== null && v.me) {
    const won = soloWin ? v.winner === game.me : v.me.gang === v.winner;
    head.append(h("div", { class: "you " + (won ? "won" : "lost") }, t(won ? "over.youWin" : "over.youLose")));
  }
  wrap.append(head);
  const table = h("table", {}, h("tr", {}, h("th", {}, t("over.passengers")), h("th", {}, t("over.gangCol")), h("th", {}, t("over.tradeCol")), h("th", {}, t("over.bagsCol"))));
  for (let s = 0; s < v.n; s++) {
    const sd = v.seats[s];
    table.append(h("tr", {}, h("td", { class: "nowrap" }, h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, faceEl(s, "xs"), h("span", {}, nameOf(s) + (s === game.me ? ` (${t("table.you")})` : "")))), h("td", { class: "nowrap " + (sd.gang === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(sd.gang)), h("td", {}, h("button", { type: "button", class: "linkish plain", onclick: () => openTradeSheet(sd.trade, s) }, tradeName(sd.trade))), h("td", { class: "icons" }, h("div", { class: "row" }, ...sd.hand.map((x) => thumb(x.kind, () => openItemSheet(x.kind)))))));
  }
  wrap.append(h("div", { class: "card" }, table));
  if (game.filmWait) wrap.append(btn(t("table.gotIt"), "p", seenResult));
  else if (game.mode === "solo") wrap.append(btn(t("table.again"), "p", () => startGame()));
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
  ov.append(h("header", { class: "top" },
    h("a", { href: ".", class: "brand disp", onclick: (e) => { e.preventDefault(); leaveRoom(); go(""); } }, t("title")),
    h("nav", {}, h("a", { href: "rules" }, t("nav.rules")), h("button", { type: "button", class: "linkish", onclick: () => setLang(lang === "en" ? "zh-Hant" : "en") }, t("nav.lang")))));
  ov.append(h("main", { class: "scr" },
    game.tut && !game.tut.seen.reveal ? coachSlip("reveal") : null,
    h("div", { class: "card dark gangcard" }, h("img", { src: "art/gang_" + E.GOAL[gang] + ".jpg", alt: "" }),
      h("div", { class: "cap" }, h("span", { class: "lab" }, t("reveal.yourGang")), h("div", { class: "disp g " + (gang === E.TIMEKEEPERS ? "watch" : "seal") }, gangName(gang)),
        h("span", { class: "lat sub2" }, t("gang." + gang + "Lat") + " · " + t("goal." + gang)),
        h("p", { class: "small" }, t("reveal.goalText", { goal: t("goal." + gang), other: gangName(other), otherGoal: t("goal." + other) })))),
    rowCard(tradeImg(me.trade, "art sm"), h("span", { class: "lab" }, t("reveal.yourTrade")), h("div", { class: "row between" }, h("span", { class: "disp", style: "font-size:22px" }, tradeName(me.trade)), h("span", { class: "tag" }, t(tr.once ? "reveal.once" : "reveal.always"))), h("p", { class: "small" }, t("tradeText." + me.trade))),
    ...me.items.map((it, i) => rowCard(itemImg(it.kind, "art sm"), i === 0 ? h("span", { class: "lab" }, t("reveal.yourBag")) : null, h("span", { class: "disp", style: "font-size:20px" }, itemName(it.kind)), h("p", { class: "small" }, t("itemText." + it.kind)))),
    me.drink ? h("p", { class: "hint" }, t("reveal.drink")) : null,
    h("div", { class: "spacer" }),
    // Solo: the train pulls out, then the game starts. In a compartment the
    // others are waiting, so the seat is readied first and the film plays over it.
    btn(t("reveal.ready"), "p", () => {
      if (game.mode === "net") { humanAct({ type: "ready", seat: game.me }); playFilm("board"); }
      else playFilm("board", () => humanAct({ type: "ready", seat: game.me }));
    })));
}

const kindOf = (v, id) => (v.me.items.find((x) => x.id === id) || {}).kind || id.replace(/\d+$/, "");

// ---------- routing ----------
const views = ["landing", "tutorial", "setup", "lobby", "table"];
function show(name) { closeSheet(); for (const v of views) $("view-" + v).hidden = v !== name; if (name !== "table") $("overlay").hidden = true; }
function go(q) { history.pushState(null, "", location.pathname + q); route(); }
function route() {
  const q = new URLSearchParams(location.search);
  const code = (q.get("room") || "").toUpperCase();
  $("landStatus").textContent = ""; $("landStatus").classList.remove("err");
  $("landName").value = setup.name;
  if (q.get("play") === "tutorial") {
    leaveRoom(true); game.mode = "solo";
    if (game.tut && game.st && game.st.phase !== "over") { show("table"); render(); } else startTutorial();
    return;
  }
  if (q.has("tutorial")) {
    leaveRoom(true); game.mode = "solo"; game.st = null; game.view = null;
    renderTutorial(); show("tutorial");
    return;
  }
  if (q.has("play")) {
    leaveRoom(true); game.mode = "solo";
    game.auto = q.get("auto") === "1";
    if (game.auto && q.get("fast") === "1") for (const k of Object.keys(WAIT)) WAIT[k] = 40; // a self-playing game at speed, for checking screens
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
