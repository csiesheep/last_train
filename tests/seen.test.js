// "Who has seen whom" is worked out from the public log. Checked against the
// engine's own record of what every seat learned: the log must never claim a
// look that did not happen, and every look the engine recorded must show.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { looksFromLog, isStale } from "../public/shared/seen.js";

function play(seed, n, options = {}) {
  const rng = E.makeRng(seed);
  let st = E.createGame(rng.int(2 ** 31), n, options);
  let guard = 0;
  // stop before the end: at game over every card is on the table anyway
  while (st.phase !== "over" && ++guard < 6000) {
    const who = E.mustAct(st);
    const seat = who[rng.int(who.length)];
    const next = E.apply(st, B.decide(E.view(st, seat), E.legalActions(st, seat), "normal", rng));
    if (next.phase === "over") break;
    st = next;
  }
  return st;
}

const facts = (st) => st.knowledge.flatMap((list, by) => list.filter((k) => k.k === "gang" || k.k === "trade").map((k) => ({ by, of: k.seat, what: k.k, at: k.at })));

test("seen: every look read from the log is one the engine recorded, and none is missing", () => {
  let looks = 0, games = 0;
  for (const [n, dlc] of [[4, false], [6, false], [8, false], [6, true], [9, true]]) {
    for (let g = 0; g < 25; g++) {
      const st = play(50_000 + n * 100 + g, n, dlc ? { dlc: { gold: true, double: true, porter: true, gambler: true } } : {});
      games++;
      const derived = [...looksFromLog(st.log).values()];
      const known = facts(st);
      for (const l of derived) {
        assert.ok(known.some((k) => k.by === l.by && k.of === l.of && k.what === l.what && k.at === l.at),
          `log says seat ${l.by} saw seat ${l.of}'s ${l.what} at turn ${l.at} (${l.via}); the engine has no such fact`);
        looks++;
      }
      // the latest fact per looker/looked-at/card must be found in the log
      const latest = new Map();
      for (const k of known) { const key = k.by + "|" + k.of + "|" + k.what; if (!latest.has(key) || latest.get(key).at <= k.at) latest.set(key, k); }
      for (const k of latest.values()) {
        assert.ok(derived.some((l) => l.by === k.by && l.of === k.of && l.what === k.what && l.at === k.at),
          `seat ${k.by} learned seat ${k.of}'s ${k.what} at turn ${k.at}, and the log does not show it`);
      }
    }
  }
  assert.ok(looks > 50, "too few looks to mean anything: " + looks + " over " + games + " games");
});

test("seen: a trade looked at before a codebook swap is marked out of date", () => {
  const log = [
    { t: 3, type: "scuffle", choice: "peek", attacker: 0, defender: 1, winner: 0 },
    { t: 7, type: "codebook", seat: 1, partner: 2, swapped: true },
  ];
  const looks = looksFromLog(log);
  const gang = looks.get("0|1|gang"), trade = looks.get("0|1|trade");
  assert.equal(isStale(gang, log), false, "a gang card never changes");
  assert.equal(isStale(trade, log), true);
  assert.equal(isStale(looks.get("1|2|trade"), log), false, "the swap itself is a fresh look");
});
