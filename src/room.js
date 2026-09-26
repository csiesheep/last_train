// One Durable Object per compartment, named by its four-letter code. It is
// the authority on the game: it deals the cards, applies every action through
// the engine, runs the bot seats, keeps the step clock, and, the one rule that
// keeps gangs secret, sends each socket only `view(state, seat)` plus that
// seat's legal actions, never the state.
//
// Connections use the WebSocket Hibernation API, so an idle room costs
// nothing between messages. Everything needed to resume is in storage under
// "room"; all timers are the object's single alarm.
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { sayAction, sayResult } from "../public/shared/talk.js";
import en from "../public/i18n/en.js";
import zh from "../public/i18n/zh-Hant.js";
import { isFace, passengerName, freeFaces } from "../public/shared/passengers.js";
import { DWELL, moveTier, louder } from "../public/shared/pace.js";
import { VERSION } from "../public/shared/version.js";
import { cleanAction } from "../public/shared/record.js";

const LANGS = { en, "zh-Hant": zh };
// How long a step waits for a human before the table decides for them.
const STEP_MS = {
  reveal: 45_000, turn: 60_000, peek: 30_000, handLimit: 30_000,
  answer: 30_000, return: 20_000, codebook: 20_000, coat: 20_000, direction: 20_000, passItems: 20_000,
  priest: 15_000, gunman: 15_000, doctor: 15_000, priestPay: 20_000, support: 15_000, hypnotist: 15_000, powers: 20_000, choice: 20_000, take: 20_000, giveBack: 20_000,
};
// Steps everyone answers at once: bots answer together instead of one per beat.
const SIMULTANEOUS = new Set(["reveal", "priest", "gunman", "doctor", "powers", "passItems"]);
const GRACE_MS = 15_000;     // a disconnected human's decisions go to the bot after this
const IDLE_MS = 30 * 60_000; // a room nobody is connected to is deleted after this
const MIN_SEATS = E.MIN_PLAYERS, MAX_SEATS = E.MAX_PLAYERS;
const LOG_KEEP = 120, CHAT_MAX = 200;

const clean = (s) => String(s ?? "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 16);
const newToken = () => crypto.randomUUID().replace(/-/g, "");
const stepOf = (st) => (st.phase === "scuffle" ? st.scuffle.step : st.phase === "trade" ? st.trade.step : st.phase);

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = undefined; // undefined = not loaded yet, null = no room here
  }

  // ---------- persistence ----------
  async load() {
    if (this.room === undefined) this.room = (await this.ctx.storage.get("room")) || null;
    return this.room;
  }
  async save() { if (this.room) await this.ctx.storage.put("room", this.room); }
  withRng(fn) {
    const rng = E.makeRng(0);
    rng.setState(this.room.rngState);
    const out = fn(rng);
    this.room.rngState = rng.getState();
    return out;
  }
  get S() { return LANGS[this.room.settings.lang] || en; }
  t(key, p = {}) {
    const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), this.S);
    return String(v ?? key).replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ""));
  }
  names() { return this.room.seats.map((s) => s.name); }
  faces() { return this.room.seats.map((s) => s.face); }
  talkCtx(rng) { return { rng, names: this.names(), T: this.S.talk }; }

  // ---------- sockets ----------
  sockets(tag) { return this.ctx.getWebSockets(tag); }
  connected(seat) { return !seat.ai && this.sockets(seat.token).length > 0; }
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch {} }
  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const ws of this.sockets()) { try { ws.send(json); } catch {} }
  }
  seatOf(ws) {
    const att = ws.deserializeAttachment();
    return att?.token ? this.room.seats.find((s) => s.token === att.token) || null : null;
  }
  lobbyMsg() {
    const r = this.room;
    return {
      type: "lobby", code: r.code, phase: r.phase, settings: r.settings,
      seats: r.seats.map((s) => ({ idx: s.idx, name: s.name, face: s.face, ready: s.ready, connected: s.ai || this.connected(s), ai: s.ai })),
    };
  }
  pushLobby() { this.broadcast(this.lobbyMsg()); }
  viewMsg(seat) {
    const r = this.room;
    const idx = seat ? seat.idx : null;
    return {
      type: "view", view: E.view(r.state, idx), legal: idx === null ? [] : E.legalActions(r.state, idx),
      me: idx, names: this.names(), faces: this.faces(), deadline: r.deadline, gen: r.gen,
    };
  }
  pushViews() {
    this.room.lastActive = Date.now();
    for (const ws of this.sockets()) this.send(ws, this.viewMsg(this.seatOf(ws)));
  }
  say(seat, text, hot = false) {
    const entry = { seat, text, hot, sys: seat === null };
    this.room.log.push(entry);
    if (this.room.log.length > LOG_KEEP) this.room.log.splice(0, this.room.log.length - LOG_KEEP);
    this.broadcast({ type: "say", ...entry });
  }

  // ---------- the one alarm ----------
  async scheduleAt(at) { this.room.alarmAt = at; await this.ctx.storage.setAlarm(at); }
  async clearAlarm() { this.room.alarmAt = 0; await this.ctx.storage.deleteAlarm(); }
  async maybeIdle() {
    const r = this.room;
    if (this.sockets().length === 0 && (r.phase !== "game" || !r.state || r.state.phase === "over")) {
      r.idle = true;
      await this.scheduleAt(Date.now() + IDLE_MS);
    }
  }
  async alarm() {
    const room = await this.load();
    if (!room) return;
    if (room.idle) {
      if (this.sockets().length === 0) { await this.ctx.storage.deleteAll(); this.room = null; return; }
      room.idle = false;
    }
    await this.pump();
    await this.save();
  }

  // ---------- HTTP entry: status probe or WebSocket upgrade ----------
  async fetch(request) {
    const url = new URL(request.url);
    const room = await this.load();
    if (url.pathname.endsWith("/status")) return Response.json({ exists: !!room });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    const code = url.searchParams.get("room");
    const name = clean(url.searchParams.get("name"));
    const tok = url.searchParams.get("token");
    const create = url.searchParams.get("create") === "1";
    const lang = LANGS[url.searchParams.get("lang")] ? url.searchParams.get("lang") : "en";
    const face = url.searchParams.get("face") || "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const reject = (key) => {
      server.accept();
      this.send(server, { type: "error", key, fatal: true });
      server.close(1008, "rejected");
      return new Response(null, { status: 101, webSocket: client });
    };

    let seat = null;
    if (!room) {
      if (!create) return reject("noRoom");
      this.room = {
        code, phase: "lobby", seats: [], settings: { level: "normal", smuggling: false, dlc: false, events: false, fullExport: false, lang },
        state: null, rngState: E.randomSeed(), gen: 0, deadline: 0, stepKey: "",
        log: [], alarmAt: 0, idle: false, lastActive: Date.now(),
      };
      seat = this.addSeat(name || this.t("setup.defaultName"), face);
    } else if (tok && (seat = room.seats.find((s) => s.token === tok && !s.ai))) {
      for (const old of this.sockets(tok)) { try { old.close(1000, "replaced"); } catch {} }
    } else if (room.phase !== "lobby") {
      seat = null; // spectator
    } else if (room.seats.length >= MAX_SEATS) {
      return reject("full");
    } else {
      seat = this.addSeat(name || this.t("setup.defaultName"), face);
      this.say(null, this.t("sys.joined", { name: seat.name }));
    }

    this.ctx.acceptWebSocket(server, [seat ? seat.token : "spectator"]);
    server.serializeAttachment({ token: seat ? seat.token : null });
    if (this.room.idle) { this.room.idle = false; await this.clearAlarm(); }

    // the build this room runs: a page older than it asks its player to reload
    this.send(server, { type: "joined", code: this.room.code, seat: seat ? seat.idx : -1, token: seat ? seat.token : null, version: VERSION });
    this.pushLobby();
    this.send(server, { type: "log", entries: this.room.log });
    if (this.room.state) this.send(server, this.viewMsg(seat));
    await this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  // The face a newcomer asked for if nobody has it, else a free one.
  pickFace(wanted) {
    const taken = this.room.seats.map((s) => s.face);
    if (isFace(wanted) && !taken.includes(wanted)) return wanted;
    return this.withRng((rng) => freeFaces(rng, taken, E.shuffle))[0] || null;
  }
  uniqueName(name) {
    const taken = new Set(this.room.seats.map((s) => s.name));
    let n = name;
    for (let i = 2; taken.has(n); i++) n = `${name} ${i}`;
    return n;
  }
  addSeat(name, face = "") {
    const r = this.room;
    const seat = { idx: r.seats.length, name: this.uniqueName(name), face: this.pickFace(face), token: newToken(), ready: false, ai: false, lastSeen: Date.now() };
    r.seats.push(seat);
    return seat;
  }
  addBot() {
    const r = this.room;
    const face = this.pickFace("");
    const name = this.uniqueName(face ? passengerName(face, r.settings.lang) : `Bot ${r.seats.length + 1}`);
    r.seats.push({ idx: r.seats.length, name, face, token: `ai-${newToken()}`, ready: true, ai: true, lastSeen: 0 });
  }
  reindex() { this.room.seats.forEach((s, i) => { s.idx = i; }); }

  // ---------- messages ----------
  async webSocketMessage(ws, raw) {
    const room = await this.load();
    if (!room) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const seat = this.seatOf(ws);
    const isHost = seat && seat.idx === 0;
    room.lastActive = Date.now();
    if (seat) seat.lastSeen = Date.now();
    switch (m.type) {
      case "ready":
        if (!seat || room.phase !== "lobby") return;
        seat.ready = !!m.ready; this.pushLobby(); break;
      case "settings":
        if (!isHost || room.phase !== "lobby") return;
        if (B.LEVELS.includes(m.level)) room.settings.level = m.level;
        if (typeof m.smuggling === "boolean") room.settings.smuggling = m.smuggling;
        if (typeof m.dlc === "boolean") room.settings.dlc = m.dlc;
        if (typeof m.events === "boolean") room.settings.events = m.events;
        if (typeof m.fullExport === "boolean") room.settings.fullExport = m.fullExport;
        this.pushLobby(); break;
      case "addBot":
        if (!isHost || room.phase !== "lobby" || room.seats.length >= MAX_SEATS) return;
        this.addBot(); this.pushLobby(); break;
      case "removeBot": {
        if (!isHost || room.phase !== "lobby") return;
        const i = room.seats.findIndex((s) => s.ai && s.idx === (m.idx | 0));
        if (i < 0) return;
        room.seats.splice(i, 1); this.reindex(); this.pushLobby(); break;
      }
      case "start": {
        if (!isHost || room.phase !== "lobby") return;
        if (room.seats.length < MIN_SEATS) return this.send(ws, { type: "error", key: "needMore" });
        if (room.seats.slice(1).some((s) => !s.ai && !s.ready)) return this.send(ws, { type: "error", key: "notReady" });
        await this.startGame(); break;
      }
      case "act": {
        if (!seat || room.phase !== "game" || !m.action) return;
        const action = { ...m.action, seat: seat.idx };
        if (!E.mustAct(room.state).includes(seat.idx)) return;
        try { this.applyAction(action, false); } catch (err) { return this.send(ws, { type: "error", message: err.message }); }
        await this.afterChange(); break;
      }
      // After the game: the seed and every move, if the host chose to share them.
      // A game that began before moves were kept has none to give.
      case "export": {
        if (room.phase !== "over" || !room.state) return this.send(ws, { type: "export", ok: false, reason: "notOver" });
        if (!room.settings.fullExport) return this.send(ws, { type: "export", ok: false, reason: "locked" });
        if (room.seed == null || !room.actions) return this.send(ws, { type: "export", ok: false, reason: "missing" });
        this.send(ws, { type: "export", ok: true, seed: room.seed, options: room.options, actions: room.actions, items: room.state.items });
        break;
      }
      case "chat": {
        if (!seat) return;
        const text = String(m.text ?? "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
        if (!text) return;
        this.say(seat.idx, text); break;
      }
      case "rematch":
        if (!isHost || room.phase !== "over") return;
        await this.clearAlarm();
        room.phase = "lobby"; room.state = null; room.deadline = 0; room.stepKey = "";
        for (const s of room.seats) s.ready = s.ai;
        this.pushLobby(); this.broadcast({ type: "view", view: null }); break;
      case "leave":
        await this.leave(seat);
        try { ws.close(1000, "left"); } catch {}
        break;
    }
    await this.save();
  }

  async leave(seat) {
    const room = this.room;
    if (!seat) return;
    if (room.phase === "lobby" || room.phase === "over") {
      room.seats = room.seats.filter((s) => s !== seat);
      this.reindex();
      if (room.phase === "over") { room.state = null; room.phase = "lobby"; for (const s of room.seats) s.ready = s.ai; }
      if (!room.seats.some((s) => !s.ai)) { await this.clearAlarm(); await this.ctx.storage.deleteAll(); this.room = null; return; }
      this.say(null, this.t("sys.left", { name: seat.name }));
      this.pushLobby();
    } else {
      // Mid-game the seat becomes a bot so the carriage keeps moving.
      seat.ai = true;
      this.say(null, this.t("sys.leftGame", { name: seat.name }));
      this.pushLobby();
      await this.afterChange();
    }
  }

  async webSocketClose(ws) {
    const room = await this.load();
    if (!room) return;
    const seat = this.seatOf(ws);
    const others = this.sockets().filter((s) => s !== ws);
    if (seat && !others.some((s) => s.deserializeAttachment()?.token === seat.token)) {
      seat.lastSeen = Date.now();
      this.pushLobby(); // shows the seat as away
      if (room.phase === "game") await this.afterChange();
    }
    if (others.length === 0) await this.maybeIdle();
    await this.save();
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }

  // ---------- game flow ----------
  async startGame() {
    const room = this.room;
    // the seed and every move are kept, so the finished game can be exported and replayed
    room.seed = E.randomSeed();
    room.options = { smuggling: !!room.settings.smuggling, events: !!room.settings.events,
      dlc: room.settings.dlc ? Object.fromEntries(E.EXPANSIONS.map((k) => [k, true])) : null };
    room.actions = [];
    room.state = E.createGame(room.seed, room.seats.length, room.options);
    room.phase = "game"; room.gen++; room.stepKey = ""; room.log = [];
    for (const s of room.seats) s.ready = false;
    this.pushLobby();
    this.broadcast({ type: "log", entries: [] });
    await this.afterChange();
  }

  // Apply one action to the state. Bot actions also produce their table talk;
  // bots may react to what the log now shows.
  applyAction(action, isBot) {
    const room = this.room;
    const before = room.state;
    const view = isBot ? E.view(before, action.seat) : null;
    const logBefore = before.log.length;
    room.state = E.apply(before, action);
    if (room.actions) room.actions.push(cleanAction(before.turnNo, action));
    // what this move showed sets how long the table holds before a bot moves again
    this.tier = louder(this.tier || "silent", moveTier(before, room.state));
    if (isBot) {
      const line = this.withRng((rng) => sayAction(action, view, this.talkCtx(rng)));
      if (line) this.say(action.seat, line);
    }
    for (let i = logBefore; i < room.state.log.length; i++) {
      const e = room.state.log[i];
      for (const s of room.seats) {
        if (!s.ai) continue;
        const line = this.withRng((rng) => sayResult(e, s.idx, this.talkCtx(rng)));
        if (line) this.say(s.idx, line);
      }
    }
  }

  // Which seats the bot policy decides for right now: bots, and humans who
  // have been away longer than the grace period.
  botSeats(need) {
    const now = Date.now();
    return need.filter((i) => { const s = this.room.seats[i]; return s.ai || (!this.connected(s) && now - s.lastSeen > GRACE_MS); });
  }
  decideFor(seatIdx) {
    const room = this.room;
    return this.withRng((rng) => B.decide(E.view(room.state, seatIdx), E.legalActions(room.state, seatIdx), room.settings.level, rng));
  }

  // After any change: keep the step clock, push views, schedule what is next.
  async afterChange() {
    const room = this.room, st = room.state;
    if (!st) return;
    if (st.phase === "over") { await this.finish(); return; }
    const now = Date.now();
    const step = stepOf(st);
    // The clock restarts whenever the step changes; in the support round
    // every declarer gets their own.
    const key = `${st.phase}/${step}/${st.turnNo}/${st.scuffle ? st.scuffle.next : ""}/${st.pending.join(",")}`;
    if (key !== room.stepKey) {
      room.stepKey = key;
      room.deadline = now + (STEP_MS[step] ?? 30_000);
    }
    this.pushViews();
    const need = E.mustAct(st);
    const bots = this.botSeats(need);
    const wait = step === "reveal" ? 300 : DWELL[this.tier || "silent"];
    this.tier = "silent";
    await this.scheduleAt(bots.length ? Math.min(now + wait, room.deadline) : room.deadline);
  }

  // The alarm handler: let bots act, or enforce the clock.
  async pump() {
    const room = this.room, st = room.state;
    if (room.phase !== "game" || !st) return;
    const now = Date.now();
    const need = E.mustAct(st);
    if (!need.length) return;
    if (room.deadline && now >= room.deadline - 50) {
      // Time is up: the table decides for the first human who has not acted.
      const humans = need.filter((i) => !room.seats[i].ai);
      const i = humans[0] ?? need[0];
      if (!room.seats[i].ai) this.say(null, this.t("sys.timeout", { name: room.seats[i].name }));
      this.applyAction(this.decideFor(i), room.seats[i].ai);
      await this.afterChange();
      return;
    }
    const bots = this.botSeats(need);
    if (bots.length) {
      const step = stepOf(st);
      if (SIMULTANEOUS.has(step)) {
        for (const i of bots) if (room.state.phase !== "over" && E.mustAct(room.state).includes(i) && stepOf(room.state) === step) this.applyAction(this.decideFor(i), true);
      } else {
        const i = this.withRng((rng) => bots[rng.int(bots.length)]);
        this.applyAction(this.decideFor(i), true);
      }
      await this.afterChange();
      return;
    }
    await this.scheduleAt(room.deadline);
  }

  async finish() {
    const room = this.room;
    await this.clearAlarm();
    room.phase = "over"; room.deadline = 0;
    const w = room.state.winner;
    this.say(null, typeof w === "number" ? this.t("sys.overSolo", { name: room.seats[w].name }) : this.t("sys.over", { gang: this.t("gang." + w) }), true);
    this.pushLobby();
    this.pushViews();
    await this.maybeIdle();
  }
}
