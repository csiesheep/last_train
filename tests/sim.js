// Bot-vs-bot harness. Plays whole games through the engine with every seat a
// bot, and reports who wins and how, per player count and level matchup.
// This is how the bots get tuned: by numbers, not by feel.
//
//   node tests/sim.js                 # default: 200 games × 3..10 players × matchups
//   node tests/sim.js 500 6           # 500 games, 6 players only
//   node tests/sim.js 300 0 normal hard   # Timekeepers level, Sealbearers level
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";

export function playGame(seed, n, tkLevel, sbLevel, options = {}) {
  const rng = E.makeRng(seed);
  let st = E.createGame(rng.int(2 ** 31), n, options);
  let steps = 0;
  while (st.phase !== "over") {
    if (++steps > 6000) return { st, stalled: true, steps };
    const who = E.mustAct(st);
    const seat = who[rng.int(who.length)];
    const level = st.seats[seat].gang === E.TIMEKEEPERS ? tkLevel : sbLevel;
    const action = B.decide(E.view(st, seat), E.legalActions(st, seat), level, rng);
    if (!action) throw new Error(`bot in seat ${seat} returned no action during ${st.phase}`);
    st = E.apply(st, action);
    if (st.phase === "over") return { st, stalled: false, steps, last: action };
  }
  return { st, stalled: false, steps, last: null };
}

export function simulate({ games = 200, n = 6, tkLevel = "normal", sbLevel = "normal", seed = 1, options = {} } = {}) {
  const out = { games, n, tkLevel, sbLevel, tkWins: 0, sbWins: 0, solo: 0, declared: 0, wrong: 0, stalled: 0,
    turns: 0, scuffles: 0, trades: 0, declarerWon: 0, minorityWins: 0, minorityGames: 0,
    // calibration: the confidence bots declared at, against how often they were right
    pSum: 0, pCount: 0 };
  for (let g = 0; g < games; g++) {
    const { st, stalled, last } = playGame(seed * 100003 + g, n, tkLevel, sbLevel, options);
    if (stalled) { out.stalled++; continue; }
    if (last && last.type === "declare" && typeof last.p === "number") { out.pSum += last.p; out.pCount++; }
    if (st.winner === E.TIMEKEEPERS) out.tkWins++;
    else if (st.winner === E.SEALBEARERS) out.sbWins++;
    else out.solo++;
    if (st.reason === "declared") { out.declared++; out.declarerWon++; }
    if (st.reason === "wrong") {
      out.wrong++;
      // why was it wrong: an enemy named, an ally short of the items claimed, or the total short
      const d = st.log[st.log.length - 1];
      const gangWrong = d.revealed.slice(1).some((r) => r.gang !== d.gang);
      const itemWrong = !gangWrong && d.revealed.slice(1).some((r) => r.items.filter((id) => E.goalKindOf(st, id) === E.GOAL[d.gang]).length < d.holders[r.seat]);
      out.wrongGang = (out.wrongGang || 0) + (gangWrong ? 1 : 0);
      out.wrongItems = (out.wrongItems || 0) + (itemWrong ? 1 : 0);
      out.wrongTotal = (out.wrongTotal || 0) + (!gangWrong && !itemWrong ? 1 : 0);
    }
    out.turns += st.turnNo;
    out.scuffles += st.log.filter((e) => e.type === "scuffle" && e.stopped == null).length;
    out.trades += st.log.filter((e) => e.type === "trade" && e.accepted).length;
    if (st.minority) { out.minorityGames++; if (st.winner === st.minority) out.minorityWins++; }
  }
  const done = games - out.stalled || 1;
  out.tkRate = out.tkWins / done;
  out.wrongRate = out.wrong / done;
  out.soloRate = out.solo / done;
  out.avgTurns = out.turns / done;
  out.avgScuffles = out.scuffles / done;
  out.avgTrades = out.trades / done;
  out.minorityRate = out.minorityGames ? out.minorityWins / out.minorityGames : null;
  out.meanP = out.pCount ? out.pSum / out.pCount : null;
  out.hitRate = out.pCount ? out.declared / out.pCount : null;
  return out;
}

// ---------- CLI ----------
// Each cell runs in its own child process, retried on a non-zero exit. Node
// 24 on the development machine dies with an access violation (0xC0000005)
// a few percent of the time on long runs of this workload, regardless of V8
// flags; isolating cells keeps one crash from taking the whole table down.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain && process.argv[2] === "--cell") {
  const [, , , tkLevel, sbLevel, n, games, seed, smuggling] = process.argv;
  const o = simulate({ games: Number(games), n: Number(n), tkLevel, sbLevel, seed: Number(seed), options: { smuggling: smuggling === "1" } });
  process.stdout.write(JSON.stringify(o));
} else if (isMain) {
  const SMUGGLING = process.argv.includes("--smuggling");
  const seedArg = process.argv.find((a) => a.startsWith("--seed="));
  const SEED = seedArg ? Number(seedArg.slice(7)) : 1;
  const VERBOSE = process.argv.includes("--verbose");
  const argv = process.argv.filter((a) => a !== "--smuggling" && a !== "--verbose" && !a.startsWith("--seed="));
  const games = Number(argv[2]) || 200;
  const only = Number(argv[3]) || null;
  const matchups = argv[4]
    ? [[argv[4], argv[5] || argv[4]]]
    : [["easy", "easy"], ["normal", "normal"], ["hard", "hard"], ["normal", "hard"], ["hard", "normal"]];
  const counts = only ? [only] : [3, 4, 5, 6, 7, 8, 9, 10];
  const self = fileURLToPath(import.meta.url);
  const cell = (a, b, n) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = spawnSync(process.execPath, [self, "--cell", a, b, String(n), String(games), String(SEED), SMUGGLING ? "1" : "0"], { encoding: "utf8", maxBuffer: 1 << 26 });
      if (res.status === 0 && res.stdout) {
        const o = JSON.parse(res.stdout);
        if (VERBOSE) process.stderr.write(`  n=${n} ${a}/${b}: TK ${o.tkWins} SB ${o.sbWins} solo ${o.solo} | wrong gang ${o.wrongGang || 0} items ${o.wrongItems || 0} total ${o.wrongTotal || 0}\n`);
        return o;
      }
      process.stderr.write(`cell ${a}/${b} n=${n} attempt ${attempt + 1} exited ${res.status}: ${(res.stderr || "").slice(-300)}\n`);
    }
    return null;
  };
  console.log(`${games} games each${SMUGGLING ? ", smuggling on" : ""}. Timekeepers win % (wrong-declaration % / solo %) | avg turns | scuffles/trades per game | minority win % | declared at mean p → hit %`);
  console.log("TK/SB     " + counts.map((n) => String(n).padStart(30)).join(""));
  for (const [a, b] of matchups) {
    const cells = counts.map((n) => {
      const o = cell(a, b, n);
      if (!o) return "crashed".padStart(30);
      const min = o.minorityRate === null ? "  -" : `${(o.minorityRate * 100).toFixed(0).padStart(3)}`;
      const cal = o.meanP === null ? "" : ` .${(o.meanP * 100).toFixed(0)}→${(o.hitRate * 100).toFixed(0)}`;
      return `${(o.tkRate * 100).toFixed(0).padStart(3)}% (${(o.wrongRate * 100).toFixed(0).padStart(2)}/${(o.soloRate * 100).toFixed(0).padStart(2)}) ${o.avgTurns.toFixed(0).padStart(3)} ${o.avgScuffles.toFixed(1)}/${o.avgTrades.toFixed(1)} ${min}${cal}${o.stalled ? " !" + o.stalled : ""}`.padStart(30);
    });
    console.log(`${a}/${b}`.padEnd(10) + cells.join(""));
  }
}
