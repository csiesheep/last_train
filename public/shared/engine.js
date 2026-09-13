// The rules of the game, and nothing else. Pure functions over a plain
// state object; no DOM, no network, no timers. Used unchanged by the browser
// (solo mode) and by the room Durable Object (multiplayer), which is why the
// per-seat `view()` will live here too: whoever holds the full state must
// never send it, only what that seat may see.
//
// M0 ships only the tables. The state machine, reducer, `view()` and the
// seeded RNG arrive in M1; see the plan note for the shape.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

// The two societies and what each collects.
export const LAMPLIGHTERS = "lamplighters"; // three lamps
export const KEYHOLDERS = "keyholders";     // three keys
export const NEEDED = 3;

// Items a passenger may carry, by player count.
export const HAND_LIMIT = { 3: 8, 4: 6, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5 };

// Society cards shuffled in per count: equal halves; at odd counts one card
// of the pair is left out unseen, so one side has one more member and
// nobody knows which.
export const SOCIETY_CARDS = { 3: 4, 4: 4, 5: 6, 6: 6, 7: 8, 8: 8, 9: 10, 10: 10 };
export const isOdd = (n) => n % 2 === 1;

// The 21 luggage cards. `trade` texts fire for the giver when the card is
// traded on; `fight` texts apply in a fight. Effects are keys the engine
// interprets in M1; the deck itself is data so expansions can add to it.
export const ITEMS = [
  { id: "lamp", count: 3, goal: LAMPLIGHTERS },
  { id: "key", count: 3, goal: KEYHOLDERS },
  { id: "chest_lamp", count: 1, trade: "draw", becomes: "lamp" },
  { id: "chest_key", count: 1, trade: "draw", becomes: "key" },
  { id: "dagger", count: 1, fight: "attack+1" },
  { id: "bracers", count: 1, fight: "defend+1" },
  { id: "poison_ring", count: 1, fight: "win_ties" },
  { id: "knives", count: 1, fight: "support_attacker+1" },
  { id: "whip", count: 1, fight: "support_defender+1" },
  { id: "tome", count: 1, trade: "swap_trades" },
  { id: "cape", count: 1, trade: "new_trade", notAt: [10] },
  { id: "warrant", count: 1, trade: "see_items" },
  { id: "demon_mirror", count: 1, trade: "see_society" },
  { id: "compass", count: 1, trade: "everyone_passes" },
  { id: "black_pearl", count: 1, mustAccept: true, blocksDeclare: true, notAt: [3] },
  { id: "broken_mirror", count: 1, mustAccept: true, silent: true },
  { id: "token", count: 1, solo: true },
];

// The ten trades ("行當"), one each, dealt face down.
export const TRADES = [
  { id: "envoy", once: true },        // demand a named item in a forced trade
  { id: "physician", once: true },    // cancel a fight's outcome
  { id: "swordsman", once: true },    // nobody may support this fight
  { id: "apothecary", once: true },   // decide a fight you are not in
  { id: "old_master" },               // +1 as defender
  { id: "soothsayer", once: true },   // look at the pile, put two on top
  { id: "mesmerist" },                // as attacker, name one who stays out
  { id: "escort" },                   // the side you support gets +1
  { id: "monk", once: true },         // stop a fight before support
  { id: "bruiser" },                  // +1 as attacker
];

export const deckSize = (n) => ITEMS.filter((it) => !(it.notAt || []).includes(n)).reduce((s, it) => s + it.count, 0);
