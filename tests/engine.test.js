// The engine, checked against the rulebook digest: setup for every count,
// trades and their texts, scuffles with every power, the hand limit,
// declarations, what each seat may see, and a fuzz over legal moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";

const { TIMEKEEPERS: TK, SEALBEARERS: SB } = E;

// ---------- helpers ----------
const ready = (st) => { for (let s = 0; s < st.n; s++) st = E.apply(st, { type: "ready", seat: s }); return st; };
const start = (n, seed = 1, options = {}) => ready(E.createGame(seed, n, options));

// Put the whole deck where the test wants it: `hands[s]` lists ids for seat
// s, everything else goes to the pile (first listed = bottom).
function deal(st, hands, pile = null) {
  st = E.clone(st);
  const all = Object.keys(st.items);
  const used = new Set(hands.flat());
  for (let s = 0; s < st.n; s++) st.seats[s].items = (hands[s] || []).slice();
  st.pile = pile ? pile.slice() : all.filter((id) => !used.has(id));
  if (pile) for (const id of pile) if (used.has(id)) throw new Error(`${id} both in a hand and the pile`);
  return st;
}
function setTrades(st, trades) {
  st = E.clone(st);
  const rest = E.TRADE_IDS.filter((t) => !trades.includes(t));
  trades.forEach((t, s) => { st.seats[s].trade = t; st.seats[s].tradeUsed = false; st.seats[s].tradeRevealed = false; });
  st.spareTrades = rest;
  return st;
}
function setGangs(st, gangs) {
  st = E.clone(st);
  gangs.forEach((g, s) => { st.seats[s].gang = g; });
  st.gangSizes = { [TK]: gangs.filter((g) => g === TK).length, [SB]: gangs.filter((g) => g === SB).length };
  st.minority = E.isOdd(st.n) ? (st.gangSizes[TK] < st.gangSizes[SB] ? TK : SB) : null;
  return st;
}
function onTurn(st, seat) { st = E.clone(st); st.turn = seat; st.phase = "turn"; return st; }
const play = (st, ...actions) => actions.reduce((s, a) => E.apply(s, a), st);
const hand = (st, s) => st.seats[s].items;
const lastLog = (st) => st.log[st.log.length - 1];

// Skip every open window for everyone waiting (nobody uses anything).
function skipAll(st) {
  while (st.phase === "scuffle" && ["priest", "gunman", "doctor"].includes(st.scuffle.step)) {
    for (const s of E.mustAct(st)) st = E.apply(st, { type: "window", seat: s, use: false });
  }
  return st;
}
function noSupport(st) {
  while (st.phase === "scuffle" && st.scuffle.step === "support") st = E.apply(st, { type: "support", seat: st.scuffle.next, side: "out" });
  return st;
}
function noHypno(st) {
  if (st.phase === "scuffle" && st.scuffle.step === "hypnotist") st = E.apply(st, { type: "hypnotize", seat: st.scuffle.attacker, target: null });
  return st;
}
function showNothing(st) {
  while (st.phase === "scuffle" && st.scuffle.step === "powers") {
    for (const s of E.mustAct(st)) st = E.apply(st, { type: "show", seat: s, items: [], trade: false });
  }
  return st;
}
// A plain scuffle nobody interferes with, up to the doctor window's end.
const plainFight = (st, attacker, target) => skipAll(showNothing(noHypno(noSupport(skipAll(E.apply(st, { type: "attack", seat: attacker, target }))))));

// ---------- tables and setup ----------
test("the luggage deck is 21 cards, 20 at three and at ten players", () => {
  assert.equal(E.deckSize(6), 21);
  assert.equal(E.deckSize(3), 20);
  assert.equal(E.deckSize(10), 20);
  assert.equal(E.TRADE_IDS.length, 10);
});

test("expansion cards stay out unless switched on", () => {
  assert.deepEqual(E.tradePool({}), E.TRADE_IDS);
  assert.equal(E.deckSize(6, { dlc: { gold: true } }), 22);
  assert.equal(E.tradePool({ dlc: { double: true, porter: true, gambler: true } }).length, 13);
  const plain = E.createGame(5, 6);
  assert.deepEqual(plain.options.dlc, {});
  assert.ok(!Object.values(plain.items).includes("gold_bar"));
  const on = E.createGame(5, 6, { dlc: { gold: true, porter: true } });
  assert.ok(Object.values(on.items).includes("gold_bar"));
  assert.deepEqual(on.options.dlc, { gold: true, porter: true });
});

test("setup for every count: one item each (two at three), both cases dealt, gangs split, trades unique", () => {
  for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) {
    for (let seed = 1; seed <= 20; seed++) {
      const st = E.createGame(seed, n);
      const each = n === 3 ? 2 : 1;
      for (const sd of st.seats) assert.equal(sd.items.length, each, `n=${n}`);
      const dealt = st.seats.flatMap((sd) => sd.items);
      assert.ok(dealt.includes("case_watch") && dealt.includes("case_seal"), `both cases dealt at ${n}`);
      assert.equal(dealt.length + st.pile.length, E.deckSize(n));
      assert.equal(new Set([...dealt, ...st.pile]).size, E.deckSize(n));
      const diff = Math.abs(st.gangSizes[TK] - st.gangSizes[SB]);
      assert.equal(diff, E.isOdd(n) ? 1 : 0, `gang sizes at ${n}`);
      assert.equal(st.minority === null, !E.isOdd(n));
      assert.equal(new Set(st.seats.map((s) => s.trade)).size, n);
      assert.equal(st.spareTrades.length, 10 - n);
      for (const sd of st.seats) assert.equal(sd.drink, E.isOdd(n));
      if (n === 3) assert.ok(!Object.values(st.items).includes("black_letter"));
      if (n === 10) assert.ok(!Object.values(st.items).includes("trench_coat"));
      assert.equal(st.phase, "reveal");
    }
  }
});

test("reveal: the game starts when everyone is ready; passing moves the turn clockwise", () => {
  let st = E.createGame(3, 5);
  assert.deepEqual(E.mustAct(st), [0, 1, 2, 3, 4]);
  st = ready(st);
  assert.equal(st.phase, "turn");
  assert.equal(st.turnNo, 1);
  const first = st.turn;
  st = E.apply(st, { type: "pass", seat: first });
  assert.equal(st.turn, (first + 1) % 5);
  assert.equal(st.turnNo, 2);
  assert.throws(() => E.apply(st, { type: "pass", seat: first }), /not on turn/);
});

// ---------- trades ----------
test("trade: refuse ends the turn; accept swaps the cards and both learn what they got", () => {
  let st = onTurn(deal(start(4), [["dagger"], ["watch1"], ["seal1"], ["gloves"]]), 0);
  let r = E.apply(st, { type: "offer", seat: 0, to: 1, item: "dagger" });
  assert.equal(r.phase, "trade");
  assert.deepEqual(E.mustAct(r), [1]);
  r = E.apply(r, { type: "answer", seat: 1, accept: false });
  assert.equal(r.phase, "turn");
  assert.equal(r.turn, 1);
  assert.deepEqual(hand(r, 0), ["dagger"]);
  assert.equal(lastLog(r).accepted, false);
  assert.ok(r.knowledge[1].some((k) => k.k === "offered" && k.kind === "dagger"));

  r = play(st, { type: "offer", seat: 0, to: 1, item: "dagger" }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.deepEqual(hand(r, 0), ["watch1"]);
  assert.deepEqual(hand(r, 1), ["dagger"]);
  assert.ok(r.knowledge[0].some((k) => k.k === "got" && k.from === 1 && k.kind === "watch"));
  assert.ok(r.knowledge[1].some((k) => k.k === "got" && k.from === 0 && k.kind === "dagger"));
  assert.equal(lastLog(r).accepted, true);
  assert.deepEqual(lastLog(r).announced, []);
});

test("trade texts: monocle shows the gang, warrant the hand, a case draws, and they are announced", () => {
  let st = setGangs(deal(start(4), [["monocle", "warrant"], ["watch1", "seal1"], ["case_watch"], ["gloves"]]), [TK, SB, TK, SB]);
  st = onTurn(st, 0);
  let r = play(st, { type: "offer", seat: 0, to: 1, item: "monocle" }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.ok(r.knowledge[0].some((k) => k.k === "gang" && k.seat === 1 && k.gang === SB));
  assert.deepEqual(lastLog(r).announced, [{ seat: 0, kind: "monocle" }]);

  r = play(st, { type: "offer", seat: 0, to: 1, item: "warrant" }, { type: "answer", seat: 1, accept: true, item: "seal1" });
  const seen = r.knowledge[0].find((k) => k.k === "hand" && k.seat === 1);
  assert.deepEqual(seen.items.map((x) => x.id), ["watch1", "warrant"]);

  const pileBefore = st.pile.length;
  r = play(onTurn(st, 2), { type: "offer", seat: 2, to: 3, item: "case_watch" }, { type: "answer", seat: 3, accept: true, item: "gloves" });
  assert.equal(hand(r, 2).length, 2, "the case's giver drew one");
  assert.equal(r.pile.length, pileBefore - 1);
  assert.deepEqual(lastLog(r).drew, [2]);
  // the case is now seat 3's; trading it back for the other case is illegal
  const r2 = deal(r, [["watch1"], ["seal1"], ["case_seal"], ["case_watch"]]);
  assert.throws(() => play(onTurn(r2, 2), { type: "offer", seat: 2, to: 3, item: "case_seal" }, { type: "answer", seat: 3, accept: true, item: "case_watch" }), /other case/);
});

test("trade: the poison-pen letter and the broken mirror must be accepted; the mirror silences texts", () => {
  let st = onTurn(deal(start(4), [["black_letter", "broken_mirror"], ["monocle"], ["watch1"], ["seal1"]]), 0);
  let r = E.apply(st, { type: "offer", seat: 0, to: 1, item: "black_letter" });
  assert.throws(() => E.apply(r, { type: "answer", seat: 1, accept: false }), /must be accepted/);
  r = E.apply(r, { type: "answer", seat: 1, accept: true, item: "monocle" });
  // seat 1 gave the monocle away: its text fires for seat 1
  assert.ok(r.knowledge[1].some((k) => k.k === "gang" && k.seat === 0));

  r = play(st, { type: "offer", seat: 0, to: 1, item: "broken_mirror" }, { type: "answer", seat: 1, accept: true, item: "monocle" });
  assert.ok(!r.knowledge[1].some((k) => k.k === "gang"), "the mirror silences the monocle");
  assert.deepEqual(lastLog(r).announced, []);

  // the holder of the letter may not declare
  const held = onTurn(deal(setGangs(start(4), [TK, TK, SB, SB]), [["black_letter", "watch1"], ["watch2"], [], ["watch3"]]), 0);
  assert.throws(() => E.apply(held, { type: "declare", seat: 0, holders: {} }), /poison-pen/);
});

test("smuggling: a text fires only when its giver announces it", () => {
  let st = onTurn(deal(start(4, 1, { smuggling: true }), [["monocle"], ["watch1"], ["seal1"], ["gloves"]]), 0);
  let r = play(st, { type: "offer", seat: 0, to: 1, item: "monocle", announce: false }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.ok(!r.knowledge[0].some((k) => k.k === "gang"));
  assert.deepEqual(lastLog(r).announced, []);
  r = play(st, { type: "offer", seat: 0, to: 1, item: "monocle", announce: true }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.ok(r.knowledge[0].some((k) => k.k === "gang"));
});

test("codebook swaps trades and resets them; the coat takes a spare trade", () => {
  let st = setTrades(deal(start(4), [["codebook", "trench_coat"], ["watch1"], ["seal1"], ["gloves"]]), ["thug", "priest", "doctor", "master"]);
  st.seats[1].tradeRevealed = true; st.seats[1].tradeUsed = true;
  st = onTurn(st, 0);
  let r = play(st, { type: "offer", seat: 0, to: 1, item: "codebook" }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.equal(r.trade.step, "codebook");
  assert.deepEqual(E.mustAct(r), [0]);
  r = E.apply(r, { type: "codebook", seat: 0, swap: true });
  assert.equal(r.seats[0].trade, "priest");
  assert.equal(r.seats[1].trade, "thug");
  assert.equal(r.seats[1].tradeUsed, false, "a swapped once-only power comes back");
  assert.equal(r.seats[1].tradeRevealed, false);
  assert.ok(r.knowledge[1].some((k) => k.k === "trade" && k.seat === 0 && k.trade === "priest"));
  assert.equal(r.phase, "turn");

  r = play(st, { type: "offer", seat: 0, to: 2, item: "trench_coat" }, { type: "answer", seat: 2, accept: true, item: "seal1" });
  assert.equal(r.trade.step, "coat");
  assert.deepEqual(E.view(r, 0).coatChoices.sort(), st.spareTrades.slice().sort());
  assert.equal(E.view(r, 1).coatChoices, null);
  r = E.apply(r, { type: "coat", seat: 0, trade: "diplomat" });
  assert.equal(r.seats[0].trade, "diplomat");
  assert.ok(r.spareTrades.includes("thug") && !r.spareTrades.includes("diplomat"));
});

test("timetable: everyone with an item passes one in the named direction, no texts fire", () => {
  let st = onTurn(deal(start(4), [["timetable", "monocle"], ["watch1"], [], ["seal1", "gloves"]]), 0);
  let r = play(st, { type: "offer", seat: 0, to: 1, item: "timetable" }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.equal(r.trade.step, "direction");
  r = E.apply(r, { type: "direction", seat: 0, dir: "left" });
  assert.equal(r.trade.step, "passItems");
  assert.deepEqual(E.mustAct(r).sort(), [0, 1, 3], "seat 2 holds nothing and is not asked");
  r = play(r, { type: "passItem", seat: 0, item: "monocle" }, { type: "passItem", seat: 1, item: "timetable" }, { type: "passItem", seat: 3, item: "gloves" });
  assert.equal(r.phase, "turn");
  assert.deepEqual(hand(r, 1).sort(), ["monocle"]);
  assert.deepEqual(hand(r, 2), ["timetable"]);
  assert.deepEqual(hand(r, 0).sort(), ["gloves", "watch1"]);
  assert.deepEqual(hand(r, 3), ["seal1"]);
  assert.ok(!r.knowledge[0].some((k) => k.k === "gang"), "passing the monocle on fires nothing");
});

test("diplomat: a forced trade when the target has the item, a look at the hand when not", () => {
  let st = setTrades(deal(start(4), [["gloves"], ["watch1", "dagger"], ["seal1"], ["cane"]]), ["diplomat", "thug", "master", "priest"]);
  st = onTurn(st, 0);
  let r = E.apply(st, { type: "demand", seat: 0, target: 1, kind: "watch" });
  assert.equal(r.phase, "trade");
  assert.equal(r.trade.step, "return");
  assert.deepEqual(E.mustAct(r), [0]);
  assert.equal(r.seats[0].tradeRevealed, true);
  r = E.apply(r, { type: "give", seat: 0, item: "gloves" });
  assert.deepEqual(hand(r, 0), ["watch1"]);
  assert.deepEqual(hand(r, 1).sort(), ["dagger", "gloves"]);
  assert.equal(r.phase, "turn");
  assert.throws(() => E.apply(onTurn(r, 0), { type: "demand", seat: 0, target: 2, kind: "seal" }), /no diplomat/);

  r = E.apply(st, { type: "demand", seat: 0, target: 2, kind: "watch" });
  assert.equal(r.phase, "turn", "the turn ends");
  assert.equal(r.turn, 1);
  assert.ok(r.knowledge[0].some((k) => k.k === "hand" && k.seat === 2 && k.items[0].kind === "seal"));
});

test("fortune teller: looks at the pile and puts two on top in order", () => {
  let st = setTrades(deal(start(4), [["gloves"], ["watch1"], ["seal1"], ["cane"]]), ["fortune_teller", "thug", "master", "priest"]);
  st = onTurn(st, 0);
  let r = E.apply(st, { type: "fortune", seat: 0 });
  assert.equal(r.phase, "peek");
  assert.equal(E.view(r, 0).peek.length, r.pile.length);
  assert.equal(E.view(r, 1).peek, null);
  const [a, b] = [r.pile[0], r.pile[3]];
  r = E.apply(r, { type: "arrange", seat: 0, top: [a, b] });
  assert.equal(r.phase, "turn");
  assert.equal(r.turn, 0, "a free action; the turn goes on");
  assert.equal(r.pile[r.pile.length - 1], a);
  assert.equal(r.pile[r.pile.length - 2], b);
  assert.equal(new Set(r.pile).size, st.pile.length);
});

// ---------- scuffles ----------
test("scuffle: one on one, one sword against one shield is a tie and the attacker draws", () => {
  let st = onTurn(deal(start(4), [["gloves"], ["watch1"], ["seal1"], ["cane"]]), 0);
  const pile = st.pile.length;
  let r = E.apply(st, { type: "attack", seat: 0, target: 1 });
  assert.equal(r.scuffle.step, "priest");
  assert.deepEqual(E.mustAct(r).sort(), [1, 2, 3]);
  r = skipAll(r);
  assert.equal(r.scuffle.step, "support");
  assert.equal(r.scuffle.next, 2, "support starts at the attacker's left");
  r = noSupport(r);
  assert.equal(r.scuffle.step, "hypnotist", "the attacker could hold the hypnotist, so is asked");
  r = noHypno(r);
  assert.equal(r.scuffle.step, "powers");
  assert.deepEqual(E.mustAct(r).sort(), [0, 1, 2, 3]);
  r = showNothing(r);
  assert.equal(r.scuffle.step, "doctor");
  assert.equal(r.scuffle.tie, true);
  r = skipAll(r);
  assert.equal(r.phase, "turn");
  assert.equal(hand(r, 0).length, 2, "tie: the attacker drew");
  assert.equal(r.pile.length, pile - 1);
  assert.equal(lastLog(r).tie, true);
});

test("scuffle: a supporter tips it; the winner may peek or take", () => {
  let st = onTurn(deal(setGangs(start(4), [TK, SB, TK, SB]), [["gloves"], ["watch1", "seal1"], ["dagger"], ["cane"]]), 0);
  let r = skipAll(E.apply(st, { type: "attack", seat: 0, target: 1 }));
  r = E.apply(r, { type: "support", seat: 2, side: "attacker" });
  r = E.apply(r, { type: "support", seat: 3, side: "out" });
  r = skipAll(showNothing(noHypno(r)));
  assert.equal(r.scuffle.step, "choice");
  assert.equal(r.scuffle.winner, 0);
  assert.equal(r.scuffle.swords, 2);
  const peek = E.apply(r, { type: "choice", seat: 0, take: false });
  assert.equal(peek.phase, "turn");
  assert.ok(peek.knowledge[0].some((k) => k.k === "gang" && k.seat === 1 && k.gang === SB));
  assert.ok(peek.knowledge[0].some((k) => k.k === "trade" && k.seat === 1));
  assert.equal(lastLog(peek).choice, "peek");

  let take = E.apply(r, { type: "choice", seat: 0, take: true });
  assert.equal(take.scuffle.step, "take");
  assert.deepEqual(E.view(take, 0).scuffle.loserHand.map((x) => x.id), ["watch1", "seal1"]);
  assert.equal(E.view(take, 2).scuffle.loserHand, null);
  take = E.apply(take, { type: "takeItem", seat: 0, item: "watch1" });
  assert.deepEqual(hand(take, 0).sort(), ["gloves", "watch1"]);
  assert.deepEqual(hand(take, 1), ["seal1"]);
  assert.ok(take.knowledge[1].some((k) => k.k === "lost" && k.to === 0));
});

test("scuffle: dagger, gloves, thug, master, knives, cane and bodyguard all count; the poison ring wins ties", () => {
  const base = setTrades(deal(setGangs(start(5), [TK, SB, TK, SB, TK]), [["dagger"], ["gloves"], ["knives"], ["cane"], ["poison_ring"]]), ["thug", "master", "bodyguard", "bodyguard", "doctor"]);
  // attacker 0 with dagger + thug (3) vs defender 1 with gloves + master (3): tie, nobody has the ring
  let r = skipAll(E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 }));
  r = noHypno(noSupport(r));
  r = E.apply(r, { type: "show", seat: 0, items: ["dagger"], trade: true });
  r = E.apply(r, { type: "show", seat: 1, items: ["gloves"], trade: true });
  r = showNothing(r);
  assert.equal(r.scuffle.swords, 3);
  assert.equal(r.scuffle.shields, 3);
  assert.equal(r.scuffle.tie, true);
  assert.equal(r.seats[0].tradeRevealed, true);

  // supporters: 2 backs the attacker with knives + bodyguard (+3), 3 guards with cane + bodyguard (+3)
  r = skipAll(E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 }));
  r = play(r, { type: "support", seat: 2, side: "attacker" }, { type: "support", seat: 3, side: "defender" }, { type: "support", seat: 4, side: "out" });
  r = noHypno(r);
  r = play(r,
    { type: "show", seat: 0, items: [], trade: false }, { type: "show", seat: 1, items: [], trade: false },
    { type: "show", seat: 2, items: ["knives"], trade: true }, { type: "show", seat: 3, items: ["cane"], trade: true },
    { type: "show", seat: 4, items: [], trade: false });
  assert.equal(r.scuffle.swords, 4);
  assert.equal(r.scuffle.shields, 4);
  assert.throws(() => E.apply(onTurn(base, 2), { type: "attack", seat: 2, target: 2 }), /someone else/);

  // the ring: 4 attacks 1, both bare, 4 shows the ring and wins the tie
  r = noHypno(noSupport(skipAll(E.apply(onTurn(base, 4), { type: "attack", seat: 4, target: 1 }))));
  r = E.apply(r, { type: "show", seat: 4, items: ["poison_ring"], trade: false });
  r = showNothing(r);
  assert.equal(r.scuffle.winner, 4);
  assert.equal(r.scuffle.tie, false);
  // items only work in the right role
  const wrong = noHypno(noSupport(skipAll(E.apply(onTurn(base, 1), { type: "attack", seat: 1, target: 0 }))));
  assert.throws(() => E.apply(wrong, { type: "show", seat: 1, items: ["gloves"], trade: false }), /cannot be used by the attacker/);
});

test("scuffle: the priest stops it and is paid when the attacker holds two; the gunman bars support", () => {
  const base = setTrades(deal(start(4), [["dagger", "watch1"], ["gloves"], ["knives"], ["cane"]]), ["thug", "gunman", "priest", "doctor"]);
  let r = E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 });
  r = E.apply(r, { type: "window", seat: 2, use: true });
  assert.equal(r.scuffle.step, "priestPay");
  assert.deepEqual(E.mustAct(r), [0]);
  r = E.apply(r, { type: "give", seat: 0, item: "watch1" });
  assert.equal(r.phase, "turn");
  assert.equal(r.turn, 1);
  assert.deepEqual(hand(r, 2).sort(), ["knives", "watch1"]);
  assert.equal(r.seats[2].tradeUsed, true);
  assert.equal(lastLog(r).stopped, 2);
  // a second time: the priest is spent, and the table knows, so it is not asked
  const again = E.apply(onTurn(r, 3), { type: "attack", seat: 3, target: 0 });
  assert.ok(!E.mustAct(again).includes(2));
  assert.throws(() => E.apply(again, { type: "window", seat: 1, use: true }), /no priest/);

  // gunman: the defender bars all support
  r = E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 });
  for (const s of E.mustAct(r)) r = E.apply(r, { type: "window", seat: s, use: false });
  assert.equal(r.scuffle.step, "gunman");
  assert.deepEqual(E.mustAct(r).sort(), [0, 1]);
  r = E.apply(r, { type: "window", seat: 1, use: true });
  assert.equal(r.scuffle.gunman, 1);
  assert.notEqual(r.scuffle.step, "support");
  r = skipAll(showNothing(noHypno(r)));
  assert.equal(r.phase, "turn", "a bare tie resolves without a choice");
  assert.deepEqual(lastLog(r).support, {});
  assert.equal(lastLog(r).gunman, 1);
  assert.equal(lastLog(r).tie, true);
});

test("scuffle: the hypnotist sits a supporter out; the pharmacist decides; the doctor cancels", () => {
  const base = setTrades(deal(setGangs(start(5), [TK, SB, TK, SB, TK]), [["dagger"], ["gloves"], ["knives"], ["cane"], ["watch1"]]), ["hypnotist", "master", "pharmacist", "bodyguard", "doctor"]);
  let r = skipAll(E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 }));
  r = play(r, { type: "support", seat: 2, side: "out" }, { type: "support", seat: 3, side: "defender" }, { type: "support", seat: 4, side: "out" });
  assert.equal(r.scuffle.step, "hypnotist");
  r = E.apply(r, { type: "hypnotize", seat: 0, target: 3 });
  assert.equal(r.scuffle.support[3], "out");
  assert.ok(!E.mustAct(r).includes(3), "the hypnotized seat gets no powers window");
  r = showNothing(r);
  assert.equal(r.scuffle.shields, 1);
  assert.equal(r.scuffle.tie, true);

  // pharmacist (seat 2, a bystander) hands the win to the defender despite the count
  r = skipAll(E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 }));
  r = noHypno(noSupport(r));
  r = E.apply(r, { type: "show", seat: 0, items: ["dagger"], trade: false });
  r = E.apply(r, { type: "show", seat: 2, items: [], trade: true, winner: 1 });
  r = showNothing(r);
  assert.equal(r.scuffle.swords, 2);
  assert.equal(r.scuffle.winner, 1);
  assert.equal(r.seats[2].tradeUsed, true);
  const done = skipAll(r);
  assert.equal(done.scuffle.step, "choice");
  assert.deepEqual(E.mustAct(done), [1]);

  // doctor (seat 4) cancels after the count: nothing is learned or taken
  r = skipAll(E.apply(onTurn(base, 0), { type: "attack", seat: 0, target: 1 }));
  r = noHypno(noSupport(r));
  r = E.apply(r, { type: "show", seat: 0, items: ["dagger"], trade: false });
  r = showNothing(r);
  assert.equal(r.scuffle.step, "doctor");
  r = E.apply(r, { type: "window", seat: 4, use: true });
  assert.equal(r.phase, "turn");
  assert.equal(lastLog(r).doctored, 4);
  assert.equal(hand(r, 1).length, 1);
  assert.equal(r.knowledge[0].length, 0);
  assert.equal(r.seats[4].tradeUsed, true);
});

test("scuffle: nobody is asked in a window they visibly cannot answer", () => {
  let st = setTrades(deal(start(4), [["dagger"], ["gloves"], ["knives"], ["cane"]]), ["thug", "master", "priest", "doctor"]);
  st.seats[0].tradeRevealed = true; st.seats[1].tradeRevealed = true; st.seats[3].tradeRevealed = true;
  const r = E.apply(onTurn(st, 0), { type: "attack", seat: 0, target: 1 });
  assert.deepEqual(E.mustAct(r), [2], "only the seat that could still be the priest");
});

// ---------- hand limit ----------
test("hand limit: over the cap you give at once, and the turn waits", () => {
  let st = deal(start(5), [["dagger", "gloves", "knives", "cane", "monocle"], ["watch1", "seal1"], ["seal2"], ["watch2"], ["warrant"]]);
  st = onTurn(st, 0);
  // 0 (five items, the cap) beats 1 with the dagger and takes a card
  let r = noHypno(noSupport(skipAll(E.apply(st, { type: "attack", seat: 0, target: 1 }))));
  r = E.apply(r, { type: "show", seat: 0, items: ["dagger"], trade: false });
  r = skipAll(showNothing(r));
  r = play(r, { type: "choice", seat: 0, take: true }, { type: "takeItem", seat: 0, item: "watch1" });
  assert.equal(r.phase, "handLimit");
  assert.deepEqual(E.mustAct(r), [0]);
  assert.throws(() => E.apply(r, { type: "pass", seat: 1 }), /during handLimit/);
  r = E.apply(r, { type: "gift", seat: 0, item: "cane", to: 4 });
  assert.equal(r.phase, "turn");
  assert.equal(r.turn, 1);
  assert.equal(hand(r, 0).length, 5);
  assert.ok(hand(r, 4).includes("cane"));
  assert.equal(lastLog(r).type, "gift");
});

// ---------- declarations ----------
test("declare: right and the gang wins; naming an enemy or a short count loses", () => {
  const st = onTurn(deal(setGangs(start(4), [TK, TK, SB, SB]), [["watch1"], ["watch2", "watch3"], ["seal1"], ["seal2"]]), 0);
  let r = E.apply(st, { type: "declare", seat: 0, holders: { 1: 2 } });
  assert.equal(r.phase, "over");
  assert.equal(r.winner, TK);
  assert.equal(r.reason, "declared");
  assert.equal(lastLog(r).correct, true);
  assert.equal(lastLog(r).revealed.length, 2);

  r = E.apply(st, { type: "declare", seat: 0, holders: { 2: 2 } });
  assert.equal(r.winner, SB);
  assert.equal(r.reason, "wrong");
  r = E.apply(st, { type: "declare", seat: 0, holders: { 1: 1 } });
  assert.equal(r.winner, SB, "three are needed");
  const noItem = onTurn(deal(st, [[], ["watch1", "watch2", "watch3"], ["seal1"], ["seal2"]]), 0);
  assert.throws(() => E.apply(noItem, { type: "declare", seat: 0, holders: { 1: 3 } }), /hold one/);
});

test("declare: at odd counts one strong drink counts for the smaller gang only; cases count once the pile is empty", () => {
  let st = setGangs(start(5), [TK, TK, SB, SB, SB]); // TK is the minority
  st = onTurn(deal(st, [["watch1"], ["watch2"], ["seal1"], ["seal2"], ["dagger"]]), 0);
  assert.equal(st.minority, TK);
  let r = E.apply(st, { type: "declare", seat: 0, holders: { 1: 1 } });
  assert.equal(r.winner, TK, "two watches and a drink");
  r = E.apply(onTurn(st, 2), { type: "declare", seat: 2, holders: { 3: 1 } });
  assert.equal(r.winner, TK, "the bigger gang gets no drink");

  // the case is a watch only when the pile is out
  let c = onTurn(deal(setGangs(start(4), [TK, TK, SB, SB]), [["watch1", "case_watch"], ["watch2"], ["seal1"], ["seal2"]]), 0);
  assert.equal(E.apply(c, { type: "declare", seat: 0, holders: { 1: 1 } }).winner, SB);
  c = deal(c, [["watch1", "case_watch"], ["watch2"], ["seal1"], ["seal2"]], []);
  assert.equal(E.apply(c, { type: "declare", seat: 0, holders: { 1: 1 } }).winner, TK);
});

test("solo: the first-class ticket with any three goal items wins alone", () => {
  let st = onTurn(deal(setGangs(start(4), [TK, TK, SB, SB]), [["first_class_ticket", "watch1", "seal1", "seal2"], ["watch2"], ["watch3"], ["seal3"]]), 0);
  const r = E.apply(st, { type: "solo", seat: 0 });
  assert.equal(r.phase, "over");
  assert.equal(r.winner, 0);
  assert.equal(r.reason, "solo");
  const short = onTurn(deal(st, [["first_class_ticket", "watch1", "seal1"], ["watch2"], ["watch3"], ["seal3"]]), 0);
  assert.throws(() => E.apply(short, { type: "solo", seat: 0 }), /needs 3/);
});

// ---------- views ----------
test("view: a seat sees its own cards, counts for others, and nothing hidden leaks", () => {
  let st = onTurn(deal(setGangs(start(4), [TK, TK, SB, SB]), [["monocle", "watch2"], ["watch1", "dagger"], ["seal1"], ["seal2"]]), 0);
  const v = E.view(st, 0);
  assert.equal(v.me.gang, TK);
  assert.deepEqual(v.me.items.map((x) => x.id), ["monocle", "watch2"]);
  for (let s = 1; s < 4; s++) {
    assert.equal(v.seats[s].gang, null);
    assert.equal(v.seats[s].trade, null);
    assert.equal(v.seats[s].hand, null);
  }
  assert.equal(v.seats[1].items, 2);
  assert.equal(v.gangSizes, null);
  assert.equal(v.minority, null);
  assert.equal(JSON.stringify(v).includes("watch1"), false);

  const offered = E.apply(st, { type: "offer", seat: 0, to: 1, item: "monocle" });
  assert.equal(E.view(offered, 1).trade.offered.kind, "monocle");
  assert.equal(E.view(offered, 2).trade.offered, null);
  assert.equal(E.view(offered, 2).trade.from, 0);

  const spectator = E.view(st, null);
  assert.equal(spectator.me, null);
  assert.equal(spectator.seats[1].gang, null);

  const over = E.apply(st, { type: "declare", seat: 0, holders: {} });
  const vo = E.view(over, 2);
  assert.equal(vo.seats[0].gang, TK);
  assert.deepEqual(vo.seats[1].hand.map((x) => x.id), ["watch1", "dagger"]);
  assert.deepEqual(vo.gangSizes, { [TK]: 2, [SB]: 2 });
});

test("view: a revealed trade is public, a hidden one is not, and knowledge is per seat", () => {
  let st = setTrades(deal(setGangs(start(4), [TK, SB, TK, SB]), [["monocle"], ["watch1"], ["seal1"], ["seal2"]]), ["thug", "master", "priest", "doctor"]);
  st = play(onTurn(st, 0), { type: "offer", seat: 0, to: 1, item: "monocle" }, { type: "answer", seat: 1, accept: true, item: "watch1" });
  assert.equal(E.view(st, 0).knowledge.find((k) => k.k === "gang").gang, SB);
  assert.equal(E.view(st, 2).knowledge.length, 0);
  let r = noHypno(noSupport(skipAll(E.apply(onTurn(st, 0), { type: "attack", seat: 0, target: 1 }))));
  r = E.apply(r, { type: "show", seat: 0, items: [], trade: true });
  assert.equal(E.view(r, 3).seats[0].trade, "thug");
  assert.equal(E.view(r, 3).seats[1].trade, null);
});

// ---------- determinism and fuzz ----------
// A random legal move, with declarations kept rare so games run long enough
// to exercise everything, and made deliberately once in a while to end.
function randomAction(st, rng, seat, declareRate) {
  const acts = E.legalActions(st, seat);
  if (!acts.length) throw new Error(`no legal action for seat ${seat} in ${st.phase}/${st.scuffle?.step || st.trade?.step || ""}`);
  const declare = acts.find((a) => a.type === "declare");
  if (declare && rng.next() < declareRate) {
    // name a random set of other seats with random counts
    const holders = {};
    for (let s = 0; s < st.n; s++) if (s !== seat && rng.next() < 0.4) holders[s] = 1 + rng.int(2);
    return { ...declare, holders };
  }
  const rest = acts.filter((a) => a.type !== "declare" && (declareRate > 0 || a.type !== "solo"));
  return rest[rng.int(rest.length)];
}

function fuzzGame(seed, n, options, declareRate, maxSteps) {
  const rng = E.makeRng(seed * 7919 + n);
  let st = E.createGame(rng.int(2 ** 31), n, options);
  let steps = 0;
  const total = E.deckSize(n);
  while (st.phase !== "over" && steps < maxSteps) {
    const who = E.mustAct(st);
    assert.ok(who.length, `nobody to act in ${st.phase}`);
    const seat = who[rng.int(who.length)];
    st = E.apply(st, randomAction(st, rng, seat, declareRate));
    steps++;
    // invariants
    const inHands = st.seats.flatMap((s) => s.items);
    assert.equal(inHands.length + st.pile.length, total, "items are conserved");
    assert.equal(new Set([...inHands, ...st.pile]).size, total, "no item is in two places");
    if (st.phase === "turn") for (const s of st.seats) assert.ok(s.items.length <= E.HAND_LIMIT[n], "hand limit holds between turns");
    assert.equal(new Set([...st.seats.map((s) => s.trade), ...st.spareTrades]).size, 10, "trades are conserved");
    // the view never carries another seat's hidden cards
    if (steps % 7 === 0) for (let s = 0; s < n; s++) {
      const v = E.view(st, s);
      for (let o = 0; o < n; o++) if (o !== s && st.phase !== "over") {
        assert.equal(v.seats[o].gang, null);
        assert.equal(v.seats[o].hand, null);
        if (!st.seats[o].tradeRevealed) assert.equal(v.seats[o].trade, null);
      }
    }
  }
  return { st, steps };
}

test("determinism: the same seed and actions give the same state", () => {
  const a = fuzzGame(11, 6, {}, 0.02, 400);
  const b = fuzzGame(11, 6, {}, 0.02, 400);
  assert.deepEqual(a.st, b.st);
});

test("fuzz: random legal play at every count keeps every invariant and ends by declaration", () => {
  let ended = 0, byDeclare = 0, games = 0;
  for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) {
    for (let seed = 1; seed <= 25; seed++) {
      const { st } = fuzzGame(seed, n, { smuggling: seed % 2 === 0 }, 0.3, 1500);
      games++;
      if (st.phase === "over") { ended++; if (st.reason !== "solo") byDeclare++; assert.ok(st.winner !== null); }
    }
  }
  assert.ok(ended > games * 0.9, `most fuzz games end (${ended}/${games})`);
  assert.ok(byDeclare > 0);
});

test("fuzz: long games without declarations exercise trades and scuffles", () => {
  for (let n = 3; n <= 10; n += 1) {
    const { st, steps } = fuzzGame(100 + n, n, {}, 0, 500);
    assert.equal(steps, 500, `n=${n} ran the whole way`);
    assert.ok(st.log.some((e) => e.type === "scuffle"), "at least one scuffle");
    assert.ok(st.log.some((e) => e.type === "trade" && e.accepted), "at least one trade");
  }
});
