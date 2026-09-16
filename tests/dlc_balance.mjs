// Balance runs for the expansion cards. Plays bot games (normal level) with
// each card switched on alone, and all four together, and reports the table
// (gang split, wrong declarations, solo wins, length, scuffles) and, for every
// trade, how often the seat dealt it ends on the winning side against the
// average seat. The old ten trades are the yardstick for the new ones.
//
//   node tests/dlc_balance.mjs 300            # 300 games per cell, 3..10 players
//   node tests/dlc_balance.mjs 300 5 6 7      # only these counts
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Each configuration is the options object a game is created with.
export const CONFIGS = {
  base: {},
  gold: { dlc: { gold: true } },
  double: { dlc: { double: true } },
  porter: { dlc: { porter: true } },
  gambler: { dlc: { gambler: true } },
  all: { dlc: { gold: true, double: true, porter: true, gambler: true } },
  events: { events: true },
  everything: { events: true, dlc: { gold: true, double: true, porter: true, gambler: true } },
};

function playOne(seed, n, options) {
  const rng = E.makeRng(seed);
  let st = E.createGame(rng.int(2 ** 31), n, options);
  const dealt = st.seats.map((sd) => sd.trade);
  const goldAt = (s) => s.seats.findIndex((sd) => sd.items.some((id) => s.items[id] === "gold_bar"));
  const goldStart = goldAt(st);
  const x = { lies: 0, bribes: 0, bribeSkipped: 0, dice: [0, 0, 0], gamblerFights: 0, gamblerWon: 0, porterPeak: 0, yields: 0 };
  let steps = 0;
  while (st.phase !== "over") {
    if (++steps > 8000) return null;
    const who = E.mustAct(st);
    const seat = who[rng.int(who.length)];
    const legal = E.legalActions(st, seat);
    const a = B.decide(E.view(st, seat), legal, "normal", rng);
    if (a.type === "disguise" && a.lie) x.lies++;
    if (a.type === "yieldItem") x.yields++;
    if (a.type === "bribe") { if (a.pay) x.bribes++; else if (legal.some((l) => l.pay)) x.bribeSkipped++; }
    const before = st.log.length;
    st = E.apply(st, a);
    for (let i = before; i < st.log.length; i++) {
      const e = st.log[i];
      if (e.type === "scuffle" && e.dice) { x.dice[e.dice.roll]++; x.gamblerFights++; if (e.winner === e.dice.seat) x.gamblerWon++; }
    }
    for (const sd of st.seats) if (sd.trade === "porter") x.porterPeak = Math.max(x.porterPeak, sd.items.length);
  }
  const won = st.seats.map((sd, s) => (typeof st.winner === "number" ? st.winner === s : sd.gang === st.winner));
  return { winner: typeof st.winner === "number" ? "solo" : st.winner, reason: st.reason, turns: st.turnNo, dealt, won, goldStart, goldEnd: goldAt(st),
    scuffles: st.log.filter((e) => e.type === "scuffle" && e.stopped == null).length, x };
}

function emptyAgg() {
  return { games: 0, stalled: 0, tk: 0, sb: 0, solo: 0, wrong: 0, turns: 0, scuffles: 0, seats: 0, seatWins: 0, trade: {},
    goldStart: [0, 0], goldEnd: [0, 0], lies: 0, bribes: 0, bribeSkipped: 0, dice: [0, 0, 0], gamblerFights: 0, gamblerWon: 0, porterGames: 0, porterOverGames: 0, yields: 0 };
}

function cell(config, n, games, seed) {
  const agg = emptyAgg();
  for (let g = 0; g < games; g++) {
    const r = playOne(seed * 100003 + n * 7919 + g, n, CONFIGS[config]);
    if (!r) { agg.stalled++; continue; }
    agg.games++;
    if (r.winner === "solo") agg.solo++; else if (r.winner === E.TIMEKEEPERS) agg.tk++; else agg.sb++;
    if (r.reason === "wrong") agg.wrong++;
    agg.turns += r.turns; agg.scuffles += r.scuffles;
    r.dealt.forEach((tr, s) => { const t = (agg.trade[tr] ||= [0, 0]); t[0]++; t[1] += r.won[s] ? 1 : 0; agg.seats++; agg.seatWins += r.won[s] ? 1 : 0; });
    if (r.goldStart >= 0) { agg.goldStart[0]++; agg.goldStart[1] += r.won[r.goldStart] ? 1 : 0; }
    if (r.goldEnd >= 0) { agg.goldEnd[0]++; agg.goldEnd[1] += r.won[r.goldEnd] ? 1 : 0; }
    agg.lies += r.x.lies; agg.bribes += r.x.bribes; agg.bribeSkipped += r.x.bribeSkipped; agg.yields += r.x.yields;
    r.x.dice.forEach((d, i) => { agg.dice[i] += d; });
    agg.gamblerFights += r.x.gamblerFights; agg.gamblerWon += r.x.gamblerWon;
    if (r.dealt.includes("porter")) { agg.porterGames++; if (r.x.porterPeak > E.HAND_LIMIT[n]) agg.porterOverGames++; }
  }
  return agg;
}

function merge(a, b) {
  for (const k of Object.keys(b)) {
    if (k === "trade") for (const [tr, [s, w]] of Object.entries(b.trade)) { const t = (a.trade[tr] ||= [0, 0]); t[0] += s; t[1] += w; }
    else if (Array.isArray(b[k])) b[k].forEach((v, i) => { a[k][i] += v; });
    else a[k] += b[k];
  }
  return a;
}

const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;

function report(name, a, perN) {
  const g = a.games || 1;
  const avg = a.seatWins / (a.seats || 1);
  console.log(`\n== ${name} == ${a.games} games${a.stalled ? `, ${a.stalled} stalled` : ""}`);
  console.log(`  鐘樓會 ${pct(a.tk / g)} · 印信社 ${pct(a.sb / g)} · 獨自下車 ${pct(a.solo / g)} · 攤牌說錯 ${pct(a.wrong / g)} · 平均 ${(a.turns / g).toFixed(1)} 回合 · 衝突 ${(a.scuffles / g).toFixed(1)} 次/局 · 座位平均勝率 ${pct(avg, 1)}`);
  console.log("  per count: " + Object.entries(perN).map(([n, c]) => `${n}人 TK${pct(c.tk / (c.games || 1))} 解${pct(c.solo / (c.games || 1))} ${(c.turns / (c.games || 1)).toFixed(0)}回`).join(" | "));
  const rows = Object.entries(a.trade).map(([tr, [s, w]]) => ({ tr, s, rate: w / s, delta: w / s - avg, se: Math.sqrt((w / s) * (1 - w / s) / s) }))
    .sort((x, y) => y.delta - x.delta);
  console.log("  trade (dealt)        seats   win%    vs avg   ±1se");
  for (const r of rows) {
    const mark = ["double", "porter", "gambler"].includes(r.tr) ? " ◀ new" : "";
    console.log(`  ${r.tr.padEnd(18)} ${String(r.s).padStart(6)}  ${pct(r.rate, 1).padStart(6)}  ${(r.delta >= 0 ? "+" : "") + (r.delta * 100).toFixed(1).padStart(4)}pp  ${(r.se * 100).toFixed(1)}${mark}`);
  }
  if (a.goldStart[0]) console.log(`  gold bar: dealt-holder win ${pct(a.goldStart[1] / a.goldStart[0], 1)} (${a.goldStart[0]}), end-holder win ${pct(a.goldEnd[1] / (a.goldEnd[0] || 1), 1)} (${a.goldEnd[0]}), paid ${(a.bribes / g).toFixed(2)}/game, held but not paid ${(a.bribeSkipped / g).toFixed(2)}/game`);
  if (a.lies) console.log(`  double agent: lies ${(a.lies / g).toFixed(2)}/game`);
  if (a.gamblerFights) console.log(`  gambler: dice 0/1/2 = ${a.dice.join("/")}, fights ${(a.gamblerFights / g).toFixed(2)}/game, won ${pct(a.gamblerWon / a.gamblerFights, 1)} of them`);
  if (a.porterGames) console.log(`  porter: went past the normal limit in ${pct(a.porterOverGames / a.porterGames, 1)} of games it was dealt; picked the bag taken ${(a.yields / a.porterGames).toFixed(2)} times per game dealt`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain && process.argv[2] === "--cell") {
  const [, , , config, n, games, seed] = process.argv;
  process.stdout.write(JSON.stringify(cell(config, Number(n), Number(games), Number(seed))));
} else if (isMain) {
  const games = Number(process.argv[2]) || 200;
  const counts = process.argv.slice(3).map(Number).filter(Boolean);
  const ns = counts.length ? counts : [3, 4, 5, 6, 7, 8, 9, 10];
  const self = fileURLToPath(import.meta.url);
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const names = onlyArg ? onlyArg.slice(7).split(",") : Object.keys(CONFIGS);
  const jobs = [];
  for (const config of names) for (const n of ns) jobs.push({ config, n });
  const results = {};
  const t0 = Date.now();
  let done = 0;
  const runJob = (job, attempt = 0) => new Promise((resolve) => {
    const p = spawn(process.execPath, [self, "--cell", job.config, String(job.n), String(games), "7"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => {
      if (code === 0 && out) {
        results[`${job.config}/${job.n}`] = JSON.parse(out);
        process.stderr.write(`  ${++done}/${jobs.length} ${job.config} n=${job.n} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
        resolve();
      } else if (attempt < 3) {
        process.stderr.write(`  retry ${job.config} n=${job.n}: exit ${code} ${err.slice(-200)}\n`);
        resolve(runJob(job, attempt + 1));
      } else { process.stderr.write(`  FAILED ${job.config} n=${job.n}\n`); resolve(); }
    });
  });
  const queue = jobs.slice();
  const workers = Array.from({ length: Math.max(1, cpus().length - 2) }, async () => { while (queue.length) await runJob(queue.shift()); });
  await Promise.all(workers);
  writeFileSync(new URL(`../.wrangler/dlc_balance${onlyArg ? "_" + names.join("_") : ""}.json`, import.meta.url), JSON.stringify({ games, ns, results }, null, 1));
  console.log(`${games} games per cell, counts ${ns.join(",")}, normal bots, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const config of names) {
    const perN = {};
    const all = emptyAgg();
    for (const n of ns) { const r = results[`${config}/${n}`]; if (r) { perN[n] = r; merge(all, r); } }
    report(config, all, perN);
  }
}
