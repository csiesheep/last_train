// The rules of the game, and nothing else. Pure functions over a plain
// state object; no DOM, no network, no timers. Used unchanged by the browser
// (solo mode) and by the room Durable Object (multiplayer), which is why the
// per-seat `view()` lives here too: whoever holds the full state must never
// send it, only what that seat may see.
//
// Seats are integers 0..n-1 around the carriage, clockwise. Item *instances*
// have ids ("watch1", "dagger"); `state.items[id]` is the kind. Every
// decision that would reveal who holds a hidden trade is a window that every
// eligible seat answers, so waiting on someone never says what they hold.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

// The two gangs and what each collects.
export const TIMEKEEPERS = "timekeepers"; // three pocket watches (懷錶)
export const SEALBEARERS = "sealbearers"; // three jade seals (玉印)
export const GANGS = [TIMEKEEPERS, SEALBEARERS];
export const NEEDED = 3;
export const GOAL = { [TIMEKEEPERS]: "watch", [SEALBEARERS]: "seal" };
export const other = (g) => (g === TIMEKEEPERS ? SEALBEARERS : TIMEKEEPERS);

// Items a passenger may carry, by player count.
export const HAND_LIMIT = { 3: 8, 4: 6, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5 };

// Gang cards shuffled in per count: equal halves; at odd counts one card of
// the pair is left out unseen, so one side has one more member and nobody
// knows which.
export const GANG_CARDS = { 3: 4, 4: 4, 5: 6, 6: 6, 7: 8, 8: 8, 9: 10, 10: 10 };
export const isOdd = (n) => n % 2 === 1;

// The 21 luggage cards. `trade` texts fire for the giver when the card is
// traded on; `fight` texts apply in a scuffle. The deck is data so
// expansions can add to it.
export const ITEMS = [
  { id: "watch", count: 3, goal: TIMEKEEPERS },
  { id: "seal", count: 3, goal: SEALBEARERS },
  { id: "case_watch", count: 1, trade: "draw", becomes: "watch" },
  { id: "case_seal", count: 1, trade: "draw", becomes: "seal" },
  { id: "dagger", count: 1, fight: "attack+1" },
  { id: "gloves", count: 1, fight: "defend+1" },
  { id: "poison_ring", count: 1, fight: "win_ties" },
  { id: "knives", count: 1, fight: "support_attacker+1" },
  { id: "cane", count: 1, fight: "support_defender+1" },
  { id: "codebook", count: 1, trade: "swap_trades" },
  { id: "trench_coat", count: 1, trade: "new_trade", notAt: [10] },
  { id: "warrant", count: 1, trade: "see_items" },
  { id: "monocle", count: 1, trade: "see_gang" },
  { id: "timetable", count: 1, trade: "everyone_passes" },
  { id: "black_letter", count: 1, mustAccept: true, blocksDeclare: true, notAt: [3] },
  { id: "broken_mirror", count: 1, mustAccept: true, silent: true },
  { id: "first_class_ticket", count: 1, solo: true },
];
export const ITEM_BY_KIND = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

// The ten trades (行當), one each, dealt face down.
export const TRADES = [
  { id: "diplomat", once: true },       // demand a named item in a forced trade
  { id: "doctor", once: true },         // cancel a scuffle's outcome
  { id: "gunman", once: true },         // nobody may support this scuffle
  { id: "pharmacist", once: true },     // decide a scuffle you are not in
  { id: "master" },                     // +1 as defender
  { id: "fortune_teller", once: true }, // look at the pile, put two on top
  { id: "hypnotist" },                  // as attacker, name one who stays out
  { id: "bodyguard" },                  // the side you support gets +1
  { id: "priest", once: true },         // stop a scuffle before support
  { id: "thug" },                       // +1 as attacker
];
export const TRADE_IDS = TRADES.map((t) => t.id);
export const TRADE_BY_ID = Object.fromEntries(TRADES.map((t) => [t.id, t]));

export const deckSize = (n) => ITEMS.filter((it) => !(it.notAt || []).includes(n)).reduce((s, it) => s + it.count, 0);

// ---------- seeded RNG (mulberry32), so a game replays from seed + actions ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(k) { return Math.floor(this.next() * k); },
    getState() { return a; },
    setState(s) { a = s >>> 0; },
  };
}
export const randomSeed = () => (Math.random() * 0xffffffff) >>> 0;

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The state is plain JSON, so this is a complete copy. Chosen over
// structuredClone, which crashed V8 (Node 24) under the bot harness.
export const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- game creation ----------
export function createGame(seed, n, options = {}) {
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${n}`);
  }
  const rng = makeRng(seed);

  // Gangs: equal halves; at odd counts one card of the last pair stays out.
  const half = GANG_CARDS[n] / 2;
  const gangCards = shuffle(rng, [...Array(half).fill(TIMEKEEPERS), ...Array(half).fill(SEALBEARERS)]).slice(0, n);
  const gangSizes = { [TIMEKEEPERS]: 0, [SEALBEARERS]: 0 };
  for (const g of gangCards) gangSizes[g]++;
  const minority = isOdd(n) ? (gangSizes[TIMEKEEPERS] < gangSizes[SEALBEARERS] ? TIMEKEEPERS : SEALBEARERS) : null;

  // Trades: one each, the rest stay in the box (the trench coat draws from them).
  const trades = shuffle(rng, TRADE_IDS);
  const dealtTrades = trades.slice(0, n);
  const spareTrades = trades.slice(n);

  // Items: instances by kind; both cases plus n-2 (or 2n-2 at three) random
  // others are dealt, the rest is the face-down pile (top = last).
  const items = {};
  const all = [];
  for (const it of ITEMS) {
    if ((it.notAt || []).includes(n)) continue;
    for (let i = 1; i <= it.count; i++) {
      const id = it.count > 1 ? `${it.id}${i}` : it.id;
      items[id] = it.id;
      all.push(id);
    }
  }
  const cases = all.filter((id) => items[id].startsWith("case_"));
  const rest = shuffle(rng, all.filter((id) => !items[id].startsWith("case_")));
  const each = n === 3 ? 2 : 1;
  const dealt = shuffle(rng, [...cases, ...rest.slice(0, n * each - 2)]);
  const pile = rest.slice(n * each - 2);

  const seats = [];
  for (let s = 0; s < n; s++) {
    seats.push({
      gang: gangCards[s],
      trade: dealtTrades[s],
      tradeUsed: false,
      tradeRevealed: false,
      items: dealt.slice(s * each, s * each + each),
      drink: isOdd(n),
    });
  }

  return {
    seed, n,
    options: { smuggling: !!options.smuggling, gunmanBonus: !!options.gunmanBonus },
    phase: "reveal",          // reveal | turn | peek | trade | scuffle | handLimit | over
    ready: new Array(n).fill(false),
    turn: rng.int(n),         // whose turn it is
    turnNo: 0,
    seats, items, pile, spareTrades, gangSizes, minority,
    knowledge: Array.from({ length: n }, () => []),
    trade: null, scuffle: null, peek: null,
    pending: [],              // seats over the hand limit, in order
    after: null,              // where a hand-limit interrupt returns to
    log: [],
    winner: null,             // a gang, or a seat number for a solo win
    reason: null,             // "declared" | "wrong" | "solo"
    event: null,
    rngState: rng.getState(),
  };
}

// ---------- small helpers ----------
export const kindOf = (st, id) => st.items[id];
export const nextSeat = (st, s) => (s + 1) % st.n;
export const prevSeat = (st, s) => (s + st.n - 1) % st.n;
export const handLimit = (st) => HAND_LIMIT[st.n];
const hand = (st, s) => st.seats[s].items;
const has = (st, s, id) => hand(st, s).includes(id);
const kinds = (st, ids) => ids.map((id) => st.items[id]);
const holdsKind = (st, s, kind) => hand(st, s).find((id) => st.items[id] === kind) || null;
const isCase = (kind) => kind === "case_watch" || kind === "case_seal";
const tradeText = (st, id) => ITEM_BY_KIND[st.items[id]].trade || null;

// What a goal item is worth toward a gang: the kind itself, or a sealed case
// once the pile is empty.
export function goalKindOf(st, id) {
  const k = st.items[id];
  if (k === "watch" || k === "seal") return k;
  if (isCase(k) && st.pile.length === 0) return ITEM_BY_KIND[k].becomes;
  return null;
}
export const goalCount = (st, seat, gang) => hand(st, seat).filter((id) => goalKindOf(st, id) === GOAL[gang]).length;

function withRng(st, fn) {
  const rng = makeRng(0);
  rng.setState(st.rngState);
  const out = fn(rng);
  st.rngState = rng.getState();
  return out;
}

function learn(st, seat, fact) {
  st.knowledge[seat].push({ ...fact, at: st.turnNo });
}
function log(st, entry) {
  st.log.push({ t: st.turnNo, ...entry });
}
function revealTrade(st, seat) {
  const sd = st.seats[seat];
  sd.tradeRevealed = true;
  if (TRADE_BY_ID[sd.trade].once) sd.tradeUsed = true;
}
function moveItem(st, id, from, to) {
  const h = hand(st, from);
  const i = h.indexOf(id);
  if (i < 0) throw new Error(`seat ${from} does not hold ${id}`);
  h.splice(i, 1);
  if (to !== null) hand(st, to).push(id);
}
function draw(st, seat) {
  if (!st.pile.length) return null;
  const id = st.pile.pop();
  hand(st, seat).push(id);
  return id;
}

// A seat can be skipped in a window without saying anything when the table
// already knows its trade is not the one in question, or is spent.
function canHold(st, seat, power) {
  const sd = st.seats[seat];
  if (!sd.tradeRevealed) return true;
  return sd.trade === power && !sd.tradeUsed;
}
function hasPower(st, seat, power) {
  const sd = st.seats[seat];
  return sd.trade === power && !(TRADE_BY_ID[power].once && sd.tradeUsed);
}

// ---------- who must act ----------
export function mustAct(st) {
  switch (st.phase) {
    case "reveal": return st.ready.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
    case "turn": return [st.turn];
    case "peek": return [st.turn];
    case "handLimit": return st.pending.length ? [st.pending[0]] : [];
    case "trade": {
      const t = st.trade;
      if (t.step === "answer") return [t.to];
      if (t.step === "return") return [t.from];
      if (t.step === "codebook" || t.step === "coat" || t.step === "direction") return [t.actor];
      if (t.step === "passItems") return Object.keys(t.passes).map(Number).filter((s) => t.passes[s] === null);
      return [];
    }
    case "scuffle": {
      const f = st.scuffle;
      switch (f.step) {
        case "priest": case "gunman": case "doctor":
          return f.window.filter((s) => !f.answered.includes(s));
        case "priestPay": return [f.attacker];
        case "support": return [f.next];
        case "hypnotist": return [f.attacker];
        case "powers": return f.window.filter((s) => !f.answered.includes(s));
        case "choice": case "take": return [f.winner];
        default: return [];
      }
    }
    default: return [];
  }
}

// ---------- the reducer ----------
// Returns a new state; the input is never mutated. Illegal actions throw, and
// the message says why, so the UI can gate buttons with the same checks.
export function apply(prev, action) {
  const st = clone(prev);
  st.event = null;
  const seat = action.seat;
  const checkSeat = (s = seat) => {
    if (!Number.isInteger(s) || s < 0 || s >= st.n) throw new Error(`bad seat ${s}`);
  };
  const needPhase = (p) => {
    if (st.phase !== p) throw new Error(`cannot ${action.type} during ${st.phase}`);
  };
  const needTurn = () => {
    needPhase("turn"); checkSeat();
    if (seat !== st.turn) throw new Error(`seat ${seat} is not on turn`);
  };
  const needMine = (id) => {
    if (!has(st, seat, id)) throw new Error(`seat ${seat} does not hold ${id}`);
  };

  switch (action.type) {
    case "ready": {
      needPhase("reveal"); checkSeat();
      st.ready[seat] = true;
      if (st.ready.every(Boolean)) {
        st.phase = "turn";
        st.turnNo = 1;
        log(st, { type: "start", first: st.turn });
      }
      return st;
    }

    // ---- a turn: pass / trade / scuffle / show your hand, plus the two
    //      trade powers that are used on your own turn ----
    case "pass": {
      needTurn();
      log(st, { type: "pass", seat });
      endTurn(st);
      return st;
    }
    case "fortune": {
      needTurn();
      if (!hasPower(st, seat, "fortune_teller")) throw new Error("no fortune teller to use");
      if (st.pile.length < 2) throw new Error("the pile is too small to arrange");
      revealTrade(st, seat);
      learn(st, seat, { k: "pile", items: st.pile.slice().reverse().map((id) => ({ id, kind: st.items[id] })) });
      st.peek = { seat };
      st.phase = "peek";
      log(st, { type: "fortune", seat });
      return st;
    }
    case "arrange": {
      needPhase("peek"); checkSeat();
      if (seat !== st.peek.seat) throw new Error("not your peek");
      const top = Array.isArray(action.top) ? action.top : [];
      if (top.length !== 2 || top[0] === top[1] || top.some((id) => !st.pile.includes(id))) throw new Error("pick two different cards from the pile");
      const rest = st.pile.filter((id) => !top.includes(id));
      // top[0] is drawn first, so it goes last in the array.
      st.pile = [...withRng(st, (rng) => shuffle(rng, rest)), top[1], top[0]];
      st.peek = null;
      st.phase = "turn";
      return st;
    }
    case "demand": {
      needTurn(); checkSeat(action.target);
      if (action.target === seat) throw new Error("demand from someone else");
      if (!hasPower(st, seat, "diplomat")) throw new Error("no diplomat to use");
      if (!ITEM_BY_KIND[action.kind]) throw new Error(`unknown item ${action.kind}`);
      if (!hand(st, seat).length) throw new Error("you need an item to trade back");
      revealTrade(st, seat);
      const id = holdsKind(st, action.target, action.kind);
      if (!id) {
        learn(st, seat, { k: "hand", seat: action.target, items: hand(st, action.target).map((x) => ({ id: x, kind: st.items[x] })) });
        log(st, { type: "demand", seat, target: action.target, kind: action.kind, had: false });
        endTurn(st);
        return st;
      }
      log(st, { type: "demand", seat, target: action.target, kind: action.kind, had: true });
      // A forced trade: the target hands the item over, the diplomat picks
      // what goes back. Trade texts fire as in any trade.
      st.trade = { from: seat, to: action.target, offered: null, wanted: id, forced: true, step: "return", announce: {}, actor: null, passes: null, dir: null, texts: [] };
      st.phase = "trade";
      return st;
    }
    case "offer": {
      needTurn(); checkSeat(action.to);
      if (action.to === seat) throw new Error("trade with someone else");
      needMine(action.item);
      if (!hand(st, action.to).length) throw new Error(`seat ${action.to} has nothing to trade back`);
      st.trade = { from: seat, to: action.to, offered: action.item, wanted: null, forced: false, step: "answer",
        announce: { [seat]: st.options.smuggling ? !!action.announce : true }, actor: null, passes: null, dir: null, texts: [] };
      learn(st, action.to, { k: "offered", from: seat, id: action.item, kind: st.items[action.item] });
      st.phase = "trade";
      return st;
    }
    case "answer": {
      needPhase("trade"); checkSeat();
      const t = st.trade;
      if (t.step !== "answer" || seat !== t.to) throw new Error("not your trade to answer");
      const offeredKind = st.items[t.offered];
      if (!action.accept) {
        if (ITEM_BY_KIND[offeredKind].mustAccept && legalReturns(st, seat, offeredKind).length) throw new Error(`${offeredKind} must be accepted`);
        log(st, { type: "trade", from: t.from, to: t.to, accepted: false });
        st.trade = null;
        endTurn(st);
        return st;
      }
      needMine(action.item);
      if (!legalReturns(st, seat, offeredKind).includes(action.item)) throw new Error("a case may not be traded for the other case");
      t.announce[seat] = st.options.smuggling ? !!action.announce : true;
      swap(st, t.from, t.to, t.offered, action.item);
      return st;
    }
    case "give": {
      // The diplomat's return, or the attacker paying the priest.
      checkSeat(); needMine(action.item);
      if (st.phase === "trade" && st.trade.step === "return" && seat === st.trade.from) {
        const t = st.trade;
        if (!legalReturns(st, seat, st.items[t.wanted]).includes(action.item)) throw new Error("a case may not be traded for the other case");
        t.announce = { [t.from]: true, [t.to]: true };
        // From the target's side the wanted item is what they "give".
        swap(st, t.to, t.from, t.wanted, action.item);
        return st;
      }
      if (st.phase === "scuffle" && st.scuffle.step === "priestPay" && seat === st.scuffle.attacker) {
        const f = st.scuffle;
        moveItem(st, action.item, seat, f.priest);
        learn(st, f.priest, { k: "got", from: seat, id: action.item, kind: st.items[action.item] });
        log(st, { type: "scuffle", attacker: f.attacker, defender: f.defender, stopped: f.priest, paid: true });
        st.scuffle = null;
        overLimit(st, f.priest);
        endTurn(st);
        return st;
      }
      throw new Error(`nothing to give during ${st.phase}`);
    }
    case "codebook": {
      needPhase("trade"); checkSeat();
      const t = st.trade;
      if (t.step !== "codebook" || seat !== t.actor) throw new Error("not your codebook");
      const partner = seat === t.from ? t.to : t.from;
      if (action.swap) {
        const a = st.seats[seat], b = st.seats[partner];
        const mine = a.trade;
        learn(st, seat, { k: "trade", seat: partner, trade: mine });
        learn(st, partner, { k: "trade", seat, trade: b.trade });
        [a.trade, b.trade] = [b.trade, a.trade];
        for (const x of [a, b]) { x.tradeUsed = false; x.tradeRevealed = false; }
      }
      log(st, { type: "codebook", seat, partner, swapped: !!action.swap });
      t.step = null;
      continueTexts(st);
      return st;
    }
    case "coat": {
      needPhase("trade"); checkSeat();
      const t = st.trade;
      if (t.step !== "coat" || seat !== t.actor) throw new Error("not your coat");
      if (action.trade != null) {
        const i = st.spareTrades.indexOf(action.trade);
        if (i < 0) throw new Error(`${action.trade} is not among the spare trades`);
        const sd = st.seats[seat];
        st.spareTrades.splice(i, 1, sd.trade);
        sd.trade = action.trade;
        sd.tradeUsed = false;
        sd.tradeRevealed = false;
      }
      log(st, { type: "coat", seat, changed: action.trade != null });
      t.step = null;
      continueTexts(st);
      return st;
    }
    case "direction": {
      needPhase("trade"); checkSeat();
      const t = st.trade;
      if (t.step !== "direction" || seat !== t.actor) throw new Error("not your timetable");
      if (action.dir !== "left" && action.dir !== "right") throw new Error("direction is left or right");
      t.dir = action.dir;
      t.passes = {};
      for (let s = 0; s < st.n; s++) if (hand(st, s).length) t.passes[s] = null;
      t.step = "passItems";
      log(st, { type: "timetable", seat, dir: action.dir });
      settlePasses(st);
      return st;
    }
    case "passItem": {
      needPhase("trade"); checkSeat();
      const t = st.trade;
      if (t.step !== "passItems" || !(seat in t.passes) || t.passes[seat] !== null) throw new Error("not passing now");
      needMine(action.item);
      t.passes[seat] = action.item;
      settlePasses(st);
      return st;
    }

    // ---- a scuffle ----
    case "attack": {
      needTurn(); checkSeat(action.target);
      if (action.target === seat) throw new Error("attack someone else");
      st.scuffle = {
        attacker: seat, defender: action.target, step: "priest",
        window: [], answered: [], priest: null, gunman: null, hypnotized: null,
        support: {}, next: null, shown: {}, pharmacist: null, doctor: null,
        swords: 0, shields: 0, winner: null, tie: false, drew: false, choice: null,
      };
      st.phase = "scuffle";
      openWindow(st, "priest", allBut(st, [seat]));
      return st;
    }
    case "window": {
      needPhase("scuffle"); checkSeat();
      const f = st.scuffle;
      if (!["priest", "gunman", "doctor"].includes(f.step)) throw new Error(`no window open (${f.step})`);
      if (!f.window.includes(seat) || f.answered.includes(seat)) throw new Error("not your window");
      f.answered.push(seat);
      if (action.use) {
        if (!hasPower(st, seat, f.step)) throw new Error(`no ${f.step} to use`);
        revealTrade(st, seat);
        if (f.step === "priest") {
          f.priest = seat;
          if (hand(st, f.attacker).length >= 2) { f.step = "priestPay"; return st; }
          log(st, { type: "scuffle", attacker: f.attacker, defender: f.defender, stopped: seat, paid: false });
          st.scuffle = null;
          endTurn(st);
          return st;
        }
        if (f.step === "gunman") {
          f.gunman = seat;
          f.answered = f.window.slice(); // the other party's answer no longer matters
        }
        if (f.step === "doctor") {
          f.doctor = seat;
          f.answered = f.window.slice();
        }
      }
      settleScuffle(st);
      return st;
    }
    case "support": {
      needPhase("scuffle"); checkSeat();
      const f = st.scuffle;
      if (f.step !== "support" || seat !== f.next) throw new Error("not your turn to declare support");
      if (!["attacker", "defender", "out"].includes(action.side)) throw new Error("side is attacker, defender or out");
      f.support[seat] = action.side;
      f.next = nextDeclarer(st, seat);
      if (f.next === null) { f.step = "hypnotist"; settleScuffle(st); }
      return st;
    }
    case "hypnotize": {
      needPhase("scuffle"); checkSeat();
      const f = st.scuffle;
      if (f.step !== "hypnotist" || seat !== f.attacker) throw new Error("only the attacker may hypnotize now");
      if (action.target != null) {
        checkSeat(action.target);
        if (!hasPower(st, seat, "hypnotist")) throw new Error("no hypnotist to use");
        if (action.target === seat || action.target === f.defender) throw new Error("hypnotize a bystander or supporter");
        revealTrade(st, seat);
        f.hypnotized = action.target;
        f.support[action.target] = "out";
      }
      openPowers(st);
      return st;
    }
    case "show": {
      needPhase("scuffle"); checkSeat();
      const f = st.scuffle;
      if (f.step !== "powers" || !f.window.includes(seat) || f.answered.includes(seat)) throw new Error("not your powers window");
      const role = roleIn(f, seat);
      const items = Array.isArray(action.items) ? action.items : [];
      const shown = { items: [], trade: null };
      for (const id of items) {
        needMine(id);
        const kind = st.items[id];
        if (!itemUsable(kind, role)) throw new Error(`${kind} cannot be used by the ${role}`);
        shown.items.push(id);
      }
      if (action.trade) {
        const tr = st.seats[seat].trade;
        if (!tradeUsable(tr, role)) throw new Error(`${tr} cannot be used by the ${role}`);
        if (TRADE_BY_ID[tr].once && st.seats[seat].tradeUsed) throw new Error(`${tr} already used`);
        if (tr === "pharmacist") {
          if (![f.attacker, f.defender].includes(action.winner)) throw new Error("the pharmacist names the attacker or the defender");
          f.pharmacist = { seat, winner: action.winner };
        }
        revealTrade(st, seat);
        shown.trade = tr;
      }
      f.shown[seat] = shown;
      f.answered.push(seat);
      settleScuffle(st);
      return st;
    }
    case "choice": {
      needPhase("scuffle"); checkSeat();
      const f = st.scuffle;
      if (f.step !== "choice" || seat !== f.winner) throw new Error("not your choice");
      const loser = f.winner === f.attacker ? f.defender : f.attacker;
      if (action.take) {
        if (!hand(st, loser).length) throw new Error("the loser holds nothing to take");
        f.choice = "take";
        f.step = "take";
        learn(st, seat, { k: "hand", seat: loser, items: hand(st, loser).map((x) => ({ id: x, kind: st.items[x] })) });
        return st;
      }
      f.choice = "peek";
      learn(st, seat, { k: "gang", seat: loser, gang: st.seats[loser].gang });
      learn(st, seat, { k: "trade", seat: loser, trade: st.seats[loser].trade });
      finishScuffle(st);
      return st;
    }
    case "takeItem": {
      needPhase("scuffle"); checkSeat();
      const f = st.scuffle;
      if (f.step !== "take" || seat !== f.winner) throw new Error("not your take");
      const loser = f.winner === f.attacker ? f.defender : f.attacker;
      if (!has(st, loser, action.item)) throw new Error(`loser does not hold ${action.item}`);
      moveItem(st, action.item, loser, seat);
      learn(st, loser, { k: "lost", to: seat, id: action.item, kind: st.items[action.item] });
      f.taken = action.item;
      finishScuffle(st);
      return st;
    }

    // ---- hand limit ----
    case "gift": {
      needPhase("handLimit"); checkSeat(); checkSeat(action.to);
      if (seat !== st.pending[0]) throw new Error("not your turn to give");
      if (action.to === seat) throw new Error("give to someone else");
      needMine(action.item);
      moveItem(st, action.item, seat, action.to);
      learn(st, action.to, { k: "got", from: seat, id: action.item, kind: st.items[action.item] });
      log(st, { type: "gift", from: seat, to: action.to });
      if (hand(st, seat).length <= handLimit(st)) st.pending.shift();
      overLimit(st, action.to);
      if (!st.pending.length) resumeAfter(st);
      return st;
    }

    // ---- showing your hand ----
    case "declare": {
      needTurn();
      const me = st.seats[seat];
      if (hand(st, seat).some((id) => ITEM_BY_KIND[st.items[id]].blocksDeclare)) throw new Error("the poison-pen letter's holder may not declare");
      const gang = me.gang;
      if (goalCount(st, seat, gang) < 1) throw new Error("you must hold one of your gang's items yourself");
      const holders = action.holders && typeof action.holders === "object" ? action.holders : {};
      const named = Object.keys(holders).map(Number);
      for (const s of named) {
        checkSeat(s);
        if (s === seat) throw new Error("do not name yourself");
        if (!Number.isInteger(holders[s]) || holders[s] < 1) throw new Error("each named ally holds at least one item");
      }
      let total = goalCount(st, seat, gang);
      let correct = true;
      const revealed = [{ seat, gang, trade: me.trade, items: hand(st, seat).slice() }];
      for (const s of named) {
        const sd = st.seats[s];
        revealed.push({ seat: s, gang: sd.gang, items: hand(st, s).slice() });
        if (sd.gang !== gang) correct = false;
        else if (goalCount(st, s, gang) < holders[s]) correct = false;
        else total += holders[s];
      }
      if (st.minority === gang) total += 1; // one strong drink counts
      if (total < NEEDED) correct = false;
      log(st, { type: "declare", seat, gang, holders, correct, revealed });
      endGame(st, correct ? gang : other(gang), correct ? "declared" : "wrong", seat);
      return st;
    }
    case "solo": {
      needTurn();
      if (!holdsKind(st, seat, "first_class_ticket")) throw new Error("you need the first-class ticket");
      const goals = hand(st, seat).filter((id) => goalKindOf(st, id)).length;
      if (goals < NEEDED) throw new Error(`the ticket needs ${NEEDED} watches or seals in your own hand`);
      log(st, { type: "solo", seat, revealed: [{ seat, gang: st.seats[seat].gang, trade: st.seats[seat].trade, items: hand(st, seat).slice() }] });
      endGame(st, seat, "solo", seat);
      return st;
    }
    default:
      throw new Error(`unknown action ${action.type}`);
  }
}

// ---------- trades ----------
function legalReturns(st, seat, offeredKind) {
  return hand(st, seat).filter((id) => !(isCase(offeredKind) && isCase(st.items[id]) && st.items[id] !== offeredKind));
}

// Move the two cards, then queue the trade texts: the offerer's first, then
// the responder's. A broken mirror on either side silences both texts.
function swap(st, from, to, given, returned) {
  const t = st.trade;
  moveItem(st, given, from, to);
  moveItem(st, returned, to, from);
  learn(st, to, { k: "got", from, id: given, kind: st.items[given] });
  learn(st, from, { k: "got", from: to, id: returned, kind: st.items[returned] });
  const mirror = st.items[given] === "broken_mirror" || st.items[returned] === "broken_mirror";
  t.texts = [];
  if (!mirror) {
    for (const [giver, id] of [[from, given], [to, returned]]) {
      if (tradeText(st, id) && t.announce[giver]) t.texts.push({ giver, id, kind: st.items[id] });
    }
  }
  t.step = null;
  t.entry = { type: "trade", from: t.from, to: t.to, accepted: true, forced: !!t.forced, announced: t.texts.map((x) => ({ seat: x.giver, kind: x.kind })) };
  continueTexts(st);
}

// Resolve queued trade texts in order; some need a decision and pause here.
function continueTexts(st) {
  const t = st.trade;
  while (t.texts.length) {
    const { giver, kind } = t.texts.shift();
    const partner = giver === t.from ? t.to : t.from;
    switch (ITEM_BY_KIND[kind].trade) {
      case "draw": {
        const id = draw(st, giver);
        if (id) t.entry.drew = (t.entry.drew || []).concat(giver);
        break;
      }
      case "see_items":
        learn(st, giver, { k: "hand", seat: partner, items: hand(st, partner).map((x) => ({ id: x, kind: st.items[x] })) });
        break;
      case "see_gang":
        learn(st, giver, { k: "gang", seat: partner, gang: st.seats[partner].gang });
        break;
      case "swap_trades":
        t.step = "codebook"; t.actor = giver; return;
      case "new_trade":
        if (!st.spareTrades.length) break;
        t.step = "coat"; t.actor = giver; return;
      case "everyone_passes":
        t.step = "direction"; t.actor = giver; return;
    }
  }
  log(st, t.entry);
  const from = t.from, to = t.to;
  st.trade = null;
  overLimit(st, from);
  overLimit(st, to);
  endTurn(st);
}

function settlePasses(st) {
  const t = st.trade;
  const seatsIn = Object.keys(t.passes).map(Number);
  if (seatsIn.some((s) => t.passes[s] === null)) return;
  // Everyone hands their card over at once. No trade texts fire.
  const step = t.dir === "left" ? (s) => nextSeat(st, s) : (s) => prevSeat(st, s);
  for (const s of seatsIn) moveItem(st, t.passes[s], s, null);
  for (const s of seatsIn) {
    const to = step(s);
    hand(st, to).push(t.passes[s]);
    learn(st, to, { k: "got", from: s, id: t.passes[s], kind: st.items[t.passes[s]] });
  }
  t.entry.passed = seatsIn.length;
  t.passes = null;
  t.step = null;
  continueTexts(st);
}

// ---------- scuffles ----------
const allBut = (st, seats) => [...Array(st.n).keys()].filter((s) => !seats.includes(s));
function roleIn(f, seat) {
  if (seat === f.attacker) return "attacker";
  if (seat === f.defender) return "defender";
  if (f.support[seat] === "attacker") return "backer";
  if (f.support[seat] === "defender") return "guard";
  return "bystander";
}
function itemUsable(kind, role) {
  switch (kind) {
    case "dagger": return role === "attacker";
    case "gloves": return role === "defender";
    case "poison_ring": return role === "attacker" || role === "defender";
    case "knives": return role === "backer";
    case "cane": return role === "guard";
    default: return false;
  }
}
function tradeUsable(trade, role) {
  switch (trade) {
    case "thug": return role === "attacker";
    case "master": return role === "defender";
    case "bodyguard": return role === "backer" || role === "guard";
    case "pharmacist": return role === "bystander" || role === "backer" || role === "guard";
    default: return false;
  }
}

function openWindow(st, step, eligible) {
  const f = st.scuffle;
  f.step = step;
  f.window = eligible;
  f.answered = eligible.filter((s) => !canHold(st, s, step));
  settleScuffle(st);
}
function nextDeclarer(st, from) {
  const f = st.scuffle;
  for (let i = 1; i < st.n; i++) {
    const s = (from + i) % st.n;
    if (s === f.attacker) return null; // a full circle from the attacker's left
    if (s !== f.defender && !(s in f.support)) return s;
  }
  return null;
}
function openPowers(st) {
  const f = st.scuffle;
  f.step = "powers";
  f.window = allBut(st, f.hypnotized === null ? [] : [f.hypnotized]);
  f.answered = f.window.filter((s) => !couldShow(st, s));
  settleScuffle(st);
}
// A seat with nothing it could possibly show is not asked, and that says
// nothing: item kinds are secret, so only a revealed, useless trade and an
// empty hand together let the engine skip it.
function couldShow(st, seat) {
  const f = st.scuffle;
  const role = roleIn(f, seat);
  const sd = st.seats[seat];
  const tradeOk = tradeUsable(sd.trade, role) && !(TRADE_BY_ID[sd.trade].once && sd.tradeUsed);
  if (!sd.tradeRevealed || tradeOk) return true;
  return hand(st, seat).length > 0;
}

// Advance through any step whose actors are all settled.
function settleScuffle(st) {
  const f = st.scuffle;
  for (;;) {
    if (!f) return;
    switch (f.step) {
      case "priest":
        if (f.answered.length < f.window.length) return;
        openWindow(st, "gunman", [f.attacker, f.defender]);
        return;
      case "gunman":
        if (f.answered.length < f.window.length) return;
        if (f.gunman !== null) { f.step = "hypnotist"; break; }
        f.step = "support";
        f.next = nextDeclarer(st, f.attacker);
        if (f.next === null) { f.step = "hypnotist"; break; }
        return;
      case "hypnotist":
        // The named seat may use no trade or item this scuffle, so a
        // bystander is a legitimate target too (it silences a pharmacist).
        if (canHold(st, f.attacker, "hypnotist")) return;
        openPowers(st);
        return;
      case "powers":
        if (f.answered.length < f.window.length) return;
        count(st);
        openWindow(st, "doctor", allBut(st, f.hypnotized === null ? [] : [f.hypnotized]));
        return;
      case "doctor":
        if (f.answered.length < f.window.length) return;
        if (f.doctor !== null) {
          log(st, scuffleEntry(st, { doctored: f.doctor }));
          st.scuffle = null;
          endTurn(st);
          return;
        }
        if (f.tie) {
          const id = draw(st, f.attacker);
          f.drew = !!id;
          finishScuffle(st);
          return;
        }
        {
          const loser = f.winner === f.attacker ? f.defender : f.attacker;
          f.step = "choice";
          if (!hand(st, loser).length) {
            // Nothing to take: the peek is the only prize.
            f.choice = "peek";
            learn(st, f.winner, { k: "gang", seat: loser, gang: st.seats[loser].gang });
            learn(st, f.winner, { k: "trade", seat: loser, trade: st.seats[loser].trade });
            finishScuffle(st);
          }
          return;
        }
      default:
        return;
    }
  }
}

function count(st) {
  const f = st.scuffle;
  let swords = 1, shields = 1;
  for (const [s, side] of Object.entries(f.support)) {
    if (side === "attacker") swords++;
    if (side === "defender") shields++;
  }
  let ringSide = null;
  for (const [s, shown] of Object.entries(f.shown)) {
    const seat = Number(s);
    const role = roleIn(f, seat);
    for (const id of shown.items) {
      const kind = st.items[id];
      if (kind === "dagger" || kind === "knives") swords++;
      if (kind === "gloves" || kind === "cane") shields++;
      if (kind === "poison_ring") ringSide = role;
    }
    if (shown.trade === "thug") swords++;
    if (shown.trade === "master") shields++;
    if (shown.trade === "bodyguard") { if (role === "backer") swords++; else shields++; }
  }
  if (f.gunman !== null && st.options.gunmanBonus) { if (f.gunman === f.attacker) swords++; else shields++; }
  f.swords = swords; f.shields = shields;
  if (f.pharmacist) { f.winner = f.pharmacist.winner; f.tie = false; }
  else if (swords > shields) f.winner = f.attacker;
  else if (shields > swords) f.winner = f.defender;
  else if (ringSide === "attacker") f.winner = f.attacker;
  else if (ringSide === "defender") f.winner = f.defender;
  else { f.winner = null; f.tie = true; }
}

function scuffleEntry(st, extra = {}) {
  const f = st.scuffle;
  return {
    type: "scuffle", attacker: f.attacker, defender: f.defender, gunman: f.gunman, hypnotized: f.hypnotized,
    support: { ...f.support },
    shown: Object.fromEntries(Object.entries(f.shown).map(([s, x]) => [s, { items: kinds(st, x.items), trade: x.trade }])),
    pharmacist: f.pharmacist ? f.pharmacist.seat : null,
    swords: f.swords, shields: f.shields, winner: f.winner, tie: f.tie, drew: f.drew, choice: f.choice,
    ...extra,
  };
}

function finishScuffle(st) {
  const f = st.scuffle;
  log(st, scuffleEntry(st));
  const winner = f.winner, attacker = f.attacker;
  st.scuffle = null;
  if (winner !== null) overLimit(st, winner);
  if (f.tie) overLimit(st, attacker);
  endTurn(st);
}

// ---------- hand limit, turn end, game end ----------
function overLimit(st, seat) {
  if (hand(st, seat).length > handLimit(st) && !st.pending.includes(seat)) st.pending.push(seat);
}
// Called at the end of every turn: if anyone is over the limit, they give
// first, and the turn passes when they are done.
function endTurn(st) {
  if (st.pending.length) {
    st.after = "nextTurn";
    st.phase = "handLimit";
    return;
  }
  nextTurn(st);
}
function resumeAfter(st) {
  st.after = null;
  nextTurn(st);
}
function nextTurn(st) {
  st.turn = nextSeat(st, st.turn);
  st.turnNo += 1;
  st.phase = "turn";
  st.event = { type: "turn", seat: st.turn };
}
function endGame(st, winner, reason, by) {
  st.phase = "over";
  st.winner = winner;
  st.reason = reason;
  st.trade = null; st.scuffle = null; st.peek = null;
  st.event = { type: "over", winner, reason, by };
}

// ---------- legal actions, enumerated ----------
// Concrete actions a seat may take right now. The UI and the bots both draw
// from this list, so nothing offered can be illegal. Offers enumerate every
// target and item; declarations are left to the caller (the space is large).
export function legalActions(st, seat) {
  const out = [];
  if (!mustAct(st).includes(seat)) return out;
  const push = (a) => out.push({ seat, ...a });
  switch (st.phase) {
    case "reveal": push({ type: "ready" }); break;
    case "turn": {
      push({ type: "pass" });
      const others = allBut(st, [seat]);
      for (const to of others) if (hand(st, to).length) for (const item of hand(st, seat)) push({ type: "offer", to, item });
      for (const target of others) push({ type: "attack", target });
      if (hasPower(st, seat, "fortune_teller") && st.pile.length >= 2) push({ type: "fortune" });
      if (hasPower(st, seat, "diplomat") && hand(st, seat).length) {
        for (const target of others) for (const kind of Object.keys(ITEM_BY_KIND)) push({ type: "demand", target, kind });
      }
      const me = st.seats[seat];
      if (goalCount(st, seat, me.gang) >= 1 && !hand(st, seat).some((id) => ITEM_BY_KIND[st.items[id]].blocksDeclare)) push({ type: "declare", holders: {} });
      if (holdsKind(st, seat, "first_class_ticket") && hand(st, seat).filter((id) => goalKindOf(st, id)).length >= NEEDED) push({ type: "solo" });
      break;
    }
    case "peek": {
      const p = st.pile;
      for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) if (i !== j) push({ type: "arrange", top: [p[i], p[j]] });
      break;
    }
    case "handLimit": {
      for (const to of allBut(st, [seat])) for (const item of hand(st, seat)) push({ type: "gift", item, to });
      break;
    }
    case "trade": {
      const t = st.trade;
      if (t.step === "answer") {
        const offeredKind = st.items[t.offered];
        const returns = legalReturns(st, seat, offeredKind);
        if (!(ITEM_BY_KIND[offeredKind].mustAccept && returns.length)) push({ type: "answer", accept: false });
        for (const item of returns) push({ type: "answer", accept: true, item });
      } else if (t.step === "return") {
        for (const item of legalReturns(st, seat, st.items[t.wanted])) push({ type: "give", item });
      } else if (t.step === "codebook") { push({ type: "codebook", swap: false }); push({ type: "codebook", swap: true }); }
      else if (t.step === "coat") { push({ type: "coat", trade: null }); for (const tr of st.spareTrades) push({ type: "coat", trade: tr }); }
      else if (t.step === "direction") { push({ type: "direction", dir: "left" }); push({ type: "direction", dir: "right" }); }
      else if (t.step === "passItems") for (const item of hand(st, seat)) push({ type: "passItem", item });
      break;
    }
    case "scuffle": {
      const f = st.scuffle;
      switch (f.step) {
        case "priest": case "gunman": case "doctor":
          push({ type: "window", use: false });
          if (hasPower(st, seat, f.step)) push({ type: "window", use: true });
          break;
        case "priestPay": for (const item of hand(st, seat)) push({ type: "give", item }); break;
        case "support": for (const side of ["attacker", "defender", "out"]) push({ type: "support", side }); break;
        case "hypnotist":
          push({ type: "hypnotize", target: null });
          if (hasPower(st, seat, "hypnotist")) for (const s of allBut(st, [seat, f.defender])) push({ type: "hypnotize", target: s });
          break;
        case "powers": {
          const role = roleIn(f, seat);
          const usable = hand(st, seat).filter((id) => itemUsable(st.items[id], role));
          const sd = st.seats[seat];
          const tradeOk = tradeUsable(sd.trade, role) && !(TRADE_BY_ID[sd.trade].once && sd.tradeUsed);
          push({ type: "show", items: [], trade: false });
          if (usable.length) push({ type: "show", items: usable, trade: false });
          if (tradeOk) {
            if (sd.trade === "pharmacist") { push({ type: "show", items: usable, trade: true, winner: f.attacker }); push({ type: "show", items: usable, trade: true, winner: f.defender }); }
            else push({ type: "show", items: usable, trade: true });
          }
          break;
        }
        case "choice": {
          const loser = f.winner === f.attacker ? f.defender : f.attacker;
          push({ type: "choice", take: false });
          if (hand(st, loser).length) push({ type: "choice", take: true });
          break;
        }
        case "take": {
          const loser = f.winner === f.attacker ? f.defender : f.attacker;
          for (const item of hand(st, loser)) push({ type: "takeItem", item });
          break;
        }
      }
      break;
    }
  }
  return out;
}

// ---------- per-seat projection ----------
// `seat` is the viewer, or null for a spectator. This is the only thing that
// may leave the process that holds the full state.
export function view(st, seat = null) {
  const over = st.phase === "over";
  const me = seat === null ? null : st.seats[seat];
  const showAll = over;
  const items = (ids) => ids.map((id) => ({ id, kind: st.items[id] }));
  const t = st.trade, f = st.scuffle;
  const v = {
    n: st.n, seat, phase: st.phase, turn: st.turn, turnNo: st.turnNo,
    options: { ...st.options }, handLimit: handLimit(st), pile: st.pile.length,
    spareTrades: st.spareTrades.length,
    ready: st.ready.slice(),
    me: me ? { gang: me.gang, trade: me.trade, tradeUsed: me.tradeUsed, tradeRevealed: me.tradeRevealed, items: items(me.items), drink: me.drink,
      minority: null } : null,
    seats: st.seats.map((sd, i) => ({
      items: sd.items.length,
      trade: sd.tradeRevealed || showAll ? sd.trade : null,
      tradeUsed: sd.tradeRevealed || showAll ? sd.tradeUsed : null,
      drink: sd.drink,
      gang: showAll ? sd.gang : null,
      hand: showAll ? items(sd.items) : null,
    })),
    gangSizes: showAll ? { ...st.gangSizes } : null,
    minority: showAll ? st.minority : null,
    knowledge: seat === null ? [] : clone(st.knowledge[seat]),
    trade: t ? {
      from: t.from, to: t.to, step: t.step, forced: !!t.forced, actor: t.actor, dir: t.dir,
      offered: t.offered && (seat === t.from || seat === t.to) ? { id: t.offered, kind: st.items[t.offered] } : null,
      wanted: t.wanted && (seat === t.from || seat === t.to) ? { id: t.wanted, kind: st.items[t.wanted] } : null,
      passes: t.passes ? Object.fromEntries(Object.keys(t.passes).map((s) => [s, t.passes[s] !== null])) : null,
    } : null,
    scuffle: f ? {
      attacker: f.attacker, defender: f.defender, step: f.step, window: f.window.slice(), answered: f.answered.slice(),
      next: f.next, support: { ...f.support }, gunman: f.gunman, hypnotized: f.hypnotized, priest: f.priest, doctor: f.doctor,
      shown: Object.fromEntries(Object.entries(f.shown).map(([s, x]) => [s, { items: kinds(st, x.items), trade: x.trade }])),
      pharmacist: f.pharmacist ? f.pharmacist.seat : null,
      swords: f.swords, shields: f.shields, winner: f.winner, tie: f.tie, choice: f.choice,
      loserHand: f.step === "take" && seat === f.winner ? items(st.seats[f.winner === f.attacker ? f.defender : f.attacker].items) : null,
    } : null,
    peek: st.phase === "peek" && seat === st.turn ? items(st.pile.slice().reverse()) : null,
    coatChoices: t && t.step === "coat" && seat === t.actor ? st.spareTrades.slice() : null,
    pending: st.pending.slice(),
    log: clone(st.log),
    winner: st.winner, reason: st.reason,
    event: st.event ? clone(st.event) : null,
    waitingOn: mustAct(st),
  };
  if (v.me) {
    // Nobody knows which side is short at odd counts, only that one is.
    v.me.minority = null;
    v.me.canDeclare = st.phase === "turn" && st.turn === seat && goalCount(st, seat, me.gang) >= 1 && !me.items.some((id) => ITEM_BY_KIND[st.items[id]].blocksDeclare);
  }
  return v;
}
