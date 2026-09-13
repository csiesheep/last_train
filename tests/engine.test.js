// M0: the tables agree with the rulebook digest. The state machine, reducer,
// view projection and a fuzz over legal moves come with M1.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";

test("the luggage deck is 21 cards, 20 at three and at ten players", () => {
  assert.equal(E.deckSize(6), 21);
  assert.equal(E.deckSize(3), 20); // no black pearl
  assert.equal(E.deckSize(10), 20); // no cape: no spare trade to take
  assert.equal(E.ITEMS.filter((i) => i.goal === E.LAMPLIGHTERS)[0].count, 3);
  assert.equal(E.ITEMS.filter((i) => i.goal === E.KEYHOLDERS)[0].count, 3);
});

test("ten trades, hand limits and society cards for every count", () => {
  assert.equal(E.TRADES.length, 10);
  assert.equal(new Set(E.TRADES.map((t) => t.id)).size, 10);
  for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) {
    assert.ok(E.HAND_LIMIT[n] >= 5, `hand limit at ${n}`);
    assert.equal(E.SOCIETY_CARDS[n] % 2, 0, `society cards come in pairs at ${n}`);
    assert.equal(E.SOCIETY_CARDS[n] - n, E.isOdd(n) ? 1 : 0, `one card out at odd counts (${n})`);
  }
});
