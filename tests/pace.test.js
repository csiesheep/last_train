// The table's pacing: every move is sorted by what it put on screen, and the
// wait after it follows from that. Played through seeded bot games.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { DWELL, moveTier, louder } from "../public/shared/pace.js";

function* moves(games, n) {
  for (let g = 0; g < games; g++) {
    const rng = E.makeRng(7000 + g);
    let st = E.createGame(rng.int(2 ** 31), n, {});
    let guard = 0;
    while (st.phase !== "over" && ++guard < 6000) {
      const who = E.mustAct(st);
      const seat = who[rng.int(who.length)];
      const action = B.decide(E.view(st, seat), E.legalActions(st, seat), "normal", rng);
      const after = E.apply(st, action);
      yield { before: st, after, action, tier: moveTier(st, after) };
      st = after;
    }
  }
}

test("pace: every move lands in a known tier, and each tier turns up", () => {
  const seen = {};
  for (const m of moves(12, 6)) {
    assert.ok(m.tier in DWELL, "unknown tier " + m.tier);
    seen[m.tier] = (seen[m.tier] || 0) + 1;
  }
  for (const k of ["silent", "support", "begin", "shown", "normal", "big"]) assert.ok(seen[k] > 0, "never saw " + k);
});

test("pace: the move that settles a scuffle is big, a pass is small, a declared side is support", () => {
  let checked = { big: 0, small: 0, support: 0, begin: 0 };
  for (const { before, after, action, tier } of moves(8, 5)) {
    const added = after.log.slice(before.log.length);
    if (added.some((e) => e.type === "scuffle")) { assert.equal(tier, "big"); checked.big++; }
    else if (action.type === "pass") { assert.equal(tier, "small"); checked.small++; }
    else if (before.phase === "scuffle" && before.scuffle.step === "support" && !added.length) { assert.equal(tier, "support"); checked.support++; }
    else if (before.phase === "turn" && after.phase === "scuffle" && !added.length) { assert.equal(tier, "begin"); checked.begin++; }
  }
  for (const [k, c] of Object.entries(checked)) assert.ok(c > 0, "no case of " + k);
});

test("pace: a silent move waits less than any move that showed something, and louder keeps the longest", () => {
  for (const k of Object.keys(DWELL)) if (k !== "silent") assert.ok(DWELL.silent < DWELL[k], k);
  assert.equal(louder("silent", "big"), "big");
  assert.equal(louder("big", "support"), "big");
  assert.equal(louder("shown", "support"), "shown");
});
