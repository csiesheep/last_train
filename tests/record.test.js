// The exported game: a full record replays to the very same end, through a
// JSON round trip, with and without the expansion and the stop events.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { buildRecord, replay, cleanAction, finalTable, resultOf, FORMAT } from "../public/shared/record.js";

const DLC = Object.fromEntries(E.EXPANSIONS.map((k) => [k, true]));

function playRecorded(seed, n, options) {
  const rng = E.makeRng(seed * 13 + 5);
  let st = E.createGame(seed, n, options);
  const actions = [];
  let guard = 0;
  while (st.phase !== "over" && ++guard < 6000) {
    const who = E.mustAct(st);
    const seat = who[rng.int(who.length)];
    const a = B.decide(E.view(st, seat), E.legalActions(st, seat), "normal", rng);
    actions.push(cleanAction(st.turnNo, a));
    st = E.apply(st, a);
  }
  return { st, actions };
}

const record = (st, seed, n, options, actions, scope = "full") => buildRecord({
  exportedAt: "2026-09-25T00:00:00Z", build: "test", mode: "solo", scope, lang: "en",
  seed, n, options, actions, passengers: Array.from({ length: n }, (_, seat) => ({ seat, name: "P" + seat })),
  result: resultOf(st), final: finalTable(st), log: st.log, me: 0, notes: st.knowledge[0],
});

test("record: a full record replays, through JSON, to the same end", () => {
  let games = 0;
  for (const [n, options] of [[3, {}], [6, { events: true }], [8, { dlc: DLC }], [10, { dlc: DLC, events: true, smuggling: true }]]) {
    for (let g = 0; g < 6; g++) {
      const seed = 81_000 + n * 50 + g;
      const { st, actions } = playRecorded(seed, n, options);
      assert.equal(st.phase, "over");
      const rec = JSON.parse(JSON.stringify(record(st, seed, n, options, actions)));
      assert.equal(rec.format, FORMAT);
      const again = replay(rec);
      assert.equal(again.phase, "over");
      assert.equal(again.winner, st.winner);
      assert.equal(again.turnNo, st.turnNo);
      assert.deepEqual(finalTable(again), rec.final);
      assert.deepEqual(again.log, st.log);
      games++;
    }
  }
  assert.equal(games, 24);
});

test("record: a record of one seat's view has no seed and no moves, and cannot be replayed", () => {
  const { st, actions } = playRecorded(5, 5, {});
  const rec = record(st, 5, 5, {}, actions, "seat");
  assert.equal(rec.seed, undefined);
  assert.equal(rec.actions, undefined);
  assert.ok(Array.isArray(rec.notes) && rec.log.length > 0);
  assert.throws(() => replay(rec));
});

test("record: a bot's reasons are not part of its move", () => {
  assert.deepEqual(cleanAction(4, { seat: 1, type: "pass", why: "wait", p: 0.4 }), { t: 4, seat: 1, type: "pass" });
});
