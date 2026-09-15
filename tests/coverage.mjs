// Coverage fuzz: plays bot games at every player count and checks, after
// every single action, that the engine keeps its invariants, and at the end
// that every item text and every trade power actually fired somewhere.
//
//   node tests/coverage.mjs            # 120 games × 3..10 players
//   node tests/coverage.mjs 400 6      # 400 games, six players only
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

const GAMES = Number(process.argv[2] || 120);
const ONLY = Number(process.argv[3] || 0);
const LEVELS = ["easy", "normal", "hard"];

const hit = {};
const bump = (k) => { hit[k] = (hit[k] || 0) + 1; };
const problems = [];
const problem = (msg, ctx) => { if (problems.length < 40) problems.push({ msg, ...ctx }); };

function allIds(st) {
  const ids = [];
  for (const sd of st.seats) ids.push(...sd.items);
  ids.push(...st.pile);
  if (st.trade && st.trade.offered && !ids.includes(st.trade.offered)) ids.push(st.trade.offered);
  return ids;
}

function checkInvariants(st, before, action, ctx) {
  const ids = allIds(st);
  const set = new Set(ids);
  if (set.size !== ids.length) problem("duplicate item id", { ...ctx, action, dup: ids.filter((x, i) => ids.indexOf(x) !== i) });
  const expected = Object.keys(st.items).length;
  if (set.size !== expected) problem(`item count ${set.size} != ${expected}`, { ...ctx, action, phase: st.phase, step: st.scuffle?.step || st.trade?.step, missing: Object.keys(st.items).filter((id) => !set.has(id)) });
  if (st.phase === "turn") {
    const lim = E.handLimit(st);
    st.seats.forEach((sd, s) => { if (sd.items.length > lim) problem(`seat ${s} holds ${sd.items.length} > limit ${lim} on a turn`, { ...ctx, action }); });
  }
  st.seats.forEach((sd, s) => {
    const def = E.TRADE_BY_ID[sd.trade];
    if (sd.tradeUsed && !def.once) problem(`always-on trade ${sd.trade} marked used`, { ...ctx, action, seat: s });
  });
  if (st.pile.length < 0) problem("negative pile", ctx);
  // the view must never leak another seat's gang or hand
  const v = E.view(st, 0);
  v.seats.forEach((sd, s) => { if (s !== 0 && st.phase !== "over" && (sd.gang || sd.hand)) problem("view leaks gang or hand", { ...ctx, seat: s }); });
}

function tally(st, before, action) {
  for (let i = before.log.length; i < st.log.length; i++) {
    const e = st.log[i];
    bump("log:" + e.type);
    if (e.type === "trade" && e.accepted) { bump("trade:accepted"); if (e.forced) bump("trade:forced"); for (const a of e.announced || []) bump("item.trade:" + a.kind); if ((e.drew || []).length) bump("item.trade:case_draw"); }
    if (e.type === "codebook") bump(e.swapped ? "item:codebook.swapped" : "item:codebook.kept");
    if (e.type === "coat") bump(e.changed ? "item:trench_coat.changed" : "item:trench_coat.kept");
    if (e.type === "timetable") bump("item:timetable");
    if (e.type === "demand") bump(e.had ? "trade:diplomat.had" : "trade:diplomat.none");
    if (e.type === "fortune") bump("trade:fortune_teller");
    if (e.type === "solo") bump("item:first_class_ticket.solo");
    if (e.type === "declare") { bump(e.correct ? "declare:right" : "declare:wrong"); }
    if (e.type === "scuffle") {
      if (e.stopped != null) { bump("trade:priest.stopped"); if (e.paid) bump("trade:priest.paid"); continue; }
      if (e.doctored != null) { bump("trade:doctor"); continue; }
      if (e.gunman != null) bump("trade:gunman");
      if (e.hypnotized != null) bump("trade:hypnotist");
      if (e.pharmacist != null) bump("trade:pharmacist");
      if (e.tie) bump(e.drew ? "scuffle:tie.drew" : "scuffle:tie.empty");
      else bump("scuffle:" + e.choice);
      for (const x of Object.values(e.shown || {})) { for (const k of x.items || []) bump("item.fight:" + k); if (x.trade) bump("trade.fight:" + x.trade); }
      const backers = Object.values(e.support || {});
      if (backers.includes("attacker")) bump("support:attacker");
      if (backers.includes("defender")) bump("support:defender");
      if (backers.includes("out")) bump("support:out");
    }
  }
  if (action.type === "answer" && action.accept === false) bump("trade:refused");
}

// legal-action probes: must-accept cards leave no refusal on the table
function probe(st) {
  if (st.phase === "trade" && st.trade.step === "answer") {
    const legal = E.legalActions(st, st.trade.to);
    const kind = st.items[st.trade.offered];
    const canRefuse = legal.some((a) => a.type === "answer" && a.accept === false);
    if (E.ITEM_BY_KIND[kind].mustAccept) { bump("item:" + kind + ".mustAccept"); if (canRefuse) problem(`${kind} could be refused`, {}); }
    else if (!canRefuse) bump("trade:noRefuseOption");
  }
  if (st.phase === "turn") {
    const legal = E.legalActions(st, st.turn);
    const sd = st.seats[st.turn];
    const hasLetter = sd.items.some((id) => st.items[id] === "black_letter");
    if (hasLetter && legal.some((a) => a.type === "declare")) problem("declare offered while holding the poison-pen letter", { seat: st.turn });
    if (legal.some((a) => a.type === "solo")) bump("legal:solo");
    if (legal.some((a) => a.type === "declare")) bump("legal:declare");
  }
}

let games = 0, errors = 0, steps = 0;
const t0 = Date.now();
for (let n = 3; n <= 10; n++) {
  if (ONLY && n !== ONLY) continue;
  for (let g = 0; g < GAMES; g++) {
    const seed = n * 1000003 + g * 7919;
    const rng = E.makeRng(seed);
    const smuggling = g % 5 === 0;
    let st = E.createGame(rng.int(2 ** 31), n, { smuggling });
    const levels = st.seats.map(() => LEVELS[rng.int(3)]);
    games++;
    let k = 0;
    try {
      while (st.phase !== "over" && k++ < 8000) {
        const who = E.mustAct(st);
        if (!who.length) { problem("nobody must act", { n, seed, phase: st.phase }); break; }
        const seat = who[rng.int(who.length)];
        const legal = E.legalActions(st, seat);
        if (!legal.length) { problem("no legal actions for a seat that must act", { n, seed, phase: st.phase, step: st.scuffle?.step || st.trade?.step, seat }); break; }
        const action = B.decide(E.view(st, seat), legal, levels[seat], rng);
        if (!action) { problem("bot returned nothing", { n, seed, phase: st.phase, seat }); break; }
        const before = st;
        st = E.apply(st, action);
        steps++;
        checkInvariants(st, before, action, { n, seed });
        tally(st, before, action);
        probe(st);
      }
      if (st.phase !== "over") problem("game did not finish", { n, seed, phase: st.phase, k });
      else { bump("end:" + st.reason); if (typeof st.winner === "number") bump("end:solo"); if (st.minority && st.winner === st.minority) bump("end:minorityWon"); }
    } catch (err) {
      errors++;
      problem("engine threw: " + err.message, { n, seed, phase: st.phase, step: st.scuffle?.step || st.trade?.step });
    }
  }
}

const expect = [
  ...E.ITEMS.filter((it) => it.trade).map((it) => it.id === "case_watch" || it.id === "case_seal" ? "item.trade:case_draw" : it.trade === "swap_trades" ? "item:codebook.swapped" : it.trade === "new_trade" ? "item:trench_coat.changed" : it.trade === "everyone_passes" ? "item:timetable" : "item.trade:" + it.id),
  ...E.ITEMS.filter((it) => it.fight).map((it) => "item.fight:" + it.id),
  ...E.ITEMS.filter((it) => it.mustAccept).map((it) => "item:" + it.id + ".mustAccept"),
  "item:first_class_ticket.solo",
  "trade:diplomat.had", "trade:diplomat.none", "trade:doctor", "trade:gunman", "trade:pharmacist", "trade:fortune_teller", "trade:hypnotist", "trade:priest.stopped", "trade:priest.paid",
  "trade.fight:master", "trade.fight:thug", "trade.fight:bodyguard",
  "scuffle:take", "scuffle:peek", "scuffle:tie.drew", "support:attacker", "support:defender", "support:out",
  "declare:right", "declare:wrong", "end:minorityWon", "trade:refused", "trade:accepted",
];
const missing = expect.filter((k) => !hit[k]);
console.log(`${games} games, ${steps} actions, ${errors} engine errors, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("coverage:");
for (const k of Object.keys(hit).sort()) console.log(`  ${k.padEnd(34)} ${hit[k]}`);
console.log(missing.length ? `NEVER FIRED: ${missing.join(", ")}` : "every item text and trade power fired at least once");
if (problems.length) { console.log(`PROBLEMS (${problems.length}):`); for (const p of problems) console.log("  " + JSON.stringify(p)); }
process.exit(problems.length || missing.length ? 1 : 0);
