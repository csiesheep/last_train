// The 戰報 (a storyteller's account of one finished game). What a full record
// (record.js, scope "full") is reduced to before a model writes the story, and
// what the report page draws beside it. Shared: the report page and the Worker
// load it as is. DOM-free.
//
//   reportKey(rec)       -> Promise<hex>  SHA-256 of the game itself: seed, seats,
//                                         options and moves. Nothing about who
//                                         exported it, the names or the language,
//                                         so every copy of one game has one key.
//   buildDigest(rec)     -> the language-neutral digest: seats by number, items by kind.
//   digestText(d, lang)  -> the digest in words for the model ("zh" or "en"), told
//                           as things that happened on a train, not as a game.
//   moments(d, lang)     -> a few lines to read while the story is being written.
//
// Everything is rebuilt by replaying the moves through the engine, never read
// from the record's log or final table: a page can send any log it likes. A
// record that does not replay to a finished game, or whose result is not the
// replay's, is refused (throws). The same game gives the same digest, byte for
// byte, whoever sent it.
import * as E from "./engine.js";
import { FORMAT, FORMAT_VERSION } from "./record.js";
import { isFace, passengerName } from "./passengers.js";
import zhS from "../i18n/zh-Hant.js";
import enS from "../i18n/en.js";

export const DIGEST_VERSION = 1;
export const MAX_ACTIONS = 4000; // the longest ten-seat bot games play ~1,200
const GOALS = new Set(["watch", "seal"]);

// ---------- the key ----------
function canon(x) {
  if (Array.isArray(x)) return "[" + x.map((v) => (v === undefined ? "null" : canon(v))).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}
function gameOf(rec) {
  if (!rec || typeof rec !== "object") throw new Error("report: not a record");
  if (rec.format !== FORMAT || rec.version !== FORMAT_VERSION) throw new Error("report: not a last-train/game record");
  if (rec.scope !== "full") throw new Error("report: only a full record can be told");
  const { seed, seats, options, actions } = rec;
  if (!Number.isInteger(seed)) throw new Error("report: bad seed");
  if (!Number.isInteger(seats) || seats < E.MIN_PLAYERS || seats > E.MAX_PLAYERS) throw new Error("report: bad seat count");
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("report: no options");
  if (!Array.isArray(actions) || !actions.length) throw new Error("report: no moves");
  if (actions.length > MAX_ACTIONS) throw new Error("report: too many moves");
  const opts = { smuggling: !!options.smuggling, events: !!options.events, dlc: options.dlc && typeof options.dlc === "object" ? Object.fromEntries(E.EXPANSIONS.filter((k) => options.dlc[k]).map((k) => [k, true])) : null };
  return { seed, seats, options: opts, actions };
}
export async function reportKey(rec) {
  const g = gameOf(rec);
  const text = "last-train-report-key/1\n" + canon(g);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- names ----------
const cleanName = (s) => String(s ?? "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 16);
function castOf(rec, st) {
  const ps = Array.isArray(rec.passengers) ? rec.passengers : [];
  const seen = new Set();
  return st.seats.map((sd, seat) => {
    const p = ps.find((x) => x && x.seat === seat) || {};
    let name = cleanName(p.name) || "";
    if (!name || seen.has(name)) name = `#${seat + 1}`;
    seen.add(name);
    const face = isFace(p.face) ? p.face : null;
    // a passenger still under their face's own name is called by it in each language
    const own = face && [passengerName(face, "zh-Hant"), passengerName(face, "en")].includes(name);
    return { seat, name, names: { zh: own ? passengerName(face, "zh-Hant") : name, en: own ? passengerName(face, "en") : name }, face, gang: sd.gang, trade: sd.trade };
  });
}

// ---------- the replay ----------
// Who holds each item (a seat, or null for the luggage van), before and after.
function owners(st) {
  const o = {};
  for (const id of Object.keys(st.items)) o[id] = null;
  st.seats.forEach((sd, s) => { for (const id of sd.items) o[id] = s; });
  return o;
}
const stopOf = (turn, n) => Math.max(1, Math.ceil(turn / n));

export function buildDigest(rec) {
  const g = gameOf(rec);
  let st = E.createGame(g.seed, g.seats, g.options);
  const n = st.n;
  let own = owners(st);
  const known = st.knowledge.map((k) => k.length);
  let moves = [], learned = [], passes = [];
  const lines = [];
  for (const raw of g.actions) {
    if (st.phase === "over") throw new Error("report: moves after the end of the game");
    const { t, ...a } = raw || {};
    const logAt = st.log.length;
    st = E.apply(st, a);
    const now = owners(st);
    // the timetable's pass-around is everyone at once, not the trade that set it off
    const into = a.type === "passItem" ? passes : moves;
    for (const id of Object.keys(now)) if (now[id] !== own[id]) into.push({ kind: st.items[id], from: own[id], to: now[id] });
    own = now;
    const over = st.phase === "over"; // the end shows everyone everything: that is not anybody finding out
    st.knowledge.forEach((k, s) => {
      for (const f of over ? [] : k.slice(known[s])) {
        if (f.seat === s || f.seat == null) continue;
        if (f.k === "gang" || f.k === "trade") learned.push({ who: s, of: f.seat, k: f.k, v: f[f.k] });
        if (f.k === "hand") learned.push({ who: s, of: f.seat, k: "hand", v: (f.items || []).map((x) => x.kind) });
      }
      known[s] = k.length;
    });
    const fresh = st.log.slice(logAt);
    let given = false;
    fresh.forEach((e) => {
      const line = { ...e, stop: stopOf(e.t ?? st.turnNo, n) };
      // What moved and what was learnt goes with the first entry after it. The
      // codebook, the coat and the timetable are logged inside a trade, before
      // the trade's own entry: the bags the trade moved wait for that one.
      if (!given && !["codebook", "coat", "timetable"].includes(e.type)) { line.moves = moves; line.learned = learned; moves = []; learned = []; given = true; }
      lines.push(line);
      if (passes.length && e.type === "trade") { lines.push({ type: "passes", stop: line.stop, moves: passes }); passes = []; }
    });
  }
  if (st.phase !== "over") throw new Error("report: the game is not over");
  if (rec.result && rec.result.winner !== undefined && rec.result.winner !== st.winner) throw new Error("report: the result is not the replay's");
  if (moves.length || learned.length) { const last = lines[lines.length - 1]; last.moves = [...(last.moves || []), ...moves]; last.learned = [...(last.learned || []), ...learned]; }

  const cast = castOf(rec, st);
  const stops = stopOf(st.turnNo, n);
  // replay again for the table at the end of every stop (who holds what)
  const ends = tablesAtStopEnds(g, stops);
  const turns = [];
  for (let s = 1; s <= stops; s++) {
    const here = lines.filter((l) => l.stop === s && l.type !== "start");
    const hot = new Set(), items = new Set();
    for (const l of here) {
      if (l.type === "scuffle" && l.winner != null) { hot.add(l.attacker); hot.add(l.defender); }
      for (const m of l.moves || []) items.add(m.kind);
      if (l.type === "demand") items.add(l.kind);
      if (l.type === "event" && l.kind) items.add(l.kind);
      if (l.type === "scuffle" && l.shown) for (const x of Object.values(l.shown)) for (const k of x.items || []) items.add(k);
    }
    const end = ends[s - 1];
    const held = end.map((kinds) => kinds.slice());
    const gangHold = (gang) => held.reduce((sum, kinds, seat) => sum + (st.seats[seat].gang === gang ? kinds.filter((k) => k === E.GOAL[gang]).length : 0), 0);
    turns.push({
      stop: s,
      event: here.find((l) => l.type === "event" && !l.done) ? (({ id, kinds, watches, seals, cases }) => ({ id, kinds, watches, seals, cases }))(here.find((l) => l.type === "event" && !l.done)) : null,
      lines: here,
      key: rank(here),
      items: [...items].filter((k) => E.ITEM_BY_KIND[k]).sort(),
      hot: [...hot].sort((a, b) => a - b),
      held,
      goals: { [E.TIMEKEEPERS]: gangHold(E.TIMEKEEPERS), [E.SEALBEARERS]: gangHold(E.SEALBEARERS) },
    });
  }
  const last = [...lines].reverse().find((l) => l.type === "declare" || l.type === "solo");
  return {
    version: DIGEST_VERSION, n, stops, turn: st.turnNo,
    winner: st.winner, reason: st.reason, by: last ? last.seat : null, correct: last && last.type === "declare" ? !!last.correct : null,
    options: g.options, cast, turns,
  };
}
function tablesAtStopEnds(g, stops) {
  let st = E.createGame(g.seed, g.seats, g.options);
  const out = [];
  const snap = () => st.seats.map((sd) => sd.items.map((id) => st.items[id]).sort());
  for (const raw of g.actions) {
    const { t, ...a } = raw;
    const before = stopOf(st.turnNo, st.n);
    st = E.apply(st, a);
    if (stopOf(st.turnNo, st.n) > before && st.phase !== "over") out[before - 1] = snap();
  }
  out[stops - 1] = snap();
  for (let i = 0; i < stops; i++) if (!out[i]) out[i] = i ? out[i - 1] : snap();
  return out;
}

// The stop's lines that decided it, heaviest first, at most three (indices into lines).
function weight(l) {
  if (l.type === "declare" || l.type === "solo") return 100;
  const goalMoved = (l.moves || []).some((m) => GOALS.has(m.kind) && m.from != null && m.to != null);
  if (l.type === "scuffle" && l.stopped != null) return 35;
  if (l.type === "scuffle" && l.winner != null) return (l.choice === "take" ? 60 : 45) + (goalMoved ? 15 : 0) + Object.keys(l.support || {}).filter((k) => l.support[k] !== "out").length * 2;
  if (l.type === "scuffle") return 20;
  if (l.type === "demand") return l.had ? 45 + (goalMoved ? 10 : 0) : 15;
  if (l.type === "trade") return l.accepted ? 25 + (goalMoved ? 25 : 0) + (lie(l) ? 10 : 0) : 5;
  if (l.type === "event" && l.id === "password" && l.done) return 40;
  if (l.type === "event" && l.id && !l.done) return 18;
  if ((l.learned || []).length) return 22;
  if (l.type === "pass" || l.type === "start") return 0;
  return 12;
}
function rank(lines) {
  return lines.map((l, i) => ({ i, w: weight(l) })).filter((x) => x.w >= 20).sort((a, b) => b.w - a.w || a.i - b.i).slice(0, 3).map((x) => x.i);
}
// A trade where someone said they gave one thing and gave another.
function lie(l) {
  if (l.type !== "trade" || !l.accepted || !Array.isArray(l.announced)) return null;
  for (const a of l.announced) {
    const gave = (l.moves || []).find((m) => m.from === a.seat && m.to != null && m.to !== a.seat);
    if (gave && gave.kind !== a.kind) return { seat: a.seat, said: a.kind, gave: gave.kind };
  }
  return null;
}

// ---------- in words ----------
const W = {
  zh: {
    S: zhS, sep: "、", sp: "", q: (x) => `「${x}」`,
    stop: (s) => `第${zhNum(s)}站`,
    cast: "車上的乘客（結局時才揭曉的身分）：",
    castLine: (c, gang, trade) => `${c.name}：${gang}的人，行當是${trade}`,
    keyHead: "本站要事（依輕重）：", allHead: "詳細經過：", endHead: "這一站結束時：",
    none: "這一站沒有什麼大事。",
    event: { dining: (k) => `車到餐車站：大家瞥見行李車最上層是${k}。`, speaker: (w, s) => `車廂廣播：行李車裡還剩 ${w} 只懷錶、${s} 枚玉印。`, boiler: () => "鍋爐加壓，車身抖得厲害：這一站每個人能帶的行李少了。", lights: () => "車廂熄燈：黑暗裡動手的人不必亮出自己。", customs: () => "海關驗關：每個人都得打開一件行李給大家看。", password: () => "對暗號：大家要指認一個可疑的人。", quiet: () => "這一站平靜無事。" },
    pass: (a) => `${a}按兵不動。`,
    fortune: (a) => `${a}以算命師的本事，偷看了行李車最上面幾件，還調了它們的順序。`,
    demand: (a, b, k, had) => had ? `${a}以外交官的身分向${b}索要一件${k}，${b}真的有，只得交出。` : `${a}以外交官的身分向${b}索要一件${k}，${b}身上沒有。`,
    tradeNo: (a, b) => `${a}想把一件行李遞給${b}，${b}沒有收。`,
    trade: (a, b, x, y, forced) => `${a}與${b}交換了行李：${a}給出${x}，${b}回給${y}。${forced ? `（${b}不能拒收。）` : ""}`,
    tradeOne: (a, b, x, forced) => `${a}把${x}遞給了${b}。${forced ? `（${b}不能拒收。）` : ""}`,
    lie: (a, said, gave) => `${a}嘴上說給的是${said}，其實給的是${gave}。`,
    codebook: (a, b, sw) => sw ? `${a}用密碼本和${b}對調了行當。` : `${a}拿到密碼本，卻沒有和${b}對調行當。`,
    coat: (a, ch) => ch ? `${a}披上風衣，換了一個行當。` : `${a}披上風衣，行當沒換。`,
    timetable: (a, dir) => `${a}翻開時刻表：全車每人同時把一件行李傳給${dir === "left" ? "左" : "右"}邊的人。`,
    gift: (a, b) => `${a}行李太多，送了一件給${b}。`,
    stopped: (a, b, by, paid) => by === b ? `${a}要對${b}動手，${b}以神父的身分把事情勸了下來。` : `${a}要對${b}動手，${by}出面攔了下來${paid ? "（還付出了一點代價）" : ""}。`,
    scuffle: (a, b) => `${a}向${b}動手。`,
    sides: (x, a) => `${x}站到${a}這邊`,
    shown: (a, what) => `${a}亮出了${what}`,
    gunman: (g) => `槍手${g}出手相助`,
    hypno: (a, h) => `${a}以催眠師的本事，讓${h}只能旁觀`,
    coin: (a, r) => `賭徒${a}拋了銅板，多了 ${r} 分力`,
    tie: (sw, sh) => `兩邊 ${sw} 對 ${sh}，勢均力敵，不分勝負。`,
    won: (w, sw, sh) => `${sw} 對 ${sh}，${w}占了上風。`,
    took: (w, l, k) => `${w}從${l}那裡拿走了${k}。`,
    gaveBack: (w, l, k) => `${l}沒了行李，${w}還了一件${k}給他。`,
    moved: (k, a, b) => `${k}從${a}手上到了${b}手上。`,
    fromVan: (a, k) => `${a}從行李車取了一件${k}。`,
    toVan: (a, k) => `${a}的${k}放回了行李車。`,
    sawGang: (a, b, g) => `${a}看穿了${b}是${g}的人。`,
    sawTrade: (a, b, t) => `${a}得知${b}的行當是${t}。`,
    sawHand: (a, b, ks) => `${a}看了${b}全部的行李：${ks || "空的"}。`,
    password: (a, v, k) => `${v ? `${v} 個人` : "大家"}指認${a}；${a}打開行李亮出一件${k}。`,
    passes: () => "時刻表一翻開，全車每人同時把一件行李傳給鄰座。",
    passwordTie: () => "大家意見分歧，沒有人被指認。",
    declare: (a, g, ok) => ok ? `${a}當眾攤開行李，宣布${g}已經集齊，所言不虛。` : `${a}當眾攤開行李，宣布${g}已經集齊，卻說錯了。`,
    solo: (a) => `${a}握著頭等票和三件信物，獨自下車。`,
    holds: (item, who) => `${item}在${who}手上`,
    noGoal: "沒有人帶著懷錶或玉印",
    goals: (tk, sb) => `鐘樓會的人手上共有 ${tk} 只懷錶；印信社的人手上共有 ${sb} 枚玉印（任何一人湊齊自己幫會的三件，就能攤開）。`,
    result: (d, name) => d.reason === "solo" ? `結局：${name(d.by)}獨自下車，一個人贏了。` : `結局：${zhS.gang[d.winner]}勝。${d.by != null ? `${name(d.by)}在${W.zh.stop(d.stops)}攤開行李。` : ""}`,
    and: "，",
  },
  en: {
    S: enS, sep: ", ", q: (x) => `"${x}"`,
    stop: (s) => `Stop ${s}`,
    cast: "The passengers (who they really were, as the end revealed):",
    castLine: (c, gang, trade) => `${c.name}: ${gang}, by trade a ${trade}`,
    keyHead: "What mattered at this stop (weightiest first):", allHead: "Everything that happened:", endHead: "When the stop was over:",
    none: "Nothing of note happened at this stop.",
    event: { dining: (k) => `At the dining car everyone glimpsed the top of the luggage van: ${k}.`, speaker: (w, s) => `The carriage speaker announced ${w} pocket watches and ${s} jade seals still in the luggage van.`, boiler: () => "The boiler ran hot and the carriage shook: everyone could carry less at this stop.", lights: () => "The lights went out: whoever struck in the dark need not show themselves.", customs: () => "Customs: everyone had to open one bag for all to see.", password: () => "The password: everyone had to point at one suspicious passenger.", quiet: () => "The stop was quiet." },
    pass: (a) => `${a} held still.`,
    fortune: (a) => `${a}, a fortune teller, looked at the top of the luggage van and rearranged it.`,
    demand: (a, b, k, had) => had ? `${a}, as a diplomat, demanded a ${k} from ${b}, who had one and had to hand it over.` : `${a}, as a diplomat, demanded a ${k} from ${b}, who had none.`,
    tradeNo: (a, b) => `${a} offered ${b} a bag; ${b} refused it.`,
    trade: (a, b, x, y, forced) => `${a} and ${b} swapped bags: ${a} gave a ${x}, ${b} gave back a ${y}.${forced ? ` (${b} could not refuse.)` : ""}`,
    tradeOne: (a, b, x, forced) => `${a} handed ${b} a ${x}.${forced ? ` (${b} could not refuse.)` : ""}`,
    lie: (a, said, gave) => `${a} said it was a ${said}, but it was a ${gave}.`,
    codebook: (a, b, sw) => sw ? `${a} used the codebook to swap trades with ${b}.` : `${a} had the codebook but did not swap trades with ${b}.`,
    coat: (a, ch) => ch ? `${a} put on the trench coat and took up a new trade.` : `${a} put on the trench coat but kept the same trade.`,
    timetable: (a, dir) => `${a} opened the timetable: everyone passed one bag to the ${dir} at once.`,
    gift: (a, b) => `${a}, carrying too much, gave a bag to ${b}.`,
    stopped: (a, b, by, paid) => by === b ? `${a} went for ${b}, but ${b}, a priest, talked it down.` : `${a} went for ${b}, but ${by} stepped in and stopped it${paid ? ", at a price" : ""}.`,
    scuffle: (a, b) => `${a} went for ${b}.`,
    sides: (x, a) => `${x} sided with ${a}`,
    shown: (a, what) => `${a} showed ${what}`,
    gunman: (g) => `${g}, a gunman, stepped in`,
    hypno: (a, h) => `${a}, a hypnotist, left ${h} only able to watch`,
    coin: (a, r) => `${a}, a gambler, tossed a coin and gained ${r} more`,
    tie: (sw, sh) => `${sw} against ${sh}: neither side gave way.`,
    won: (w, sw, sh) => `${sw} against ${sh}: ${w} came out on top.`,
    took: (w, l, k) => `${w} took a ${k} from ${l}.`,
    gaveBack: (w, l, k) => `${l} had nothing left, so ${w} gave back a ${k}.`,
    moved: (k, a, b) => `A ${k} passed from ${a} to ${b}.`,
    fromVan: (a, k) => `${a} took a ${k} from the luggage van.`,
    toVan: (a, k) => `${a}'s ${k} went back to the luggage van.`,
    sawGang: (a, b, g) => `${a} saw that ${b} belonged to ${g}.`,
    sawTrade: (a, b, t) => `${a} learned that ${b} was a ${t}.`,
    sawHand: (a, b, ks) => `${a} saw everything ${b} carried: ${ks || "nothing"}.`,
    password: (a, v, k) => `${v ? `${v} passengers` : "The carriage"} pointed at ${a}, who opened a bag and showed a ${k}.`,
    passes: () => "With the timetable open, everyone passed one bag to their neighbour at once.",
    passwordTie: () => "Nobody agreed; no one was singled out.",
    declare: (a, g, ok) => ok ? `${a} opened their bags before everyone and declared that ${g} had all three: it was true.` : `${a} opened their bags before everyone and declared that ${g} had all three: it was wrong.`,
    solo: (a) => `${a} left the train alone, with the first-class ticket and three tokens.`,
    holds: (item, who) => `${{ "pocket watch": "pocket watches", "jade seal": "jade seals" }[item] || item}: ${who}`,
    noGoal: "nobody carried a pocket watch or a jade seal",
    goals: (tk, sb) => `The Clocktower Society held ${tk} pocket watches between them; the Seal Society held ${sb} jade seals (anyone holding three of their own society's could open their bags and win).`,
    result: (d, name) => d.reason === "solo" ? `The end: ${name(d.by)} left the train alone and won alone.` : `The end: ${enS.gang[d.winner]} won.${d.by != null ? ` ${name(d.by)} opened their bags at stop ${d.stops}.` : ""}`,
    and: "; ",
  },
};
const ZH_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function zhNum(n) { return n <= 10 ? ZH_NUM[n] : n < 20 ? "十" + ZH_NUM[n - 10] : ZH_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? ZH_NUM[n % 10] : ""); }

const nameIn = (d, L) => (s) => { const c = s == null ? null : d.cast[s]; return c ? c.names[L === W.zh ? "zh" : "en"] : "?"; };
function lineText(l, d, L) {
  const nm = nameIn(d, L);
  const item = (k) => L.S.items[k] || k;
  const trade = (tr) => L.S.trades[tr] || tr;
  const gang = (g) => L.S.gang[g] || g;
  const out = [];
  const used = new Set();
  const mv = l.moves || [];
  const take = (pred) => mv.filter((m, i) => !used.has(i) && pred(m) && used.add(i));
  switch (l.type) {
    case "pass": out.push(L.pass(nm(l.seat))); break;
    case "fortune": out.push(L.fortune(nm(l.seat))); break;
    case "demand": out.push(L.demand(nm(l.seat), nm(l.target), item(l.kind), l.had)); take((m) => m.kind === l.kind && m.from === l.target && m.to === l.seat); break;
    case "trade": {
      if (!l.accepted) { out.push(L.tradeNo(nm(l.from), nm(l.to))); break; }
      const give = take((m) => m.from === l.from && m.to === l.to)[0];
      const back = take((m) => m.from === l.to && m.to === l.from)[0];
      if (give && back) out.push(L.trade(nm(l.from), nm(l.to), item(give.kind), item(back.kind), l.forced));
      else if (give) out.push(L.tradeOne(nm(l.from), nm(l.to), item(give.kind), l.forced));
      const lied = lie(l);
      if (lied) out.push(L.lie(nm(lied.seat), item(lied.said), item(lied.gave)));
      break;
    }
    case "codebook": out.push(L.codebook(nm(l.seat), nm(l.partner), l.swapped)); break;
    case "coat": out.push(L.coat(nm(l.seat), l.changed)); break;
    case "timetable": out.push(L.timetable(nm(l.seat), l.dir)); break;
    case "gift": { const g = take((m) => m.from === l.from && m.to === l.to)[0]; out.push(L.gift(nm(l.from), nm(l.to)) + (g ? " " + L.moved(item(g.kind), nm(l.from), nm(l.to)) : "")); break; }
    case "scuffle": {
      if (l.stopped != null) { out.push(L.stopped(nm(l.attacker), nm(l.defender), nm(l.stopped), l.paid)); break; }
      out.push(L.scuffle(nm(l.attacker), nm(l.defender)));
      const bits = [];
      const sup = Object.entries(l.support || {});
      const forA = sup.filter(([, v]) => v === "attacker").map(([s]) => nm(+s));
      const forD = sup.filter(([, v]) => v === "defender").map(([s]) => nm(+s));
      if (forA.length) bits.push(L.sides(forA.join(L.sep), nm(l.attacker)));
      if (forD.length) bits.push(L.sides(forD.join(L.sep), nm(l.defender)));
      if (l.gunman != null) bits.push(L.gunman(nm(l.gunman)));
      if (l.hypnotized != null) bits.push(L.hypno(nm(l.attacker), nm(l.hypnotized)));
      for (const [s, x] of Object.entries(l.shown || {})) {
        const what = [...(x.items || []).map(item), ...(x.trade ? [trade(x.trade)] : [])];
        if (what.length) bits.push(L.shown(nm(+s), what.join(L.sep)));
      }
      if (l.dice && l.dice.roll != null) bits.push(L.coin(nm(l.dice.seat), l.dice.roll));
      if (bits.length) out.push(bits.join(L.and) + (L === W.zh ? "。" : "."));
      if (l.tie || l.winner == null) { out.push(L.tie(l.swords, l.shields)); break; }
      out.push(L.won(nm(l.winner), l.swords, l.shields));
      const loser = l.winner === l.attacker ? l.defender : l.attacker;
      for (const m of take((m) => m.from === loser && m.to === l.winner)) out.push(L.took(nm(l.winner), nm(loser), item(m.kind)));
      for (const m of take((m) => m.from === l.winner && m.to === loser)) out.push(L.gaveBack(nm(l.winner), nm(loser), item(m.kind)));
      break;
    }
    case "event":
      if (l.id === "password" && l.done) out.push(l.tie ? L.passwordTie() : L.password(nm(l.seat), Object.values(l.votes || {}).filter((v) => v === l.seat).length, item(l.kind)));
      break;
    case "passes": out.push(L.passes()); break;
    case "declare": out.push(L.declare(nm(l.seat), gang(l.gang), l.correct)); break;
    case "solo": out.push(L.solo(nm(l.seat))); break;
  }
  // the pass-around moves every bag at once: only the watches and seals are worth telling
  for (const m of mv.filter((x, i) => !used.has(i) && (l.type !== "passes" || GOALS.has(x.kind)))) {
    if (m.from == null) out.push(L.fromVan(nm(m.to), item(m.kind)));
    else if (m.to == null) out.push(L.toVan(nm(m.from), item(m.kind)));
    else out.push(L.moved(item(m.kind), nm(m.from), nm(m.to)));
  }
  for (const k of l.learned || []) {
    if (k.k === "gang") out.push(L.sawGang(nm(k.who), nm(k.of), gang(k.v)));
    if (k.k === "trade") out.push(L.sawTrade(nm(k.who), nm(k.of), trade(k.v)));
    if (k.k === "hand") out.push(L.sawHand(nm(k.who), nm(k.of), k.v.map(item).join(L.sep)));
  }
  return out.join(L === W.zh ? "" : " ");
}
function eventText(ev, L) {
  if (!ev || !ev.id) return L.event.quiet();
  const item = (k) => L.S.items[k] || k;
  if (ev.id === "dining") return L.event.dining((ev.kinds || []).map(item).join(L.sep));
  if (ev.id === "speaker") return L.event.speaker(ev.watches, ev.seals);
  return (L.event[ev.id] || L.event.quiet)();
}

export function digestText(d, lang) {
  const L = lang === "zh" ? W.zh : W.en;
  const nm = nameIn(d, L);
  const out = [L.cast];
  for (const c of d.cast) out.push("- " + L.castLine({ name: nm(c.seat) }, L.S.gang[c.gang], L.S.trades[c.trade] || c.trade));
  out.push("");
  for (const t of d.turns) {
    out.push(`## ${L.stop(t.stop)}${d.options.events ? " · " + eventText(t.event, L) : ""}`);
    const texts = t.lines.map((l) => lineText(l, d, L)).map((s) => s.trim());
    if (!texts.some(Boolean)) out.push(L.none);
    else {
      out.push(L.keyHead);
      t.key.filter((i) => texts[i]).forEach((i, k) => out.push(`${k + 1}. ${texts[i]}`));
      out.push(L.allHead);
      texts.forEach((s, i) => { if (s && t.lines[i].type !== "pass") out.push("- " + s); });
    }
    out.push(L.endHead);
    // only the tokens: who carried the rest is the record's, not the story's
    const goalsAt = ["watch", "seal"].map((k) => {
      const who = t.held.map((ks, seat) => [seat, ks.filter((x) => x === k).length]).filter(([, c]) => c).map(([seat, c]) => nm(seat) + (c > 1 ? (lang === "zh" ? `（${c}）` : ` (${c})`) : ""));
      return who.length ? L.holds(L.S.items[k], who.join(L.sep)) : null;
    }).filter(Boolean);
    out.push((goalsAt.length ? goalsAt.join(L.and) : L.noGoal) + (lang === "zh" ? "。" : "."));
    out.push(L.goals(t.goals[E.TIMEKEEPERS], t.goals[E.SEALBEARERS]));
    out.push("");
  }
  out.push(L.result(d, nm));
  return out.join("\n");
}

// The heaviest line of each of the first stops: something to read while waiting.
export function moments(d, lang, max = 3) {
  const L = lang === "zh" ? W.zh : W.en;
  const out = [];
  for (const t of d.turns) {
    if (out.length >= max) break;
    // never the ending: that is the story's to tell
    const i = t.key.find((k) => t.lines[k].type !== "declare" && t.lines[k].type !== "solo");
    if (i != null) out.push({ stop: t.stop, text: lineText(t.lines[i], d, L).split(lang === "zh" ? /(?<=。)/ : /(?<=\.)\s/).slice(0, 3).join(lang === "zh" ? "" : " ") });
  }
  return out;
}
