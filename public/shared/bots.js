// The AI passengers. A bot decides from a `view` (engine.view) plus the list
// of legal actions the engine enumerates for its seat, and nothing else, so
// it can only know what a human in that seat would know. Bots keep no
// memory: every belief is rebuilt from the view's knowledge list and the
// public log at each decision, which keeps them stateless (a room restored
// from storage just carries on) and deterministic given the rng.
//
// Two beliefs drive everything:
//   1. Gangs. There are at most C(9,5) = 126 ways to split the other seats
//      into allies and enemies at a given gang size (two sizes at odd
//      counts). Peeked gangs are hard evidence; who backs whom in scuffles,
//      who trades with whom and who attacks whom are soft evidence.
//   2. Goal items. For each watch and seal (and the sealed cases once the
//      pile is empty) a distribution over "which hand, or the pile". Every
//      sighting pins it; every public card movement (a trade, a take, a
//      gift, a draw, the timetable) spreads it.
// From those come P(ally), P(this seat holds k of my items), P(my gang is
// the smaller one), and a probability that a declaration would be right.
//
// Every decision carries a `why`, so the table-talk module can say
// something true about it.

import * as E from "./engine.js";

export const LEVELS = ["easy", "normal", "hard"];

// Per-level knobs. `noise` is the chance a decision is taken at random
// instead of from the model; `declareAt` the confidence needed to show your
// hand; `edge` how sure a bot must be to back a side in a scuffle;
// `attackAt` the win chance below which it would rather trade.
export const KNOBS = {
  easy: { noise: 0.45, declareAt: 0.65, declareFloor: 0.6, edge: 0.35, attackAt: 0.55 },
  normal: { noise: 0.05, declareAt: 0.85, declareFloor: 0.65, edge: 0.2, attackAt: 0.45 },
  hard: { noise: 0.02, declareAt: 0.92, declareFloor: 0.72, edge: 0.15, attackAt: 0.4 },
};
// Patience runs out: the confidence a bot wants before showing its hand
// slides from `declareAt` toward `declareFloor` as the turns pass, the way a
// table that has been at it for an hour starts taking chances; past a
// sixty turns even the floor gives way, so no game runs forever.
export function declareThreshold(K, turnNo) {
  const floor = Math.max(0.3, K.declareFloor - Math.max(0, turnNo - 60) * 0.004);
  return Math.max(floor, K.declareAt - 0.005 * turnNo);
}

// ---------- small maths ----------
export function combos(items, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < items.length; i++) { acc.push(items[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
function normalize(p) {
  const s = p.reduce((a, b) => a + b, 0);
  return s > 0 ? p.map((x) => x / s) : p;
}
const argmax = (arr, f) => arr.reduce((best, x) => (best === null || f(x) > f(best) ? x : best), null);

// ---------- gang belief ----------
// Likelihood factor of one public event under a hypothesis, given `same(a,
// b)`: whether a and b are on the same side in it.
function eventFactor(e, same) {
  let f = 1;
  const S = (a, b, yes, no) => (same(a, b) ? yes : no);
  switch (e.type) {
    // Soft factors are deliberately mild: what a seat does reflects what it
    // *believes*, and a table of guessers can talk itself into cliques that
    // match nobody's real gang. Peeks are the hard evidence.
    case "scuffle":
      f *= S(e.attacker, e.defender, 0.85, 1);
      for (const [s, side] of Object.entries(e.support || {})) {
        const seat = Number(s);
        if (side === "attacker") f *= S(seat, e.attacker, 1.35, 1 / 1.35) * S(seat, e.defender, 1 / 1.2, 1.2);
        if (side === "defender") f *= S(seat, e.defender, 1.35, 1 / 1.35) * S(seat, e.attacker, 1 / 1.2, 1.2);
      }
      if (e.stopped != null) f *= S(e.stopped, e.defender, 1.2, 1);
      if (e.doctored != null && e.winner != null) f *= S(e.doctored, e.winner === e.attacker ? e.defender : e.attacker, 1.3, 1);
      if (e.pharmacist != null && e.winner != null) f *= S(e.pharmacist, e.winner, 1.5, 1 / 1.5);
      break;
    case "trade":
      if (e.forced) break;
      f *= e.accepted ? S(e.from, e.to, 1.12, 0.9) : S(e.from, e.to, 0.95, 1.05);
      break;
    case "gift":
      f *= S(e.from, e.to, 1.2, 0.85);
      break;
  }
  return f;
}

// P(seat is my ally) for every seat, and P(my gang is the smaller one).
export function gangBelief(view) {
  const n = view.n, me = view.seat, myGang = view.me.gang;
  const others = [...Array(n).keys()].filter((s) => s !== me);
  const known = {};
  for (const k of view.knowledge) if (k.k === "gang") known[k.seat] = k.gang;
  for (let s = 0; s < n; s++) if (view.seats[s].gang) known[s] = view.seats[s].gang;
  const sizes = E.isOdd(n) ? [(n - 1) / 2, (n + 1) / 2] : [n / 2];
  const hyps = [];
  for (const size of sizes) {
    for (const combo of combos(others, size - 1)) {
      const allies = new Set(combo);
      let ok = true;
      for (const [s, g] of Object.entries(known)) {
        const seat = Number(s);
        if (seat === me) continue;
        if (allies.has(seat) !== (g === myGang)) { ok = false; break; }
      }
      if (!ok) continue;
      const side = (a) => a === me || allies.has(a);
      const same = (a, b) => side(a) === side(b);
      let w = 1;
      for (const e of view.log) w *= eventFactor(e, same);
      // Tempered: behaviour is a guess about a guess, so the whole soft
      // likelihood is flattened before it meets the hard facts.
      hyps.push({ allies, w: Math.pow(w, 0.6), size });
    }
  }
  const total = hyps.reduce((s, h) => s + h.w, 0) || 1;
  const ally = new Array(n).fill(0);
  ally[me] = 1;
  let pMinority = 0;
  for (const h of hyps) {
    h.p = h.w / total;
    h.small = E.isOdd(n) && h.size === (n - 1) / 2;
    for (const s of h.allies) ally[s] += h.p;
    if (h.small) pMinority += h.p;
  }
  // P(every seat in `seats` is an ally), jointly, and the share of those
  // worlds where my gang is also the smaller one. The share is counted
  // over hypotheses, not weighted: which side is short is decided by the
  // deal, and behaviour says nothing reliable about it, while the count of
  // hypotheses still consistent with the peeks does.
  const joint = (seats) => {
    let all = 0, cnt = 0, smallCnt = 0;
    for (const h of hyps) {
      if (!seats.every((s) => h.allies.has(s))) continue;
      all += h.p;
      cnt++;
      if (h.small) smallCnt++;
    }
    return { all, small: cnt ? all * (smallCnt / cnt) : 0 };
  };
  return { ally: ally.map(clamp01), pMinority: E.isOdd(n) ? pMinority : 0, joint };
}

// ---------- goal-item belief ----------
// Ids of the items that count for `gang` right now.
export function goalIds(view, gang) {
  const kind = E.GOAL[gang];
  const ids = [1, 2, 3].map((i) => `${kind}${i}`);
  if (view.pile === 0) ids.push(`case_${kind}`);
  return ids;
}

// For each goal item of `gang`: a distribution over seats 0..n-1 and the
// pile at index n.
export function itemBelief(view, gang) {
  const n = view.n, me = view.seat, PILE = n;
  const ids = goalIds(view, gang);
  const each = n === 3 ? 2 : 1;
  const pile0 = E.deckSize(n, view.options) - n * each;
  const bel = {};
  for (const id of ids) {
    const p = new Array(n + 1).fill(0);
    for (let s = 0; s < n; s++) if (s !== me) p[s] = each;
    p[PILE] = id.startsWith("case_") ? 0 : pile0;
    bel[id] = normalize(p);
  }
  // Hand sizes are replayed from the log, because how much a move says
  // depends on how many cards the mover held *then*: early on everyone
  // holds one card, so an accepted trade moves it for certain.
  const sizes = new Array(n).fill(each);
  let pileNow = pile0;
  const h = (s) => Math.max(1, sizes[s]);
  const bump = (s, d) => { sizes[s] = Math.max(0, sizes[s] + d); };
  const move = (from, to, share) => {
    for (const id of ids) { const p = bel[id]; const m = p[from] * share; p[from] -= m; p[to] += m; }
  };
  const pin = (id, where) => { if (bel[id]) bel[id] = bel[id].map((_, i) => (i === where ? 1 : 0)); };
  const notAt = (id, where) => {
    if (!bel[id]) return;
    const p = bel[id].slice(); p[where] = 0;
    const s = p.reduce((a, b) => a + b, 0);
    bel[id] = s > 0 ? normalize(p) : bel[id];
  };

  const facts = view.knowledge.filter((k) => ["hand", "got", "lost", "gave", "offered", "pile", "seen", "top"].includes(k.k));
  const events = [
    ...view.log.map((e) => ({ t: e.t, o: 0, log: e })),
    ...facts.map((f) => ({ t: f.at, o: 1, fact: f })),
  ].sort((a, b) => a.t - b.t || a.o - b.o);

  for (const ev of events) {
    if (ev.log) {
      const e = ev.log;
      switch (e.type) {
        case "trade":
          if (!e.accepted) break;
          if (e.from !== me && e.to !== me) {
            const a = 1 / h(e.from), b = 1 / h(e.to);
            for (const id of ids) {
              const p = bel[id];
              const ma = p[e.from] * a, mb = p[e.to] * b;
              p[e.from] += mb - ma; p[e.to] += ma - mb;
            }
          }
          for (const s of e.drew || []) { if (s !== me) move(PILE, s, 1 / Math.max(1, pileNow)); bump(s, 1); pileNow--; }
          if (e.passed) {
            const dir = (view.log.find((x) => x.type === "timetable" && x.t === e.t) || {}).dir || "left";
            const moves = [];
            const had = sizes.map((c) => c > 0);
            for (let s = 0; s < n; s++) {
              if (!had[s]) continue;
              const to = dir === "left" ? (s + 1) % n : (s + n - 1) % n;
              if (s !== me) for (const id of ids) moves.push([id, s, to, bel[id][s] / h(s)]);
              bump(s, -1); bump(to, 1);
            }
            for (const [id, s, to, m] of moves) { bel[id][s] -= m; bel[id][to] += m; }
          }
          break;
        case "scuffle": {
          if (e.stopped != null) {
            if (e.paid) { if (e.attacker !== me) move(e.attacker, e.stopped, 1 / h(e.attacker)); bump(e.attacker, -1); bump(e.stopped, 1); }
            break;
          }
          if (e.doctored != null) break;
          if (e.tie) { if (e.drew) { if (e.attacker !== me) move(PILE, e.attacker, 1 / Math.max(1, pileNow)); bump(e.attacker, 1); pileNow--; } break; }
          if (e.choice === "take") {
            // A winner takes the best card there is, and a goal item usually
            // is that card, so it moves with more than an even share.
            const loser = e.winner === e.attacker ? e.defender : e.attacker;
            // A porter hands over the least useful bag instead.
            if (loser !== me && e.winner !== me) move(loser, e.winner, e.yielded ? 0.2 / h(loser) : Math.min(0.9, 2 / h(loser)));
            bump(loser, -1); bump(e.winner, 1);
          }
          if (e.choice === "bribe") { bump(e.winner === e.attacker ? e.defender : e.attacker, -1); bump(e.winner, 1); }
          break;
        }
        case "gift":
          if (e.from !== me && e.to !== me) move(e.from, e.to, 1 / h(e.from));
          bump(e.from, -1); bump(e.to, 1);
          break;
        case "demand":
          if (!e.had || e.seat === me || e.target === me) break;
          move(e.target, e.seat, e.kind === E.GOAL[gang] ? 0.8 : 1 / h(e.target));
          move(e.seat, e.target, 1 / h(e.seat));
          break;
      }
    } else {
      const f = ev.fact;
      switch (f.k) {
        case "hand": {
          const there = new Set(f.items.map((x) => x.id));
          for (const id of ids) { if (there.has(id)) pin(id, f.seat); else notAt(id, f.seat); }
          break;
        }
        case "got": pin(f.id, me); break;
        case "lost": pin(f.id, f.to); break;
        case "gave": pin(f.id, f.to); break;
        case "offered": pin(f.id, f.from); break;
        case "seen": pin(f.id, f.seat); break;          // a bag shown at a station stop
        case "top": for (const it of f.items) pin(it.id, PILE); break;
        case "pile": {
          const there = new Set(f.items.map((x) => x.id));
          for (const id of ids) { if (there.has(id)) pin(id, PILE); else notAt(id, PILE); }
          break;
        }
      }
    }
  }
  // My own hand is certain.
  const mine = new Set(view.me.items.map((x) => x.id));
  for (const id of ids) { if (mine.has(id)) pin(id, me); else notAt(id, me); }
  return bel;
}

export const expectedAt = (bel, seat) => Object.values(bel).reduce((s, p) => s + p[seat], 0);
// P(at least k of the tracked items are in `seat`'s hand), items independent.
export function pAtLeast(bel, seat, k) {
  let dist = [1];
  for (const p of Object.values(bel)) {
    const q = p[seat];
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((d, i) => { next[i] += d * (1 - q); next[i + 1] += d * q; });
    dist = next;
  }
  return dist.slice(k).reduce((a, b) => a + b, 0);
}

// ---------- values ----------
const TRADE_VALUE = { priest: 5, doctor: 4.5, pharmacist: 4.5, diplomat: 3.5, gunman: 3, hypnotist: 3, thug: 3, master: 3, bodyguard: 2.5, fortune_teller: 2,
  double: 3, porter: 2.5, gambler: 3 };

function context(view) {
  const me = view.me;
  const gang = me.gang, enemy = E.other(gang);
  const g = gangBelief(view);
  const myItems = itemBelief(view, gang);
  const enemyItems = itemBelief(view, enemy);
  const myKind = E.GOAL[gang], enemyKind = E.GOAL[enemy];
  const countKind = (kind) => me.items.filter((x) => x.kind === kind || (view.pile === 0 && x.kind === `case_${kind}`)).length;
  const value = (kind) => {
    switch (kind) {
      case myKind: return 10;
      case enemyKind: return 1.8; // denial is worth less than a tool you can use
      case `case_${myKind}`: return 6;
      case `case_${enemyKind}`: return 1.5;
      case "first_class_ticket": return 5;
      case "poison_ring": return 3;
      case "dagger": case "gloves": return 2;
      case "knives": case "cane": return 1.5;
      case "monocle": case "warrant": return 3;
      case "codebook": case "trench_coat": return me.tradeUsed ? 2.5 : 1;
      case "timetable": return 1;
      case "broken_mirror": return 0.5;
      case "gold_bar": return 4;
      case "black_letter": return -3;
      default: return 1;
    }
  };
  return { view, me, gang, enemy, myKind, enemyKind, ally: g.ally, pMinority: g.pMinority, joint: g.joint, myItems, enemyItems, value, mine: countKind(myKind) };
}

// ---------- declaring ----------
// The most likely-correct claim available, or null.
export function bestClaim(ctx) {
  const { view, ally, pMinority, joint, myItems, mine } = ctx;
  if (mine < 1) return null;
  const others = [...Array(view.n).keys()].filter((s) => s !== view.seat && view.seats[s].items > 0);
  const scored = others.map((s) => ({ s, i1: pAtLeast(myItems, s, 1), i2: pAtLeast(myItems, s, 2) }))
    .map((c) => ({ ...c, rank: ally[c.s] * c.i1 }))
    .sort((a, b) => b.rank - a.rank).slice(0, 4);
  let best = { p: 0, holders: {} };
  const need = E.NEEDED - mine;
  if (need <= 0) return { p: 1, holders: {} };
  // P(correct) = P(all named are allies, jointly) × P(each holds what I
  // say) × [enough with or without the drink]. The drink counts only in the
  // worlds where my gang is the smaller one, so a claim one short leans on
  // that share of the joint.
  const rec = (i, holders, K, pItems) => {
    if (K >= need - (pMinority > 0 ? 1 : 0)) {
      const named = Object.keys(holders).map(Number);
      const j = joint(named);
      // Leaning on the drink is a gamble on the deal; discount it, so bots
      // prefer to find the third item unless the peeks have settled which
      // side is short.
      const p = pItems * (K >= need ? j.all : j.small * 0.85);
      if (p > best.p) best = { p, holders: { ...holders } };
    }
    if (i >= scored.length || K >= need) return;
    const c = scored[i];
    rec(i + 1, holders, K, pItems);
    holders[c.s] = 1; rec(i + 1, holders, K + 1, pItems * c.i1);
    if (K + 2 <= need) { holders[c.s] = 2; rec(i + 1, holders, K + 2, pItems * c.i2); }
    delete holders[c.s];
  };
  rec(0, {}, 0, 1);
  return best.p > 0 ? best : null;
}

// ---------- scuffle arithmetic ----------
function fightOutlook(ctx, attacker, defender, edge) {
  const { view, ally, me } = ctx;
  const n = view.n;
  let backers = 0, guards = 0;
  for (let s = 0; s < n; s++) {
    if (s === attacker || s === defender) continue;
    const d = ally[s] - 0.5;
    // Every seat backs whoever it thinks is its ally; from my chair that is
    // "how likely is s to be on the attacker's side".
    const pSideA = s === view.seat ? (ally[attacker] > ally[defender] ? 1 : 0) : (ally[attacker] > 0.5 ? clamp01(0.5 + d) : clamp01(0.5 - d));
    if (pSideA > 0.5 + edge) backers += 0.8;
    else if (pSideA < 0.5 - edge) guards += 0.8;
  }
  const mods = (seat, role) => {
    if (seat !== view.seat) return 0.3;
    let m = 0;
    for (const x of me.items) if (role === "attacker" ? x.kind === "dagger" : x.kind === "gloves") m += 1;
    if (role === "attacker" && me.trade === "thug") m += 1;
    if (role === "defender" && me.trade === "master") m += 1;
    if ((role === "attacker" || role === "defender") && me.trade === "gambler") m += 1; // the die averages one
    return m;
  };
  const swords = 1 + mods(attacker, "attacker") + backers;
  const shields = 1 + mods(defender, "defender") + guards;
  return { swords, shields, pAttackerWins: sigmoid(1.3 * (swords - shields)) };
}

// ---------- the decision ----------
export function decide(view, legal, level = "normal", rng = E.makeRng(E.randomSeed())) {
  if (!legal || !legal.length) return null;
  const K = KNOBS[level] || KNOBS.normal;
  const pick = (arr) => arr[rng.int(arr.length)];
  const only = legal.filter((a) => a.type !== "declare");
  if (rng.next() < K.noise && only.length) return { ...pick(only), why: "whim" };
  const ctx = context(view);
  const { ally, value, me } = ctx;
  const seat = view.seat;
  const others = [...Array(view.n).keys()].filter((s) => s !== seat);
  const mostLikelyEnemy = argmax(others, (s) => -ally[s]);
  const mostLikelyAlly = argmax(others, (s) => ally[s]);
  const cheapest = (ids) => argmax(ids, (id) => -value(kindOfMine(view, id)));

  switch (view.phase) {
    case "reveal": return { ...legal[0], why: "ready" };

    case "turn": {
      const solo = legal.find((a) => a.type === "solo");
      if (solo) return { ...solo, why: "solo" };
      const decl = legal.find((a) => a.type === "declare");
      if (decl) {
        const best = bestClaim(ctx);
        if (best && best.p >= declareThreshold(K, view.turnNo)) return { ...decl, holders: best.holders, why: "declare", p: best.p };
      }
      const options = [];
      const fortune = legal.find((a) => a.type === "fortune");
      if (fortune) options.push({ a: fortune, score: 3, why: "fortune" });
      for (const a of legal) {
        if (a.type === "offer") options.push({ a, score: offerScore(ctx, a.to, kindOfMine(view, a.item)), why: "offer" });
        if (a.type === "attack") options.push({ a, score: attackScore(ctx, a.target, K), why: "attack" });
        if (a.type === "demand" && a.kind === ctx.myKind) {
          const pHas = pAtLeast(ctx.myItems, a.target, 1);
          options.push({ a, score: 8 * pHas * (1.2 - ally[a.target]) - 1.5, why: "demand" });
        }
      }
      options.push({ a: legal.find((x) => x.type === "pass"), score: 0.3, why: "pass" });
      const jitter = level === "easy" ? 1.5 : 0.35;
      const best = argmax(options, (o) => o.score + rng.next() * jitter);
      return { ...best.a, why: best.why };
    }

    case "event": {
      const ev = view.ev;
      if (ev && ev.step === "vote") {
        // Point at whoever looks least like an ally and most likely to be sitting on my items.
        const best = argmax(others, (s) => (1 - ally[s]) + pAtLeast(ctx.myItems, s, 1));
        return { ...legal.find((a) => a.target === best) || pick(legal), why: "point" };
      }
      // Show the bag that gives least away.
      const item = cheapest(legal.map((a) => a.item));
      return { ...legal.find((a) => a.item === item) || pick(legal), why: "show_bag" };
    }

    case "peek": {
      // Put what helps me on top: my own goal items, then the cases.
      const pile = view.peek.slice().sort((a, b) => value(b.kind) - value(a.kind));
      const a = legal.find((l) => l.top[0] === pile[0].id && l.top[1] === pile[1].id) || legal[0];
      return { ...a, why: "arrange" };
    }

    case "handLimit": {
      const items = me.items.map((x) => x.id);
      const item = cheapest(items);
      const kind = kindOfMine(view, item);
      const to = kind === "black_letter" ? mostLikelyEnemy : mostLikelyAlly;
      const a = legal.find((x) => x.item === item && x.to === to) || pick(legal);
      return { ...a, why: kind === "black_letter" ? "dump" : "gift" };
    }

    case "trade": {
      const t = view.trade;
      switch (t.step) {
        case "answer": {
          const offered = t.offered.kind;
          const accepts = legal.filter((a) => a.accept);
          const refuse = legal.find((a) => !a.accept);
          if (!accepts.length) return { ...refuse, why: "cannot" };
          const ret = cheapest(accepts.map((a) => a.item));
          const gain = value(offered) - value(kindOfMine(view, ret));
          const friendly = ally[t.from] >= 0.75;
          if (!refuse || gain >= 0.5 || (friendly && gain >= -3)) {
            const a = accepts.find((x) => x.item === ret);
            return { ...a, announce: announceFor(ctx, kindOfMine(view, ret)), why: gain >= 0 ? "good_deal" : "help_ally" };
          }
          return { ...refuse, why: "bad_deal" };
        }
        case "return": return { ...legal.find((a) => a.item === cheapest(legal.map((a) => a.item))), why: "return" };
        case "codebook": {
          const partner = t.from === seat ? t.to : t.from;
          const theirs = view.seats[partner].trade;
          const mineV = me.tradeUsed ? 0 : TRADE_VALUE[me.trade];
          const theirsV = theirs ? (view.seats[partner].tradeUsed ? 0 : TRADE_VALUE[theirs]) : 3;
          const swap = theirsV > mineV + 0.5 || (theirs === null && mineV < 2.5 && rng.next() < 0.5);
          return { ...legal.find((a) => a.swap === swap), why: swap ? "swap_trades" : "keep_trade" };
        }
        case "coat": {
          const mineV = me.tradeUsed ? 0 : TRADE_VALUE[me.trade];
          const bestSpare = argmax(view.coatChoices, (tr) => TRADE_VALUE[tr]);
          const take = bestSpare && TRADE_VALUE[bestSpare] > mineV + 0.5;
          return { ...legal.find((a) => a.trade === (take ? bestSpare : null)), why: take ? "new_trade" : "keep_trade" };
        }
        case "disguise": {
          // Lie to someone who is probably not on my side.
          const looker = t.from === seat ? t.to : t.from;
          const lie = !!legal.find((a) => a.lie) && ally[looker] < 0.5;
          return { ...legal.find((a) => !!a.lie === lie), why: lie ? "disguise" : "truth" };
        }
        case "direction": return { ...pick(legal), why: "direction" };
        case "passItems": return { ...legal.find((a) => a.item === cheapest(legal.map((a) => a.item))), why: "pass_item" };
      }
      return { ...pick(legal), why: "whim" };
    }

    case "scuffle": {
      const f = view.scuffle;
      const skip = legal.find((a) => a.type === "window" && !a.use);
      const use = legal.find((a) => a.type === "window" && a.use);
      const loser = f.winner === null ? null : (f.winner === f.attacker ? f.defender : f.attacker);
      switch (f.step) {
        case "priest": {
          if (!use) return { ...skip, why: "skip" };
          const out = fightOutlook(ctx, f.attacker, f.defender, K.edge);
          const defendingUs = f.defender === seat || ally[f.defender] >= 0.7;
          if (defendingUs && out.pAttackerWins > 0.45) return { ...use, why: "priest_shield" };
          if (view.seats[f.attacker].items >= 2 && ally[f.attacker] < 0.4 && rng.next() < 0.5) return { ...use, why: "priest_toll" };
          return { ...skip, why: "skip" };
        }
        case "gunman": {
          if (!use) return { ...skip, why: "skip" };
          const out = fightOutlook(ctx, f.attacker, f.defender, K.edge);
          const iAttack = seat === f.attacker;
          const bad = iAttack ? out.pAttackerWins < 0.5 : out.pAttackerWins > 0.5;
          const solo = fightOutlook({ ...ctx, ally: ally.map((p, s) => (s === f.attacker || s === f.defender ? p : 0.5)) }, f.attacker, f.defender, 1);
          const better = iAttack ? solo.pAttackerWins > out.pAttackerWins : solo.pAttackerWins < out.pAttackerWins;
          return bad && better ? { ...use, why: "gunman" } : { ...skip, why: "skip" };
        }
        case "priestPay": return { ...legal.find((a) => a.item === cheapest(legal.map((a) => a.item))), why: "toll" };
        case "support": {
          const d = ally[f.attacker] - ally[f.defender];
          const side = d > K.edge ? "attacker" : d < -K.edge ? "defender" : "out";
          return { ...legal.find((a) => a.side === side), why: side === "out" ? "stay_out" : side === "attacker" ? "back_attacker" : "back_defender" };
        }
        case "hypnotist": {
          const targets = legal.filter((a) => a.target != null);
          const guards = targets.filter((a) => f.support[a.target] === "defender");
          if (guards.length) return { ...pick(guards), why: "hypnotize" };
          return { ...legal.find((a) => a.target == null), why: "skip" };
        }
        case "powers": {
          const withItems = legal.filter((a) => a.items.length);
          const base = withItems.length ? withItems : legal;
          const noTrade = base.find((a) => !a.trade) || legal[0];
          const withTrade = base.filter((a) => a.trade);
          if (!withTrade.length) return { ...noTrade, why: "show" };
          const role = seat === f.attacker ? "attacker" : seat === f.defender ? "defender" : f.support[seat] || "bystander";
          if (me.trade === "pharmacist") {
            const dA = ally[f.attacker], dD = ally[f.defender];
            const stake = pAtLeast(ctx.myItems, f.defender, 1) + pAtLeast(ctx.myItems, f.attacker, 1);
            if (dA >= 0.75 && dD < 0.5 && stake > 0.3) return { ...withTrade.find((a) => a.winner === f.attacker), why: "pharmacist" };
            if (dD >= 0.75 && dA < 0.5) return { ...withTrade.find((a) => a.winner === f.defender), why: "pharmacist" };
            return { ...noTrade, why: "show" };
          }
          // thug, master, bodyguard: always worth showing when they apply
          if (role === "attacker" || role === "defender" || role === "backer" || role === "guard") return { ...withTrade[0], why: "show_trade" };
          return { ...noTrade, why: "show" };
        }
        case "doctor": {
          if (!use) return { ...skip, why: "skip" };
          const hurt = loser !== null && (loser === seat || ally[loser] >= 0.7);
          const stake = loser !== null && (view.seats[loser].items > 0 || loser === seat);
          return hurt && stake ? { ...use, why: "doctor" } : { ...skip, why: "skip" };
        }
        case "yield": return { ...legal.find((a) => a.item === cheapest(legal.map((a) => a.item))), why: "yield" };
        // the loser's last bag was taken: hand back whatever is worth least to me
        case "giveBack": return { ...legal.find((a) => a.item === cheapest(legal.map((a) => a.item))), why: "give_back" };
        case "bribe": {
          // Pay rather than let a likely enemy look or take.
          const pay = legal.find((a) => a.pay);
          if (pay && ally[f.winner] < 0.6) return { ...pay, why: "bribe" };
          return { ...legal.find((a) => !a.pay), why: "no_bribe" };
        }
        case "disguise": {
          const lie = legal.find((a) => a.lie);
          if (lie && ally[f.winner] < 0.5) return { ...lie, why: "disguise" };
          return { ...legal.find((a) => !a.lie), why: "truth" };
        }
        case "choice": {
          const take = legal.find((a) => a.take);
          const peekA = legal.find((a) => !a.take);
          if (!take) return { ...peekA, why: "peek" };
          const known = view.knowledge.some((k) => k.k === "gang" && k.seat === loser);
          const pHas = pAtLeast(ctx.myItems, loser, 1) + 0.5 * pAtLeast(ctx.enemyItems, loser, 1);
          if (pHas > 0.4 || known) return { ...take, why: "take" };
          return { ...peekA, why: "peek" };
        }
        case "take": {
          const best = argmax(view.scuffle.loserHand, (x) => value(x.kind));
          return { ...legal.find((a) => a.item === best.id), why: "take_item" };
        }
      }
      return { ...pick(legal), why: "whim" };
    }
  }
  return { ...pick(legal), why: "whim" };
}

function kindOfMine(view, id) {
  const x = view.me.items.find((i) => i.id === id);
  return x ? x.kind : id.replace(/\d+$/, "");
}

// Under smuggling, read a text out only when it works for me.
function announceFor(ctx, kind) {
  if (!ctx.view.options.smuggling) return true;
  return ["monocle", "warrant", "case_watch", "case_seal", "codebook", "trench_coat"].includes(kind) && !(kind === "codebook" && !ctx.me.tradeUsed);
}

function offerScore(ctx, to, kind) {
  const { ally, view, enemyItems, myKind, enemyKind, me } = ctx;
  const pa = ally[to];
  const unc = 1 - Math.abs(2 * pa - 1);
  switch (kind) {
    case "monocle": return 3.5 * unc + 0.5;
    case "warrant": return 2.5 * unc + (view.seats[to].items >= 2 ? 1 : 0);
    case "black_letter": return (1 - pa) * 5 + expectedAt(enemyItems, to) * 1.5;
    case "broken_mirror": return 1 + (1 - pa);
    case myKind: return pa >= 0.9 ? 1.5 : -5;
    case enemyKind: return pa >= 0.8 ? 1.2 : -1;
    case `case_${myKind}`: return pa >= 0.9 ? 1 : -3;
    case `case_${enemyKind}`: return 0.5;
    case "first_class_ticket": return -4;
    case "codebook": case "trench_coat": return me.tradeUsed ? 2.5 : 1;
    case "timetable": return 0.8;
    default: return pa >= 0.7 ? 0.6 : 0.1; // fight items help an ally
  }
}

function attackScore(ctx, target, K) {
  const { ally, view, myItems, enemyItems, mine } = ctx;
  const pa = ally[target];
  const unc = 1 - Math.abs(2 * pa - 1);
  const out = fightOutlook(ctx, view.seat, target, K.edge);
  const pWin = out.pAttackerWins;
  const tradeKnown = view.seats[target].trade !== null || view.knowledge.some((k) => k.k === "trade" && k.seat === target);
  // A won scuffle is the cheapest look at a gang and a trade there is, and
  // the only way to take a card from someone who will not trade it.
  const info = unc * 4 + (tradeKnown ? 0 : 1);
  const take = pAtLeast(myItems, target, 1) * 6 + pAtLeast(enemyItems, target, 1) * 1.5 + (view.seats[target].items ? 0.5 : 0);
  const loss = 2 + mine * 1.5;
  let score = 0.5 + pWin * (info + take) - (1 - pWin) * loss * 0.4;
  if (pa >= 0.85) score -= 3;
  if (pWin < K.attackAt) score -= 1;
  return score;
}
