// The original's last-bag rule: a scuffle winner who takes the loser's last
// bag -- by taking it, by a porter handing it over, or by being paid a gold bar
// that was all the loser had -- gives one of their own back. Nobody sits at the
// table empty-handed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const DLC = { gold: true, double: true, porter: true, gambler: true };
const loserOf = (f) => (f.winner === f.attacker ? f.defender : f.attacker);

function* play(seed, n, options) {
  const rng = E.makeRng(seed);
  let st = E.createGame(rng.int(2 ** 31), n, options);
  let guard = 0;
  while (st.phase !== "over" && ++guard < 6000) {
    const who = E.mustAct(st);
    const seat = who[rng.int(who.length)];
    const action = B.decide(E.view(st, seat), E.legalActions(st, seat), "normal", rng);
    const next = E.apply(st, action);
    yield { st, action, next };
    st = next;
  }
}

test("last bag: taking it makes the winner give one back, and the log says so", () => {
  let seen = { take: 0, yield: 0, bribe: 0 };
  for (const [n, options] of [[4, {}], [6, {}], [6, { dlc: DLC }], [8, { dlc: DLC }]]) {
    for (let g = 0; g < 40; g++) {
      for (const { st, action, next } of play(31_000 + n * 100 + g, n, options)) {
        const f = st.scuffle;
        const kind = action.type === "takeItem" ? "take" : action.type === "yieldItem" ? "yield" : action.type === "bribe" && action.pay ? "bribe" : null;
        if (!kind || !f) continue;
        const loser = loserOf(f);
        if (st.seats[loser].items.length !== 1) {
          assert.notEqual(next.scuffle?.step, "giveBack", "no give-back while the loser still holds something");
          continue;
        }
        seen[kind]++;
        // the scuffle waits on the winner, who must hand back one of their own
        assert.equal(next.phase, "scuffle");
        assert.equal(next.scuffle.step, "giveBack");
        assert.deepEqual(E.mustAct(next), [f.winner]);
        const legal = E.legalActions(next, f.winner);
        assert.equal(legal.length, next.seats[f.winner].items.length, "any bag the winner holds, the one just taken included");
        assert.ok(legal.some((a) => a.item === (kind === "bribe" ? st.seats[loser].items[0] : action.item)));
        // nobody else may answer it, and an item the winner does not hold is refused
        assert.throws(() => E.apply(next, { ...legal[0], seat: loser }));
        const done = E.apply(next, legal[0]);
        assert.equal(done.seats[loser].items.length, 1);
        assert.ok(done.seats[loser].items.includes(legal[0].item));
        const entry = done.log.filter((e) => e.type === "scuffle").pop();
        assert.equal(entry.gaveBack, true);
        // the loser knows what came back; the winner knows what went
        assert.ok(done.knowledge[loser].some((k) => k.k === "got" && k.id === legal[0].item && k.from === f.winner));
        assert.ok(done.knowledge[f.winner].some((k) => k.k === "gave" && k.id === legal[0].item && k.to === loser));
      }
    }
  }
  assert.ok(seen.take > 20, "too few last-bag takes: " + seen.take);
  assert.ok(seen.yield > 0 && seen.bribe > 0, "porter and gold bar cases: " + JSON.stringify(seen));
});

test("last bag: at the start of every turn, every passenger holds at least one bag", () => {
  let turns = 0;
  for (const [n, options] of [[3, {}], [4, {}], [6, {}], [8, {}], [10, {}], [6, { dlc: DLC }], [9, { dlc: DLC, events: true }]]) {
    for (let g = 0; g < 25; g++) {
      for (const { next } of play(47_000 + n * 100 + g, n, options)) {
        if (next.phase !== "turn") continue;
        turns++;
        next.seats.forEach((sd, s) => assert.ok(sd.items.length >= 1, `seat ${s} is empty-handed at turn ${next.turnNo} (${n} players)`));
      }
    }
  }
  assert.ok(turns > 1000);
});
