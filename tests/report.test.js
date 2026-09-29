// The 戰報: a full record replays into the same digest wherever it comes from,
// a record that lies is refused, the story is checked for the game's words and
// its shape, and the store writes one story per game within the day's cap. The
// model is a fake here; the secret never leaves the model call.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/shared/engine.js";
import * as B from "../public/shared/bots.js";
import { buildRecord, cleanAction, finalTable, resultOf } from "../public/shared/record.js";
import { buildDigest, digestText, reportKey, moments } from "../public/shared/report-digest.js";
import { validateReport, validateLanguage, bannedIn } from "../src/report-check.js";
import { ReportCore, handleReportRequest, CAP_NAME } from "../src/report-core.js";

const DLC = Object.fromEntries(E.EXPANSIONS.map((k) => [k, true]));
const FACES = ["lin", "ivan", "hana", "chen", "natasha", "buck", "zhou", "bai", "smith", "rosa"];
const ZH = ["林小姐", "伊凡", "花子", "陳老闆", "娜塔莎", "巴克", "周太太", "白老師", "史密斯", "羅莎"];

function play(seed, n, options) {
  const rng = E.makeRng(seed * 13 + 5);
  let st = E.createGame(seed, n, options);
  const actions = [];
  while (st.phase !== "over") {
    const who = E.mustAct(st);
    const seat = who[rng.int(who.length)];
    const a = B.decide(E.view(st, seat), E.legalActions(st, seat), "normal", rng);
    actions.push(cleanAction(st.turnNo, a));
    st = E.apply(st, a);
  }
  const rec = buildRecord({ exportedAt: "2026-09-28T00:00:00Z", build: "test", mode: "solo", scope: "full", lang: "zh-Hant", seed, n, options, actions,
    passengers: Array.from({ length: n }, (_, seat) => ({ seat, name: ZH[seat], face: FACES[seat] })), result: resultOf(st), final: finalTable(st), log: st.log });
  return { st, rec: JSON.parse(JSON.stringify(rec)) };
}

// A story that passes: one chapter per stop, couplet headings, no game words.
function goodSide(d, lang) {
  const zh = lang === "zh";
  return {
    title: zh ? "末班夜車演義" : "The Tale of the Last Night Train",
    intro: zh ? "話說這一夜的末班車。" : "It was the last train of the night.",
    chapters: d.turns.map((t) => ({ stop: t.stop, heading: zh ? "夜車出站人未識　燈影搖晃各藏心" : "The train pulls out; nobody knows anyone",
      items: t.items.slice(0, 1), caption: zh ? "車廂裡暗潮洶湧。" : "The carriage held its breath.", paragraphs: [zh ? "車過一站，無人說話。" : "Nobody spoke."] })),
    ending: zh ? "終點到了。" : "The end of the line.",
    poem: zh ? "夜車不問來時路\n箱底各藏玉與錶\n燈滅燈明人相認\n一聲汽笛見分曉" : "One\nTwo\nThree\nFour",
    clues: d.cast.map((c) => ({ seat: c.seat, stop: 1, text: zh ? "第一站就露了底。" : "The first stop gave them away." })),
  };
}

test("report: the same game gives the same key and digest, whoever sends it, and a record that lies is refused", async () => {
  for (const [seed, n, options] of [[11, 3, {}], [20260972, 6, { events: true }], [77, 10, { dlc: DLC, events: true, smuggling: true }]]) {
    const { st, rec } = play(seed, n, options);
    const d = buildDigest(rec);
    assert.equal(d.stops, Math.max(1, Math.ceil(st.turnNo / n)));
    assert.equal(d.turns.length, d.stops);
    assert.equal(d.winner, st.winner);
    // another seat's copy: other names, other language, another export time -- one key, one digest
    const other = { ...rec, lang: "en", exportedAt: "2027-01-01T00:00:00Z", passengers: rec.passengers.map((p) => ({ ...p, name: p.name + "x" })) };
    assert.equal(await reportKey(other), await reportKey(rec));
    const d2 = buildDigest(other);
    assert.deepEqual(d2.turns, d.turns);
    for (const lang of ["zh", "en"]) {
      const text = digestText(d, lang);
      assert.ok(text.length > 200);
      assert.ok(moments(d, lang).length >= 1);
    }
    // the table at the end matches the engine's
    assert.deepEqual(d.turns[d.stops - 1].held, st.seats.map((sd) => sd.items.map((id) => st.items[id]).sort()));
  }
  const { rec } = play(5, 5, {});
  assert.throws(() => buildDigest({ ...rec, result: { ...rec.result, winner: rec.result.winner === "timekeepers" ? "sealbearers" : "timekeepers" } }), /result/);
  assert.throws(() => buildDigest({ ...rec, actions: rec.actions.slice(0, -1) }), /not over/);
  assert.throws(() => buildDigest({ ...rec, scope: "seat" }), /full record/);
  assert.throws(() => buildDigest({ ...rec, seed: "x" }), /seed/);
});

test("report: a passenger under their face's own name is called by it in each language; names cannot carry markup", () => {
  const { rec } = play(20260972, 6, { events: true });
  rec.passengers[5].name = "<b>Evil</b>{}";
  const d = buildDigest(rec);
  assert.deepEqual(d.cast[0].names, { zh: "林小姐", en: "Miss Lin" });
  assert.equal(d.cast[5].names.en, "bEvilb");
  assert.ok(digestText(d, "en").includes("Miss Lin"));
  // the moments shown while waiting say who saw through whom, never what they saw
  for (const lang of ["zh", "en"]) for (const m of moments(d, lang)) assert.ok(!/鐘樓會|印信社|Clocktower|Seal Society/.test(m.text), m.text);
});

test("report: the check refuses game words, a wrong number of chapters, a bad couplet and items from another stop", () => {
  const { rec } = play(20260972, 6, { events: true });
  const d = buildDigest(rec);
  assert.deepEqual(validateReport({ zh: goodSide(d, "zh"), en: goodSide(d, "en") }, d), []);
  assert.deepEqual(bannedIn("她當眾攤牌，第三回合", "zh"), ["牌", "回合", "第三回"]);
  assert.deepEqual(bannedIn("The player drew a card", "en"), ["card", "player"]);
  const bad = goodSide(d, "zh");
  bad.chapters[0].paragraphs = ["林小姐攤牌了。"];
  bad.chapters[1].heading = "沒有對仗";
  bad.chapters[2].items = ["gold_bar", "watch", "seal"];
  const p = validateLanguage(bad, d, "zh");
  assert.ok(p.some((x) => x.includes("牌")));
  assert.ok(p.some((x) => x.includes("chapter 2") && x.includes("heading")));
  assert.ok(p.some((x) => x.includes("at most 2")));
  // style E: nobody's society before the last chapter, and one clue per passenger
  const leak = goodSide(d, "zh");
  leak.chapters[0].paragraphs = ["巴克原來是印信社的人。"];
  leak.chapters[d.stops - 1].paragraphs = ["林小姐是鐘樓會的人。"];
  const lp = validateLanguage(leak, d, "zh");
  assert.ok(lp.some((x) => x.includes("chapter 1") && x.includes("society")));
  assert.ok(!lp.some((x) => x.includes(`chapter ${d.stops} paragraph`)), "the last chapter reveals");
  const noClue = goodSide(d, "en");
  noClue.clues = noClue.clues.slice(1);
  noClue.clues.push({ seat: 1, stop: 99, text: "x" });
  const cp = validateLanguage(noClue, d, "en");
  assert.ok(cp.some((x) => x.includes("no clue for seat 0")));
  assert.ok(cp.some((x) => x.includes("two clues")));
  assert.ok(cp.some((x) => x.includes('"stop" must be')));
  const short = goodSide(d, "en");
  short.chapters.pop();
  assert.ok(validateLanguage(short, d, "en").some((x) => x.includes("one chapter per stop")));
});

// ---------- the store ----------
function fakeWorld(capLimit) {
  const objects = new Map();
  const env = { DEEPSEEK_API_KEY: "SECRET", REPORT_DAILY_CAP: capLimit == null ? undefined : String(capLimit) };
  const prompts = { zh: "寫。", en: "Write." };
  env.REPORTS = {
    idFromName: (name) => name,
    get: (name) => {
      if (!objects.has(name)) {
        const data = new Map();
        const ctx = {
          storage: {
            async get(k) { return data.get(k); },
            async put(k, v) { if (typeof k === "object") for (const [kk, vv] of Object.entries(k)) data.set(kk, structuredClone(vv)); else data.set(k, structuredClone(v)); },
            async setAlarm(t) { ctx.alarmAt = t; },
          },
          blockConcurrencyWhile: (fn) => fn(),
        };
        objects.set(name, { obj: new ReportCore(ctx, env, prompts), ctx });
      }
      const o = objects.get(name);
      return { fetch: (url, init) => o.obj.fetch(new Request(url, init)) };
    },
  };
  return { env, objects };
}

test("report: the store writes one story per game, keeps the key to the model call, and stops at the day's cap", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  let replies = null; // lang -> content
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const lang = body.messages[0].content === "寫。" ? "zh" : "en";
    calls.push({ url, auth: init.headers.authorization, lang, model: body.model });
    return new Response(JSON.stringify({ choices: [{ message: { content: replies[lang]() }, finish_reason: "stop" }] }), { status: 200 });
  };
  try {
    const { env, objects } = fakeWorld(2);
    const post = (rec) => handleReportRequest(new Request("https://x/last_train/api/report", { method: "POST", body: JSON.stringify(rec) }), env, "/api/report");
    const get = (key) => handleReportRequest(new Request("https://x/last_train/api/report/" + key), env, "/api/report/" + key);
    const { rec } = play(20260972, 6, { events: true });
    const d = buildDigest(rec);
    let bad = 1; // the first zh reply has a game word, the retry is clean
    replies = { zh: () => JSON.stringify(bad-- > 0 ? { ...goodSide(d, "zh"), intro: "她攤牌了。" } : goodSide(d, "zh")), en: () => JSON.stringify(goodSide(d, "en")) };

    let r = await post(rec);
    assert.equal(r.status, 200);
    const { key, state } = await r.json();
    assert.equal(state, "pending");
    assert.equal(key, await reportKey(rec));
    // a second press while it is being written starts nothing
    assert.equal((await (await post(rec)).json()).state, "pending");
    await objects.get(key).obj.alarm();
    const g = await (await get(key)).json();
    assert.equal(g.state, "done");
    assert.equal(g.report.zh.chapters.length, d.stops);
    assert.equal(g.view.cast[0].names.en, "Miss Lin");
    assert.equal(g.game.seed, rec.seed);
    assert.equal(calls.filter((c) => c.lang === "zh").length, 2, "one retry with the problems listed");
    for (const c of calls) { assert.equal(c.auth, "Bearer SECRET"); assert.ok(c.url.startsWith("https://api.deepseek.com/")); }
    assert.ok(!JSON.stringify(g).includes("SECRET"));
    // done stays done, without another call
    const before = calls.length;
    assert.equal((await (await post(rec)).json()).state, "done");
    assert.equal(calls.length, before);

    // a second game takes the cap's last one; a third is refused
    assert.equal((await post(play(12, 4, {}).rec)).status, 200);
    assert.equal((await post(play(13, 4, {}).rec)).status, 429);
    assert.equal(objects.get(CAP_NAME) != null, true);
    // nonsense is refused before it costs anything
    assert.equal((await post({ hello: 1 })).status, 400);
    assert.equal((await get("nope")).status, 404);
  } finally { globalThis.fetch = realFetch; }
});

test("report: a model that keeps failing fails the story, and three tries are the most", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 });
  try {
    const { env, objects } = fakeWorld(10);
    const post = (rec) => handleReportRequest(new Request("https://x/api/report", { method: "POST", body: JSON.stringify(rec) }), env, "/api/report");
    const { rec } = play(8, 3, {});
    const { key } = await (await post(rec)).json();
    for (let i = 0; i < 3; i++) {
      await objects.get(key).obj.alarm();
      const r = await (await post(rec)).json();
      if (i < 2) assert.equal(r.state, "pending"); else assert.deepEqual(r, { key, state: "failed", final: true });
    }
  } finally { globalThis.fetch = realFetch; }
});

test("report: a clue may not put a passenger in the wrong society or give them a trade nobody had", () => {
  const { rec } = play(20260972, 6, { events: true });
  const d = buildDigest(rec);
  const side = goodSide(d, "en");
  const other = d.cast[0].gang === "timekeepers" ? "the Seal Society" : "the Clocktower Society";
  const nobody = Object.keys(E.TRADE_BY_ID).find((tr) => !d.cast.some((c) => c.trade === tr));
  side.clues[0].text = `At the first stop she showed she was of ${other}.`;
  side.clues[1].text = `At the first stop he was plainly a ${({ doctor: "Doctor", priest: "Priest", gunman: "Gunman", master: "Master", bodyguard: "Bodyguard", diplomat: "Diplomat", fortune_teller: "Fortune Teller", hypnotist: "Hypnotist", thug: "Thug", pharmacist: "Pharmacist" })[nobody] || nobody}.`;
  const p = validateLanguage(side, d, "en");
  assert.ok(p.some((x) => x.includes("clue 1") && x.includes("other society")), p.join("\n"));
  assert.ok(p.some((x) => x.includes("clue 2") && x.includes("nobody at the table")), p.join("\n"));
});
