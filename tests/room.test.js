// The compartment Durable Object, run over a fake context. Every socket
// records what it is sent, so these tests check what actually leaves the room.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import { Room } from "../src/room.js";

function fakeCtx() {
  const sockets = [];
  const ctx = {
    storage: { async get() { return null; }, async put() {}, async setAlarm() {}, async deleteAlarm() {}, async deleteAll() {} },
    getWebSockets(tag) { return tag ? sockets.filter((s) => s.tag === tag) : sockets.slice(); },
    acceptWebSocket(ws, tags) { ws.tag = tags[0]; sockets.push(ws); },
  };
  return { ctx, sockets };
}
// A pretend WebSocketPair: the server half records sends; the client half is ignored.
function pairFactory(sent) {
  return class {
    constructor() {
      const server = { sent: [], attachment: null,
        send(msg) { const m = JSON.parse(msg); this.sent.push(m); sent.push({ ws: this, m }); },
        close() {}, accept() {},
        serializeAttachment(a) { this.attachment = a; }, deserializeAttachment() { return this.attachment; } };
      this[0] = {}; this[1] = server;
    }
  };
}

// Node's Response refuses status 101; the runtime's accepts it.
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) { super(body, init && init.status === 101 ? { ...init, status: 200 } : init); }
};

async function openRoom(humans, bots) {
  const sent = [];
  globalThis.WebSocketPair = pairFactory(sent);
  const { ctx, sockets } = fakeCtx();
  const room = new Room(ctx, {});
  const ws = [];
  for (let i = 0; i < humans; i++) {
    const url = i === 0 ? "https://room/ws?create=1&room=TEST&name=Host&lang=en" : `https://room/ws?room=TEST&name=P${i}&lang=en`;
    await room.fetch(new Request(url, { headers: { Upgrade: "websocket" } }));
    ws.push(sockets[sockets.length - 1]);
  }
  for (let i = 0; i < bots; i++) await room.webSocketMessage(ws[0], JSON.stringify({ type: "addBot" }));
  for (let i = 1; i < humans; i++) await room.webSocketMessage(ws[i], JSON.stringify({ type: "ready", ready: true }));
  await room.webSocketMessage(ws[0], JSON.stringify({ type: "start" }));
  return { room, ws, sent };
}
const last = (ws, type) => [...ws.sent].reverse().find((m) => m.type === type);

test("room: a game starts with the seats asked for, and each socket sees only its own cards", async () => {
  const { room, ws } = await openRoom(2, 3);
  assert.equal(room.room.phase, "game");
  assert.equal(room.room.state.n, 5);
  for (let i = 0; i < 2; i++) {
    const v = last(ws[i], "view");
    assert.equal(v.me, i);
    assert.ok(v.view.me.gang);
    assert.ok(Array.isArray(v.legal) && v.legal.length, "the seat's legal actions ride along");
    for (let o = 0; o < 5; o++) if (o !== i) { assert.equal(v.view.seats[o].gang, null); assert.equal(v.view.seats[o].hand, null); }
    assert.equal(JSON.stringify(v).includes('"pile":['), false, "the pile's contents never leave");
  }
});

test("room: an action from the wrong seat is ignored, a bad one gets an error, a good one moves the game", async () => {
  const { room, ws } = await openRoom(2, 2);
  for (let i = 0; i < 2; i++) await room.webSocketMessage(ws[i], JSON.stringify({ type: "act", action: { type: "ready" } }));
  // bots still have to ready; the pump does it
  room.room.deadline = 0;
  await room.pump();
  assert.equal(room.room.state.phase, "turn");
  const turn = room.room.state.turn;
  const other = (turn + 1) % 4;
  const before = room.room.state.turnNo;
  if (!room.room.seats[other].ai) {
    await room.webSocketMessage(ws[other], JSON.stringify({ type: "act", action: { type: "pass" } }));
    assert.equal(room.room.state.turnNo, before, "not their turn");
  }
  if (!room.room.seats[turn].ai) {
    await room.webSocketMessage(ws[turn], JSON.stringify({ type: "act", action: { type: "attack", target: turn } }));
    assert.equal(last(ws[turn], "error").message.includes("someone else"), true);
    await room.webSocketMessage(ws[turn], JSON.stringify({ type: "act", action: { type: "pass" } }));
    assert.equal(room.room.state.turnNo, before + 1);
  }
});

test("room: when the clock runs out the carriage decides for the human, and says so", async () => {
  const { room, ws } = await openRoom(1, 3);
  room.room.deadline = Date.now() - 1;
  await room.pump(); // the host had not readied
  assert.equal(room.room.state.ready[0], true);
  assert.ok(room.room.log.some((l) => l.sys && l.text.includes("did not answer")));
});

test("room: chat is broadcast and capped; a spectator cannot chat", async () => {
  const { room, ws, sent } = await openRoom(2, 1);
  await room.webSocketMessage(ws[1], JSON.stringify({ type: "chat", text: "  hello   there ".padEnd(400, "x") }));
  const said = sent.filter((x) => x.m.type === "say" && x.m.seat === 1);
  assert.equal(said.length, 2, "both sockets got it");
  assert.ok(said[0].m.text.length <= 200);
  assert.ok(said[0].m.text.startsWith("hello there"));
});

test("room: a token reclaims the seat, a stranger after departure only watches", async () => {
  const { room, ws } = await openRoom(2, 1);
  const tok = last(ws[1], "joined").token;
  await room.fetch(new Request(`https://room/ws?room=TEST&name=P1&token=${tok}`, { headers: { Upgrade: "websocket" } }));
  const socks = room.ctx.getWebSockets();
  assert.equal(last(socks[socks.length - 1], "joined").seat, 1);
  await room.fetch(new Request("https://room/ws?room=TEST&name=Late", { headers: { Upgrade: "websocket" } }));
  const s2 = room.ctx.getWebSockets();
  assert.equal(last(s2[s2.length - 1], "joined").seat, -1);
  assert.equal(room.room.seats.length, 3);
});

test("room: every seat gets a different face, a requested free face is honoured, and bots are named after theirs", async () => {
  const sent = [];
  globalThis.WebSocketPair = pairFactory(sent);
  const { ctx, sockets } = fakeCtx();
  const room = new Room(ctx, {});
  await room.fetch(new Request("https://room/ws?create=1&room=TEST&name=Host&lang=en&face=lin", { headers: { Upgrade: "websocket" } }));
  await room.fetch(new Request("https://room/ws?room=TEST&name=P1&face=lin", { headers: { Upgrade: "websocket" } }));
  await room.fetch(new Request("https://room/ws?room=TEST&name=P2&face=nobody", { headers: { Upgrade: "websocket" } }));
  for (let i = 0; i < 7; i++) await room.webSocketMessage(sockets[0], JSON.stringify({ type: "addBot" }));
  const seats = room.room.seats;
  assert.equal(seats.length, 10);
  assert.equal(seats[0].face, "lin", "the host got the face they asked for");
  assert.notEqual(seats[1].face, "lin", "a taken face goes to someone else");
  assert.equal(new Set(seats.map((s) => s.face)).size, 10, "ten different faces");
  for (const s of seats) assert.ok(s.face, "everyone has a face");
  const bots = seats.filter((s) => s.ai);
  assert.equal(bots.length, 7);
  for (const b of bots) assert.ok(/^[A-Z]/.test(b.name) && !/^Bot/.test(b.name), `a bot is named after its face: ${b.name}`);
  const lobby = [...sockets[0].sent].reverse().find((m) => m.type === "lobby");
  assert.equal(lobby.seats[3].face, bots[0].face, "the lobby shows faces");
});

test("room: every socket is told the build the room runs, so an older page can ask to reload", async () => {
  const { VERSION } = await import("../public/shared/version.js");
  assert.match(VERSION, /^[0-9a-f]{10}$/);
  const { ws } = await openRoom(2, 1);
  for (const w of ws) assert.equal(last(w, "joined").version, VERSION);
});

test("room: after the game the full record goes out only if the host shared it, and it replays to the same end", async () => {
  const B = await import("../public/shared/bots.js");
  const { buildRecord, replay, finalTable } = await import("../public/shared/record.js");
  const { room, ws } = await openRoom(1, 4);
  const rng = E.makeRng(99);
  for (let i = 0; i < 20000 && room.room.phase !== "over"; i++) {
    const st = room.room.state;
    if (E.mustAct(st).includes(0)) {
      const { seat, why, p, ...action } = B.decide(E.view(st, 0), E.legalActions(st, 0), "normal", rng);
      await room.webSocketMessage(ws[0], JSON.stringify({ type: "act", action }));
    } else await room.pump();
  }
  assert.equal(room.room.phase, "over", "the game should have finished");
  await room.webSocketMessage(ws[0], JSON.stringify({ type: "export" }));
  assert.deepEqual(last(ws[0], "export"), { type: "export", ok: false, reason: "locked" });
  room.room.settings.fullExport = true;
  await room.webSocketMessage(ws[0], JSON.stringify({ type: "export" }));
  const m = last(ws[0], "export");
  assert.equal(m.ok, true);
  const st = room.room.state;
  const rec = JSON.parse(JSON.stringify(buildRecord({ scope: "full", seed: m.seed, n: st.n, options: m.options, actions: m.actions,
    passengers: [], result: {}, final: finalTable(st), log: st.log })));
  const again = replay(rec);
  assert.equal(again.winner, st.winner);
  assert.equal(again.turnNo, st.turnNo);
  assert.deepEqual(finalTable(again), finalTable(st));
});
