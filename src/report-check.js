// The check every 戰報 passes before it is stored, and the list of problems that
// goes back to the model when it does not.
//
//   validateReport(report, digest) -> [] or ["problem", ...]
//
// The report is { zh, en } (other top-level keys are ignored), each language
//   { title, intro, chapters: [{ stop, heading, paragraphs: [..], items?: [kinds], caption? }], ending, poem? }
// with one chapter per stop of the digest, in order. A chapter pictures at most
// two items, each one the digest lists for that stop. And the story is told as
// things that happened on a train, not as a game: the game's own words are
// refused in every string of the language.
export const LANGS = ["zh", "en"];
export const MAX_ITEMS = 2;

// zh: any word with 牌 in it (幫會牌, 攤牌, 牌堆…), and the game's other words; plus
// the simplified forms (a zh-Hant story has no business with them either).
const ZH_WORDS = [
  "牌", "回合", "骰", "打出", "抽了一張", "得分", "分數", "計分", "玩家", "機器人", "電腦", "遊戲", "擴充",
  "计分", "分数", "玩家", "机器人", "电脑", "游戏",
];
const ZH_RE = [/\bAI\b/i, /第[一二三四五六七八九十\d]+回/];
const NUM = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const EN_RE = [
  /\bcards?\b/i, /\bdecks?\b/i, /\bdice\b/i, /\bdie\s+rolls?\b/i, /\bplayers?\b/i, /\bbots?\b/i, /\bAI\b/, /\bgame\b/i,
  /\bscor(?:e|ed|es|ing)\b/i, /\bpoints?\b/i, /\bdiscard(?:s|ed|ing)?\b/i, /\bexpansion\b/i,
  new RegExp(`\\bturn\\s+${NUM}\\b`, "i"), new RegExp(`\\bround\\s+${NUM}\\b`, "i"), new RegExp(`\\bchapter\\s+${NUM}\\b`, "i"),
];

export function bannedIn(text, lang) {
  if (typeof text !== "string") return [];
  const hits = [];
  if (lang === "zh") {
    for (const w of ZH_WORDS) if (text.includes(w)) hits.push(w);
    for (const re of ZH_RE) { const m = text.match(re); if (m) hits.push(m[0]); }
  } else {
    for (const re of EN_RE) { const m = text.match(re); if (m) hits.push(m[0]); }
  }
  return [...new Set(hits)];
}

const isStr = (x) => typeof x === "string" && x.trim().length > 0;

// A heading is a couplet: two halves, a full-width space between them in
// Chinese, a semicolon in English.
function coupletProblem(h, lang) {
  const halves = lang === "zh" ? h.trim().split(/　+/) : h.trim().split(/\s*;\s*/);
  if (halves.length !== 2 || !halves.every((x) => x.trim())) return lang === "zh" ? "must be two halves with one full-width space (　) between them" : "must be two halves with a semicolon between them";
  if (lang === "zh" && !halves.every((x) => x.length >= 5 && x.length <= 10)) return "each half must be 5 to 10 characters";
  return null;
}

export function validateLanguage(side, digest, lang) {
  const p = [];
  const at = (where, text) => {
    const hits = bannedIn(text, lang);
    if (hits.length) p.push(`${lang} ${where}: game words ${hits.map((h) => JSON.stringify(h)).join(", ")} -- tell it as what happened on the train`);
  };
  if (!side || typeof side !== "object" || Array.isArray(side)) return [`${lang}: missing`];
  for (const k of ["title", "intro", "ending"]) {
    if (!isStr(side[k])) p.push(`${lang}.${k}: a non-empty string is required`);
    else at(k, side[k]);
  }
  if (side.poem != null) { if (typeof side.poem !== "string") p.push(`${lang}.poem: must be a string`); else at("poem", side.poem); }
  const stops = digest.turns.length;
  if (!Array.isArray(side.chapters)) { p.push(`${lang}.chapters: an array is required`); return p; }
  if (side.chapters.length !== stops) p.push(`${lang}.chapters: ${side.chapters.length} chapters, but the train made ${stops} stops (one chapter per stop)`);
  side.chapters.forEach((c, i) => {
    const w = `${lang} chapter ${i + 1}`;
    if (!c || typeof c !== "object") { p.push(`${w}: not an object`); return; }
    if (c.stop !== i + 1) p.push(`${w}: "stop" must be ${i + 1}`);
    if (!isStr(c.heading)) p.push(`${w}: "heading" must be a non-empty string`);
    else { at(`chapter ${i + 1} heading`, c.heading); const why = coupletProblem(c.heading, lang); if (why) p.push(`${w}: "heading" ${why}`); }
    if (!Array.isArray(c.paragraphs) || !c.paragraphs.length || !c.paragraphs.every(isStr)) p.push(`${w}: "paragraphs" must be a non-empty array of non-empty strings`);
    else c.paragraphs.forEach((t, j) => at(`chapter ${i + 1} paragraph ${j + 1}`, t));
    if (c.caption != null) { if (typeof c.caption !== "string") p.push(`${w}: "caption" must be a string`); else at(`chapter ${i + 1} caption`, c.caption); }
    if (c.items != null) {
      const allowed = digest.turns[i] ? digest.turns[i].items : [];
      if (!Array.isArray(c.items)) p.push(`${w}: "items" must be an array of ids`);
      else {
        if (c.items.length > MAX_ITEMS) p.push(`${w}: at most ${MAX_ITEMS} items, not ${c.items.length}`);
        for (const id of c.items) if (!allowed.includes(id)) p.push(`${w}: item ${JSON.stringify(id)} is not one of that stop's (${allowed.join(", ") || "none"})`);
        if (new Set(c.items).size !== c.items.length) p.push(`${w}: an item is named twice`);
      }
    }
  });
  // the last chapter is the end: no promise of another
  const last = side.chapters[side.chapters.length - 1];
  if (last && Array.isArray(last.paragraphs) && last.paragraphs.some((x) => typeof x === "string" && (lang === "zh" ? /下回分解|下回再說/ : /next chapter/i).test(x)))
    p.push(`${lang} chapter ${side.chapters.length}: it is the last chapter; do not promise a next one`);
  return p;
}

export function validateReport(report, digest) {
  if (!digest || !Array.isArray(digest.turns)) throw new Error("validateReport: a digest is required");
  if (!report || typeof report !== "object") return ["the report is not an object"];
  return LANGS.flatMap((lang) => validateLanguage(report[lang], digest, lang));
}
