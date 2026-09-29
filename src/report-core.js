// The 戰報 store and the model call (the way zongheng does it). Everything but
// the prompt files, so Node can load it: src/report.js adds the prompts, which
// are Wrangler Text modules Node cannot import.
//
// POST /last_train/api/report   body: a full record (record.js, at most 512 KB, else 413)
//   invalid (not JSON, not a full record, does not replay to a finished game,
//   result not the replay's)                              -> 400 {error: "invalid"}
//   else -> 200 {key, state: "pending" | "done" | "failed", final?}
//     unknown key: take one from the daily cap (429 {error: "daily-cap"} when none
//       is left), store the record and its digest, and start writing on the
//       object's alarm, so it survives the page going away;
//     pending: pending (no second call); done: done;
//     failed: start again while attempts < 3 (each start takes from the cap),
//       else {state: "failed", final: true}.
// GET /last_train/api/report/<key> -> {key, state, report?, view, game}: `view` is
//   what the page draws (the cast, each stop's table, the moments to read while
//   waiting), `game` the record itself (for the download). Unknown key -> 404.
//
// One Durable Object per game, named by its key: the object serialises
// everything for its game, which is what keeps it to one story per game when
// several passengers press at once. The daily cap is one more object of the
// same class, named CAP_NAME.
//
// The API key (env.DEEPSEEK_API_KEY) goes only into the Authorization header of
// the model call. It is never sent to a page and never logged.
import { buildDigest, digestText, reportKey, moments } from "../public/shared/report-digest.js";
import { validateLanguage, validateReport, LANGS } from "./report-check.js";
import zhS from "../public/i18n/zh-Hant.js";
import enS from "../public/i18n/en.js";

export const MAX_BODY = 512 * 1024;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_DAILY_CAP = 100;
export const CAP_NAME = "__cap__";
export const MODEL = "deepseek-v4-pro";
export const FALLBACK_MODEL = "deepseek-flash";
export const CALL_MS = 200_000;       // one model call; three in a row stay under the alarm's 15 minutes
export const STALE_MS = 20 * 60_000;  // still "pending" after this: the writing was lost
export const REPORT_VERSION = 2; // 2: style E, the challenge to the reader (clues per passenger)
const KEY_RE = /^[0-9a-f]{64}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// ---------- the Worker side (src/index.js routes here) ----------
export async function handleReportRequest(request, env, sub) {
  if (sub === "/api/report") {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const len = Number(request.headers.get("content-length"));
    if (len > MAX_BODY) return json({ error: "too-large" }, 413);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY) return json({ error: "too-large" }, 413);
    const text = new TextDecoder().decode(buf);
    let key;
    try { key = await reportKey(JSON.parse(text)); } catch { return json({ error: "invalid" }, 400); }
    const stub = env.REPORTS.get(env.REPORTS.idFromName(key));
    return stub.fetch("https://report/post", { method: "POST", headers: { "x-report-key": key }, body: text });
  }
  const m = sub.match(/^\/api\/report\/([^/]+)$/);
  if (m) {
    if (request.method !== "GET") return json({ error: "method" }, 405);
    if (!KEY_RE.test(m[1])) return json({ error: "not-found" }, 404);
    return env.REPORTS.get(env.REPORTS.idFromName(m[1])).fetch("https://report/get");
  }
  return json({ error: "not-found" }, 404);
}

// ---------- what the page draws ----------
export function viewOf(d) {
  return {
    stops: d.stops, n: d.n, winner: d.winner, reason: d.reason, by: d.by, correct: d.correct,
    cast: d.cast.map(({ seat, names, face, gang, trade }) => ({ seat, names, face, gang, trade })),
    turns: d.turns.map(({ stop, hot, held, goals, event }) => ({ stop, hot, held, goals, event: event && event.id })),
    moments: { zh: moments(d, "zh"), en: moments(d, "en") },
  };
}

// ---------- what the model is sent ----------
export function userMessage(digest, lang) {
  const zh = lang === "zh";
  const S = zh ? zhS : enS;
  const lines = [`LANG: ${lang}`, `STOPS: ${digest.turns.length}`, ""];
  lines.push(zh ? "可以配圖的物件（items 欄位用等號左邊的 id）：" : 'Things you may picture (use the id before "=" in the "items" field):');
  for (const t of digest.turns) lines.push(`${zh ? "第" + t.stop + "站" : "stop " + t.stop}: ${t.items.map((k) => `${k}=${S.items[k] || k}`).join(", ") || (zh ? "（無）" : "(none)")}`);
  lines.push("", zh ? "行車紀要：" : "The record of the journey:", "", digestText(digest, lang), "");
  lines.push(zh ? `請依系統說明，輸出一個 JSON 物件，共 ${digest.turns.length} 回。` : `Following the instructions, output one JSON object with ${digest.turns.length} chapters.`);
  return lines.join("\n");
}

// The reply's content as one language's report, or throws.
export function parseReply(content, lang) {
  if (typeof content !== "string" || !content.trim()) throw new Error("the reply was empty");
  let s = content.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1];
  let obj;
  try { obj = JSON.parse(s); } catch { throw new Error("the reply was not valid JSON"); }
  if (obj && typeof obj === "object" && obj[lang] && typeof obj[lang] === "object" && !obj.chapters) obj = obj[lang];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("the reply was not a JSON object");
  return obj;
}

// ---------- the Durable Object ----------
export class ReportCore {
  constructor(ctx, env, prompts) {
    this.ctx = ctx;
    this.env = env;
    this.prompts = prompts || {};
  }
  get storage() { return this.ctx.storage; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/cap/take") return json({ ok: await this.capTake() });
    if (url.pathname === "/post") return this.post(request);
    if (url.pathname === "/get") return this.get();
    return json({ error: "not-found" }, 404);
  }

  // ----- the daily cap (only on the CAP_NAME object) -----
  capLimit() {
    const n = Number(this.env.REPORT_DAILY_CAP);
    return this.env.REPORT_DAILY_CAP == null || this.env.REPORT_DAILY_CAP === "" || !Number.isFinite(n) || n < 0 ? DEFAULT_DAILY_CAP : Math.floor(n);
  }
  async capTake() {
    const day = new Date().toISOString().slice(0, 10); // UTC
    const c = (await this.storage.get("cap")) || { day, n: 0 };
    if (c.day !== day) { c.day = day; c.n = 0; }
    if (c.n >= this.capLimit()) return false;
    c.n++;
    await this.storage.put("cap", c);
    return true;
  }
  async takeFromCap() {
    const stub = this.env.REPORTS.get(this.env.REPORTS.idFromName(CAP_NAME));
    const res = await stub.fetch("https://report/cap/take", { method: "POST" });
    return !!(await res.json()).ok;
  }

  // ----- a game's object -----
  async post(request) {
    const key = request.headers.get("x-report-key");
    let rec, digest;
    try {
      rec = JSON.parse(await request.text());
      digest = buildDigest(rec);
      if ((await reportKey(rec)) !== key) throw new Error("key");
    } catch { return json({ error: "invalid" }, 400); }
    return this.ctx.blockConcurrencyWhile(async () => {
      let meta = await this.storage.get("meta");
      if (meta && meta.state === "pending" && Date.now() - meta.startedAt > STALE_MS) {
        meta.state = "failed";
        meta.errors = [...(meta.errors || []), "the writing was lost (no answer after 20 minutes)"].slice(-20);
        await this.storage.put("meta", meta);
      }
      if (!meta) {
        if (!(await this.takeFromCap())) return json({ error: "daily-cap" }, 429);
        meta = { key, state: "pending", attempts: 0, createdAt: Date.now(), startedAt: Date.now(), errors: [], partial: {} };
        await this.storage.put({ meta, record: rec, digest, view: viewOf(digest) });
        await this.storage.setAlarm(Date.now());
        return json({ key, state: "pending" });
      }
      if (meta.state === "done") return json({ key, state: "done" });
      if (meta.state === "pending") return json({ key, state: "pending" });
      if (meta.attempts >= MAX_ATTEMPTS) return json({ key, state: "failed", final: true });
      if (!(await this.takeFromCap())) return json({ error: "daily-cap" }, 429);
      meta.state = "pending";
      meta.startedAt = Date.now();
      await this.storage.put("meta", meta);
      await this.storage.setAlarm(Date.now());
      return json({ key, state: "pending" });
    });
  }

  async get() {
    const meta = await this.storage.get("meta");
    if (!meta) return json({ error: "not-found" }, 404);
    const out = { key: meta.key, state: meta.state };
    if (meta.state === "done") out.report = await this.storage.get("report");
    if (meta.state === "failed" && meta.attempts >= MAX_ATTEMPTS) out.final = true;
    out.view = await this.storage.get("view");
    out.game = await this.storage.get("record");
    return json(out);
  }

  // The writing. The attempt is counted before any call, so one that dies half
  // way (an eviction, a deploy) still counts.
  async alarm() {
    const meta = await this.storage.get("meta");
    if (!meta || meta.state !== "pending") return;
    meta.attempts++;
    meta.startedAt = Date.now();
    await this.storage.put("meta", meta);
    const digest = await this.storage.get("digest");
    const todo = LANGS.filter((l) => !(meta.partial && meta.partial[l]));
    const results = await Promise.all(todo.map((lang) => this.generateLanguage(digest, lang).catch((e) => ({ ok: false, problems: [String((e && e.message) || e)], calls: [] }))));
    meta.partial = meta.partial || {};
    todo.forEach((lang, i) => {
      const r = results[i];
      meta.calls = [...(meta.calls || []), ...r.calls.map((c) => ({ lang, attempt: meta.attempts, ...c }))].slice(-60);
      if (r.ok) meta.partial[lang] = { ...r.side, model: r.model };
      else meta.errors = [...(meta.errors || []), ...r.problems.slice(0, 5).map((p) => `attempt ${meta.attempts} ${lang}: ${p}`)].slice(-20);
    });
    if (LANGS.every((l) => meta.partial[l])) {
      const report = { version: REPORT_VERSION, createdAt: new Date().toISOString(), model: [...new Set(LANGS.map((l) => meta.partial[l].model))].join(" + ") };
      for (const l of LANGS) report[l] = meta.partial[l];
      const problems = validateReport(report, digest);
      if (!problems.length) {
        meta.state = "done";
        meta.partial = {};
        await this.storage.put({ report, meta });
        return;
      }
      meta.errors = [...meta.errors, ...problems.slice(0, 5)].slice(-20);
      meta.partial = {};
    }
    meta.state = "failed";
    await this.storage.put("meta", meta);
  }

  // One language: the main model; on problems one retry with them listed; then
  // one try on the fallback model; then failed.
  async generateLanguage(digest, lang) {
    const system = this.prompts[lang];
    if (!system) throw new Error(`no prompt for ${lang}`);
    const base = [{ role: "system", content: system }, { role: "user", content: userMessage(digest, lang) }];
    const calls = [];
    const tryOnce = async (model, messages) => {
      const t0 = Date.now();
      let content = null, answered = false, problems;
      try {
        const r = await this.callModel(model, messages);
        answered = true;
        content = r.content;
        calls.push({ model, ms: Date.now() - t0, finish: r.finish, usage: r.usage });
        const side = parseReply(content, lang);
        problems = validateLanguage(side, digest, lang);
        if (!problems.length) return { ok: true, side, model };
      } catch (e) {
        const why = String((e && e.message) || e).slice(0, 200);
        if (!answered) calls.push({ model, ms: Date.now() - t0, error: why });
        problems = [why];
      }
      return { ok: false, problems, content };
    };
    let r = await tryOnce(MODEL, base);
    if (r.ok) return { ...r, calls };
    const fix = lang === "zh"
      ? `你的輸出有以下問題，請全部改正，並重新輸出完整的 JSON 物件：\n- ${r.problems.join("\n- ")}`
      : `Your output has these problems. Fix all of them and output the whole JSON object again:\n- ${r.problems.join("\n- ")}`;
    const retry = r.content ? [...base, { role: "assistant", content: r.content }, { role: "user", content: fix }] : [...base, { role: "user", content: fix }];
    r = await tryOnce(MODEL, retry);
    if (r.ok) return { ...r, calls };
    r = await tryOnce(FALLBACK_MODEL, base);
    if (r.ok) return { ...r, calls };
    return { ok: false, problems: r.problems, calls };
  }

  async callModel(model, messages) {
    const base = String(this.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model, messages,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 1.0,
        max_tokens: 8000,
        stream: false,
      }),
      signal: AbortSignal.timeout(CALL_MS),
    });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) {
      const why = body && body.error && typeof body.error.message === "string" ? `: ${body.error.message.slice(0, 160)}` : "";
      throw new Error(`${model} answered HTTP ${res.status}${why}`);
    }
    const choice = body && body.choices && body.choices[0];
    return { content: choice && choice.message ? choice.message.content : null, finish: choice ? choice.finish_reason : null, usage: body ? body.usage : null };
  }
}
