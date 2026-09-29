// The 車務日誌 page: shared/devlog.js drawn as a railway timetable. One station
// per day on a track down the left, each entry a card with its tag, and on a
// wide screen a side column with the newest one. Opening the page marks the
// newest entry as seen, which takes the notice and the dot off the landing.
import zh from "./i18n/zh-Hant.js";
import en from "./i18n/en.js";
import { ENTRIES, LATEST, SEEN_KEY } from "./shared/devlog.js";

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const qs = new URLSearchParams(location.search);
let lang = qs.get("lang") === "en" || qs.get("lang") === "zh-Hant" ? qs.get("lang") : store.get("lt.lang", (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-Hant" : "en");
let S = lang === "en" ? en : zh;
let filter = "all";
const t = (key) => String(key.split(".").reduce((o, k) => (o ? o[k] : undefined), S) ?? key);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const L = () => (lang === "en" ? "en" : "zh");
const TAGS = ["new", "rule", "look", "dlc", "fix"];

function days(list) {
  const out = [];
  for (const e of list) {
    const d = out[out.length - 1];
    if (d && d.date === e.date) d.entries.push(e); else out.push({ date: e.date, entries: [e] });
  }
  return out;
}
const board = (date) => date.slice(5).replace("-", ".");
const weekday = (date) => S.devlog.week[new Date(date + "T12:00:00+08:00").getUTCDay()];
function card(e, lead) {
  const x = e[L()];
  return `<article class="ent${lead ? " lead" : ""}" id="${esc(e.id)}"><span class="tagp t-${e.tag}">${esc(S.devlog.tags[e.tag])}</span>` +
    `<h3 class="disp">${esc(x.title)}</h3><p>${esc(x.body)}</p>${e.img ? `<img class="shot" src="art/${esc(e.img)}" alt="" loading="lazy">` : ""}</article>`;
}
function render() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  $("langBtn").textContent = lang === "en" ? "中文" : "EN";
  document.title = `${t("devlog.title")} · ${lang === "en" ? "The Last Night Train" : "末班夜車"}`;
  $("dChips").innerHTML = ["all", ...TAGS].map((k) => `<button type="button" class="chip${filter === k ? " on" : ""}" data-k="${k}" aria-pressed="${filter === k}">${esc(k === "all" ? t("devlog.all") : S.devlog.tags[k])}</button>`).join("");
  for (const b of $("dChips").querySelectorAll(".chip")) b.onclick = () => { filter = b.dataset.k; render(); };
  const list = ENTRIES.filter((e) => filter === "all" || e.tag === filter || (filter === "new" && e.tag === "launch"));
  $("dTrack").innerHTML = days(list).map((d) =>
    `<section class="day"><span class="stn" aria-hidden="true"></span><div class="date"><span class="board lat">${board(d.date)}</span><span class="wk">${esc(weekday(d.date))}</span></div>` +
    d.entries.map((e) => card(e, e === LATEST)).join("") + `</section>`).join("") || `<p class="hint">—</p>`;
  const x = LATEST[L()];
  $("dSide").innerHTML = `<div class="card sidecard lead"><span class="lab">${esc(t("devlog.latest"))}</span>${LATEST.img ? `<img src="art/${esc(LATEST.img)}" alt="">` : ""}` +
    `<b class="disp">${esc(x.title)}</b><span class="hint">${esc(x.body)}</span><a class="btn p" href=".">${esc(t("devlog.board"))}</a></div>` +
    `<div class="card sidecard"><span class="lab">${esc(t("devlog.also"))}</span><a href="rules">${esc(t("nav.rules"))} ›</a><a href="https://games.csiesheep.com/">${esc(t("nav.hub"))} ›</a></div>`;
}
$("langBtn").onclick = () => {
  lang = lang === "en" ? "zh-Hant" : "en";
  S = lang === "en" ? en : zh;
  store.set("lt.lang", lang);
  const u = new URL(location.href); u.searchParams.set("lang", lang); history.replaceState(null, "", u);
  render();
};
render();
store.set(SEEN_KEY, LATEST.id);
