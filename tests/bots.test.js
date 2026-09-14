// The bots: every move they make is one the engine listed, games they play
// end, and the beliefs behave (peeks become certainties, distributions sum to
// one, a bot that knows everything declares with confidence one).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { playGame } from "./sim.js";

const { TIMEKEEPERS: TK, SEALBEARERS: SB } = E;
const ready = (st) => { for (let s = 0; s < st.n; s++) st = E.apply(st, { type: "ready", seat: s }); return st; };

test("bots only ever pick a listed legal action, at every level and count, and their games end", () => {
  for (const level of B.LEVELS) {
    for (let n = 3; n <= 10; n++) {
      for (let seed = 1; seed <= 3; seed++) {
        const rng = E.makeRng(seed * 31 + n);
        let st = ready(E.createGame(seed, n, { smuggling: seed === 2 }));
        let steps = 0;
        while (st.phase !== "over" && steps < 4000) {
          const who = E.mustAct(st);
          const seat = who[rng.int(who.length)];
          const legal = E.legalActions(st, seat);
          const a = B.decide(E.view(st, seat), legal, level, rng);
          assert.ok(a, `no action at ${st.phase}`);
          assert.ok(typeof a.why === "string" && a.why.length, "every decision says why");
          // every field the engine listed must match; the bot may add `why`,
          // `p` and, under smuggling, `announce`
          const matches = (l) => Object.entries(l).every(([k, v]) => JSON.stringify(a[k]) === JSON.stringify(v));
          if (a.type === "declare") assert.ok(legal.some((l) => l.type === "declare"));
          else assert.ok(legal.some(matches), `unlisted ${JSON.stringify(a)} in ${st.phase}`);
          st = E.apply(st, a);
          steps++;
        }
        assert.equal(st.phase, "over", `${level} n=${n} seed=${seed} ended (${steps} steps)`);
      }
    }
  }
});

test("gang belief: own seat is certain, a peeked gang becomes a certainty, sizes add up", () => {
  let st = ready(E.createGame(5, 6));
  st.seats[0].gang = TK; st.seats[1].gang = SB; st.seats[2].gang = TK;
  st.gangSizes = { [TK]: 3, [SB]: 3 };
  const v0 = E.view(st, 0);
  const g = B.gangBelief(v0);
  assert.equal(g.ally[0], 1);
  const sum = g.ally.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 3) < 1e-9, "expected allies including me = gang size");
  st.knowledge[0].push({ k: "gang", seat: 1, gang: SB, at: 1 }, { k: "gang", seat: 2, gang: TK, at: 1 });
  const g2 = B.gangBelief(E.view(st, 0));
  assert.equal(g2.ally[1], 0);
  assert.equal(g2.ally[2], 1);
  assert.equal(g2.pMinority, 0);
  // odd count: one side is short and the bot does not know which
  const odd = ready(E.createGame(7, 5));
  const go = B.gangBelief(E.view(odd, 0));
  assert.ok(go.pMinority > 0.3 && go.pMinority < 0.7);
});

test("gang belief: backing someone in a scuffle raises the odds they are on your side", () => {
  let st = ready(E.createGame(9, 6));
  st.log.push({ t: 2, type: "scuffle", attacker: 1, defender: 2, support: { 3: "attacker", 4: "defender" }, shown: {}, winner: 1, tie: false, choice: "peek" });
  const g = B.gangBelief(E.view(st, 1));
  assert.ok(g.ally[3] > g.ally[4], "the seat that backed me looks friendlier than the one against");
  assert.ok(g.ally[3] > g.ally[2], "and friendlier than the one I attacked");
});

test("item belief: each item sums to one, a seen hand pins it, my own hand is certain", () => {
  let st = ready(E.createGame(3, 5));
  st.seats[0].items = ["watch1", "dagger"]; st.seats[1].items = ["watch2"]; st.seats[2].items = ["seal1"]; st.seats[3].items = ["watch3"]; st.seats[4].items = ["gloves"];
  st.pile = Object.keys(st.items).filter((id) => !st.seats.some((s) => s.items.includes(id)));
  const v = E.view(st, 0);
  const bel = B.itemBelief(v, TK);
  for (const p of Object.values(bel)) assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(bel.watch1[0], 1);
  assert.equal(bel.watch2[0], 0);
  st.knowledge[0].push({ k: "hand", seat: 3, items: [{ id: "watch3", kind: "watch" }], at: 2 });
  const b2 = B.itemBelief(E.view(st, 0), TK);
  assert.equal(b2.watch3[3], 1);
  assert.equal(b2.watch2[3], 0, "a seen hand rules the others out there");
  assert.ok(B.pAtLeast(b2, 3, 1) === 1);
  assert.ok(B.pAtLeast(b2, 3, 2) === 0);
});

test("declaring: a bot that has seen everything claims with confidence one; one that knows nothing does not declare", () => {
  let st = ready(E.createGame(4, 4));
  st.seats.forEach((s, i) => { s.gang = i < 2 ? TK : SB; });
  st.gangSizes = { [TK]: 2, [SB]: 2 };
  st.seats[0].items = ["watch1"]; st.seats[1].items = ["watch2", "watch3"]; st.seats[2].items = ["seal1"]; st.seats[3].items = ["seal2"];
  st.pile = Object.keys(st.items).filter((id) => !st.seats.some((s) => s.items.includes(id)));
  st.turn = 0;
  st.knowledge[0].push({ k: "gang", seat: 1, gang: TK, at: 1 }, { k: "hand", seat: 1, items: [{ id: "watch2", kind: "watch" }, { id: "watch3", kind: "watch" }], at: 1 });
  const rng = E.makeRng(1);
  const a = B.decide(E.view(st, 0), E.legalActions(st, 0), "hard", rng);
  assert.equal(a.type, "declare");
  assert.deepEqual(a.holders, { 1: 2 });
  assert.ok(a.p > 0.999);
  const r = E.apply(st, a);
  assert.equal(r.winner, TK);

  st.knowledge[0] = [];
  let declared = 0;
  for (let i = 0; i < 20; i++) if (B.decide(E.view(st, 0), E.legalActions(st, 0), "normal", E.makeRng(i)).type === "declare") declared++;
  assert.equal(declared, 0, "no blind declarations at normal");
});

test("harness: a full game plays through and reports a winner", () => {
  const { st, stalled, steps } = playGame(3, 6, "normal", "normal");
  assert.equal(stalled, false);
  assert.equal(st.phase, "over");
  assert.ok(steps > 10);
});
