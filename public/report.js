// The 戰報 page: report.html?report=<key>. Waits while the storyteller writes
// (polling every three seconds), then draws the tale in chapters: the two
// societies' fortunes, a contents list, one chapter per stop with the carriage
// as it stood at the end of that stop, and the items the chapter pictures.
// Both languages come back in one answer; the switch redraws without asking again.
import zh from "./i18n/zh-Hant.js";
import en from "./i18n/en.js";

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let lang = qs.get("lang") === "en" || qs.get("lang") === "zh-Hant" ? qs.get("lang") : store.get("lt.lang", (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-Hant" : "en");
let S = lang === "en" ? en : zh;
const t = (key, p = {}) => String(key.split(".").reduce((o, k) => (o ? o[k] : undefined), S) ?? key).replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ""));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ZH_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const zhNum = (n) => (n <= 10 ? ZH_NUM[n] : n < 20 ? "十" + ZH_NUM[n - 10] : ZH_NUM[Math.floor(n / 10)] + "十" + (n % 10 ? ZH_NUM[n % 10] : ""));
const num = (n) => (lang === "en" ? String(n) : zhNum(n));
const L = () => (lang === "en" ? "en" : "zh");
const key = qs.get("report") || "";
const api = location.pathname.replace(/\/[^/]*$/, "") + "/api/report";
const ICON = {
  quill: '<path d="M20 4c-6 1-11 5-13 11l-2 5 5-2c6-2 10-7 11-13z"/><path d="M7 15l4 1"/>',
  train: '<rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M8 20l2-3"/><path d="M16 20l-2-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share: '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  dl: '<path d="M12 4v11"/><path d="M7 10.5L12 15.5l5-5"/><path d="M5 19.5h14"/>',
};
const icon = (k, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

let data = null, poll = 0;
const nameOf = (s) => (data && data.view && data.view.cast[s] ? data.view.cast[s].names[L()] : "?");
const mine = () => { try { const v = sessionStorage.getItem("lt.report.mine." + key); return v == null ? null : +v; } catch { return null; } };

function show(which) { for (const id of ["rpWait", "rpError", "rpArticle"]) $(id).hidden = id !== which; }

// ---------- waiting ----------
function renderWait() {
  const v = data && data.view;
  const n = v ? v.n : 0, stops = v ? v.stops : 0;
  const rail = stops ? `<div class="rail"><div class="ln"></div>${Array.from({ length: stops }, (_, i) => {
    const x = stops === 1 ? 50 : 4 + (92 * i) / (stops - 1);
    return `<span class="st" style="left:${x}%"></span>${stops <= 6 || i === 0 || i === stops - 1 ? `<span class="lb" style="left:${x}%">${esc(lang === "en" ? t("report.atStop", { n: i + 1 }) : "第" + zhNum(i + 1) + "站")}</span>` : ""}`;
  }).join("")}<span class="tr">${icon("train", 18)}</span></div>` : "";
  const ms = v ? v.moments[L()] || [] : [];
  $("rpWait").innerHTML =
    `<div class="card wait"><span class="quill">${icon("quill", 26)}</span><span class="disp" style="font-size:22px;letter-spacing:.12em">${esc(t("report.waitTitle"))}</span>` +
    (v ? `<span class="hint">${esc(t("report.waitNote", { n, s: stops }))}</span>` : "") + rail + `</div>` +
    (ms.length ? `<div class="card stack"><span class="lab">${esc(t("report.waitMoments"))}</span>${ms.map((m, i) => `<div class="mo"><span class="n">${i + 1}</span><span class="small">${esc(m.text)}</span></div>`).join("")}</div>` : "") +
    `<div class="card row" style="gap:10px"><span class="small grow">${esc(t("report.waitLeave"))}</span><button type="button" class="btn sm" id="wCopy">${icon("link")}${esc(t("report.copy"))}</button></div>` +
    `<a class="btn ghost" href=".">${esc(t("report.back"))}</a>`;
  $("wCopy").onclick = copyLink;
  show("rpWait");
}

// ---------- the ways it can go wrong ----------
function renderError(kind) {
  const titles = { fail: ["report.failTitle", "report.failNote"], final: ["report.finalTitle", "report.finalNote"], cap: ["report.capTitle", "report.capNote"], missing: ["report.notFound", ""], bad: ["report.badGame", ""] };
  const [a, b] = titles[kind];
  $("rpError").innerHTML = `<div class="card stack" style="border-color:${kind === "fail" || kind === "final" ? "#5a2a22" : "var(--line)"}"><b class="small">${esc(t(a))}</b>${b ? `<span class="hint">${esc(t(b))}</span>` : ""}` +
    (kind === "fail" && data && data.game ? `<button type="button" class="btn" id="eRetry">${esc(t("report.retry"))}</button>` : "") +
    (kind === "final" && data && data.game ? `<button type="button" class="btn ghost" id="eDl">${icon("dl")}${esc(t("report.download"))}</button>` : "") +
    `</div><a class="btn ghost" href=".">${esc(t("report.back"))}</a>`;
  if ($("eRetry")) $("eRetry").onclick = async () => {
    $("eRetry").disabled = true;
    const r = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data.game) }).catch(() => null);
    if (r && r.status === 429) return renderError("cap");
    tick();
  };
  if ($("eDl")) $("eDl").onclick = download;
  show("rpError");
}

// ---------- the tale ----------
function chart(turns) {
  const W = 330, mid = 42, x0 = 36, step = turns.length ? (W - x0 - 12) / turns.length : 0;
  const pts = [[x0, mid], ...turns.map((tn, i) => {
    const v = Math.max(-3, Math.min(3, (tn.goals.timekeepers || 0) - (tn.goals.sealbearers || 0)));
    return [x0 + step * (i + 1), mid - v * 10];
  })];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) { const [xa, ya] = pts[i - 1], [xb, yb] = pts[i]; const cx = (xa + xb) / 2; d += ` C${cx},${ya} ${cx},${yb} ${xb},${yb}`; }
  const labels = turns.map((_, i) => (turns.length <= 8 || i % 2 === 1 || i === turns.length - 1 ? `<text x="${x0 + step * (i + 1)}" y="82" font-size="9.5" fill="#8b91a0" text-anchor="middle">${esc(num(i + 1))}</text>` : "")).join("");
  return `<svg width="100%" height="86" viewBox="0 0 ${W} 86" role="img" aria-label="${esc(t("report.sway"))}" style="font-family:'Noto Sans TC',sans-serif">` +
    `<line x1="${x0}" y1="${mid}" x2="${W}" y2="${mid}" stroke="#2a3244"/><path d="${d}" fill="none" stroke="#c9a54f" stroke-width="2"/>` +
    `<text x="0" y="14" font-size="10" fill="#c9a54f">${esc(S.gang.timekeepers)}</text><text x="0" y="72" font-size="10" fill="#3f8a74">${esc(S.gang.sealbearers)}</text>${labels}</svg>`;
}
function ring(turn, caption, colored = true) {
  const cast = data.view.cast, n = cast.length;
  const Rx = n <= 6 ? 98 : 108, Ry = n <= 6 ? 66 : 72;
  let html = `<div class="mring"><div class="tbl"></div><div class="mid">${esc(lang === "en" ? t("report.atStop", { n: turn.stop }) : "第" + zhNum(turn.stop) + "站末")}</div>`;
  const me = mine() ?? 0;
  cast.forEach((c, k) => {
    const pos = (c.seat - me + n) % n;
    const ang = Math.PI / 2 + (2 * Math.PI * pos) / n;
    const x = 130 + Rx * Math.cos(ang), y = 95 + Ry * Math.sin(ang);
    const col = !colored ? "#4a5468" : c.gang === "timekeepers" ? "#c9a54f" : "#3f8a74";
    const face = c.face ? `<img class="f" src="art/face_${esc(c.face)}.jpg" alt="" style="border-color:${col}">` : `<span class="f" style="border-color:${col}">${esc([...c.names[L()]][0] || "?")}</span>`;
    html += `<div class="m${turn.hot.includes(c.seat) ? " hot" : ""}" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px">${face}<span>${esc(c.names[L()])}</span></div>`;
    void k;
  });
  html += "</div>";
  const legend = `<span class="figcap">${colored ? `<span class="gw">●</span> ${esc(S.gang.timekeepers)}　<span class="gs">●</span> ${esc(S.gang.sealbearers)}　` : ""}<span style="color:var(--rust)">◎</span> ${esc(t("report.legendHot"))}</span>`;
  return `<div class="fig">${html}${legend}${caption ? `<span class="figcap">${esc(caption)}</span>` : ""}</div>`;
}
function resultLine(v) {
  if (v.reason === "solo" && v.by != null) return `${esc(t("report.soloWon", { name: nameOf(v.by) }))} · ${esc(lang === "en" ? t("report.atStop", { n: v.stops }) : "第" + zhNum(v.stops) + "站")}`;
  const g = S.gang[v.winner] || v.winner;
  const cls = v.winner === "timekeepers" ? "gw" : "gs";
  return `<span class="${cls}">${esc(t("report.wonGang", { gang: g }))}</span>` + (v.by != null ? ` · ${esc(t("report.opened", { name: nameOf(v.by) }))}` : "") + ` · ${esc(lang === "en" ? t("report.atStop", { n: v.stops }) : "第" + zhNum(v.stops) + "站")}`;
}
function youLine(v) {
  const me = mine();
  if (me == null || !v.cast[me]) return "";
  const c = v.cast[me];
  const others = v.cast.filter((x) => x.seat !== me && x.gang === c.gang).map((x) => x.names[L()]);
  const g = S.gang[c.gang];
  return others.length ? t("report.youWith", { name: c.names[L()], others: others.join(lang === "en" ? ", " : "、"), gang: g }) : t("report.youAlone", { name: c.names[L()], gang: g });
}
const heading = (h) => esc(h).split(lang === "en" ? /\s*;\s*/ : /　+/).join(lang === "en" ? ";<br>" : "<br>");
function chapterHTML(c, i, last, colored) {
  const turn = data.view.turns[i];
  const items = (c.items || []).filter((k) => S.items[k]).slice(0, 2);
  return `<section class="ch" id="stop-${i + 1}"><div class="hui">${esc(t("report.hui", { n: num(i + 1) }))}</div><h2>${heading(c.heading)}</h2>` +
    c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("") +
    (turn && (turn.hot.length || last) ? ring(turn, c.caption, colored) : "") +
    (items.length ? `<div class="items">${items.map((k) => `<div class="item"><img src="art/item_${esc(k)}.jpg" alt=""><div><b>${esc(S.items[k])}</b><span class="hint">${esc((S.itemText && S.itemText[k]) || "")}</span></div></div>`).join("")}</div>` : "") +
    `</section>`;
}
const footerHTML = () =>
  `<div class="foot2"><div class="grid2"><button type="button" class="btn" id="fCopy">${icon("link")}${esc(t("report.copy"))}</button><button type="button" class="btn" id="fShare">${icon("share")}${esc(t("report.share"))}</button></div>` +
  `<div class="grid2"><button type="button" class="btn ghost" id="fDl">${icon("dl")}${esc(t("report.download"))}</button><a class="btn p" href=".">${esc(t("report.again"))}</a></div>` +
  `<span class="hint center">${esc(t("report.note"))}</span></div>`;
function wireFooter(R) {
  $("fCopy").onclick = copyLink;
  $("fShare").onclick = async () => { if (navigator.share) { try { await navigator.share({ title: R.title, url: shareUrl() }); } catch {} } else copyLink(); };
  $("fDl").onclick = download;
}

// ---------- style E: the challenge to the reader ----------
// Nobody's society shows until the reader has guessed: the chapters before the
// last draw the carriage without colours, then a card asks for a guess per
// passenger. 揭曉 shows the score, the last chapter and, for each passenger, the
// clue that gave them away. The guess is kept on this device.
const ch = { guess: {}, revealed: false };
const chKey = (k) => `lt.report.${k}.${key}`;
function loadChallenge() {
  try { ch.guess = JSON.parse(localStorage.getItem(chKey("guess")) || "{}"); ch.revealed = localStorage.getItem(chKey("revealed")) === "1"; } catch {}
}
function saveChallenge() { try { localStorage.setItem(chKey("guess"), JSON.stringify(ch.guess)); localStorage.setItem(chKey("revealed"), ch.revealed ? "1" : "0"); } catch {} }
const ringCol = (c) => (c.gang === "timekeepers" ? "#c9a54f" : "#3f8a74");
function renderChallenge() {
  const R = data.report[L()], v = data.view, n = v.cast.length, last = R.chapters.length - 1;
  document.title = `${R.title} · ${S.title || "末班夜車"}`;
  const gangOf = (c) => (ch.revealed ? `<span class="${c.gang === "timekeepers" ? "gw" : "gs"}">${esc(S.gang[c.gang])}</span>` : `<span class="qm">?</span>`);
  const castRow = `<div class="castrow">${v.cast.map((c) => `<div>${c.face ? `<img src="art/face_${esc(c.face)}.jpg" alt="" style="border-color:${ch.revealed ? ringCol(c) : "#4a5468"}">` : ""}<span>${esc(c.names[L()])}</span>${gangOf(c)}</div>`).join("")}</div>`;
  let html = `<h1>${esc(R.title)}</h1><div class="subt">${esc(t("report.eSub"))}</div>${castRow}<p>${esc(R.intro)}</p>` +
    R.chapters.slice(0, last).map((c, i) => chapterHTML(c, i, false, false)).join("");
  if (!ch.revealed) {
    const rows = v.cast.map((c) => {
      const g = ch.guess[c.seat];
      const b = (gang) => `<button type="button" class="gb${g === gang ? " on " + (gang === "timekeepers" ? "w" : "s") : ""}" data-seat="${c.seat}" data-gang="${gang}" aria-pressed="${g === gang}">${esc(S.gang[gang])}</button>`;
      return `<div class="gr">${c.face ? `<img src="art/face_${esc(c.face)}.jpg" alt="">` : ""}<b>${esc(c.names[L()])}</b><div class="seg2">${b("timekeepers")}${b("sealbearers")}</div></div>`;
    }).join("");
    html += `<div class="letter" id="challenge"><h3>${esc(t("report.eChallenge"))}</h3><p class="plain">${esc(t("report.eAsk"))}</p><div class="guess">${rows}</div>` +
      `<button type="button" class="btn p" id="eReveal">${esc(t("report.eReveal"))}</button><button type="button" class="linkish center" id="eSkip">${esc(t("report.eSkip"))}</button></div>`;
  } else {
    const guessed = v.cast.filter((c) => ch.guess[c.seat]);
    const right = v.cast.filter((c) => ch.guess[c.seat] === c.gang);
    const fooled = guessed.filter((c) => ch.guess[c.seat] !== c.gang).map((c) => c.names[L()]);
    const line = !guessed.length ? t("report.eNoGuess") : right.length === n ? t("report.eAll") : fooled.length ? t("report.eFooled", { names: fooled.join(lang === "en" ? ", " : "、") }) : "";
    const clues = R.clues || [];
    const verdict = v.cast.map((c) => {
      const cl = clues.find((x) => x.seat === c.seat);
      const g = ch.guess[c.seat];
      const mark = !g ? `<span class="hint">${esc(t("report.eNone"))}</span>` : g === c.gang ? `<span class="ok">${esc(t("report.eRight"))}</span>` : `<span class="no">${esc(t("report.eWrong"))}</span>`;
      return `<div class="vd">${c.face ? `<img src="art/face_${esc(c.face)}.jpg" alt="" style="border-color:${ringCol(c)}">` : ""}<div><b>${esc(c.names[L()])}</b>　${gangOf(c)}　${mark}` +
        (cl ? `<br><span class="small">${esc(cl.text)}</span> <a href="#stop-${cl.stop}">${esc(t("report.eSee"))} ›</a>` : "") + `</div></div>`;
    }).join("");
    const you = youLine(v);
    html += `<div class="score" id="challenge">${guessed.length ? `<span class="hint">${esc(t("report.eSaw"))}</span><b>${right.length} / ${n}</b>` : ""}${line ? `<span class="small">${esc(line)}</span>` : ""}</div>` +
      chapterHTML(R.chapters[last], last, true, true) +
      `<div class="res">${resultLine(v)}</div>${you ? `<div class="you">${esc(you)}</div>` : ""}` +
      `<div class="verdict">${verdict}</div>` +
      `<div class="box"><span class="lab">${esc(t("report.sway"))}</span>${chart(v.turns)}</div>` +
      `<p class="ending">${esc(R.ending)}</p>${R.poem ? `<div class="poem">${esc(R.poem)}</div>` : ""}`;
  }
  $("rpArticle").innerHTML = html + footerHTML();
  wireFooter(R);
  for (const b of document.querySelectorAll(".gb")) b.onclick = () => { ch.guess[+b.dataset.seat] = b.dataset.gang; saveChallenge(); renderChallenge(); };
  const go = () => { ch.revealed = true; saveChallenge(); renderChallenge(); const el = $("challenge"); if (el) el.scrollIntoView({ block: "start" }); };
  if ($("eReveal")) $("eReveal").onclick = go;
  if ($("eSkip")) $("eSkip").onclick = () => { ch.guess = {}; go(); };
  show("rpArticle");
}

function renderReport() {
  const R = data.report[L()], v = data.view;
  if (Array.isArray(R.clues)) return renderChallenge();
  document.title = `${R.title} · ${S.title || "末班夜車"}`;
  const toc = R.chapters.map((c, i) => `<a href="#stop-${i + 1}"><span>${esc(t("report.hui", { n: num(i + 1) }))}</span><span>${esc(c.heading)}</span></a>`).join("");
  const chapters = R.chapters.map((c, i) => chapterHTML(c, i, i === R.chapters.length - 1, true)).join("");
  const you = youLine(v);
  $("rpArticle").innerHTML =
    `<h1>${esc(R.title)}</h1><div class="subt">${esc(t("report.subtitle", { n: num(R.chapters.length) }))}</div>` +
    `<div class="res">${resultLine(v)}</div>${you ? `<div class="you">${esc(you)}</div>` : ""}` +
    `<div class="box"><span class="lab">${esc(t("report.sway"))}</span>${chart(v.turns)}</div>` +
    `<div class="box toc"><span class="lab">${esc(t("report.toc"))}</span>${toc}</div>` +
    `<p>${esc(R.intro)}</p>${chapters}` +
    `<p class="ending">${esc(R.ending)}</p>${R.poem ? `<div class="poem">${esc(R.poem)}</div>` : ""}` + footerHTML();
  wireFooter(R);
  show("rpArticle");
}

// ---------- links and files ----------
const shareUrl = () => location.origin + location.pathname + "?report=" + key;
async function copyLink(ev) {
  const b = ev && ev.currentTarget;
  try { await navigator.clipboard.writeText(shareUrl()); if (b) { const was = b.innerHTML; b.textContent = t("report.copied"); setTimeout(() => { b.innerHTML = was; }, 1500); } } catch {}
}
function download() {
  if (!data || !data.game) return;
  const blob = new Blob([JSON.stringify(data.game, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `last-train-${key.slice(0, 8)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- fetch and poll ----------
async function tick() {
  clearTimeout(poll);
  let res;
  try { res = await fetch(`${api}/${encodeURIComponent(key)}`); } catch { poll = setTimeout(tick, 3000); return; }
  if (res.status === 404) return renderError("missing");
  if (!res.ok) { poll = setTimeout(tick, 3000); return; }
  try { data = await res.json(); } catch { poll = setTimeout(tick, 3000); return; }
  if (data.state === "pending") { renderWait(); poll = setTimeout(tick, 3000); return; }
  if (data.state === "done" && data.report) return renderReport();
  renderError(data.final ? "final" : "fail");
}
function redraw() {
  document.documentElement.lang = lang;
  $("langBtn").textContent = lang === "en" ? "中文" : "EN";
  $("rpBrand").textContent = lang === "en" ? "The Last Night Train · Report" : "末班夜車 · 戰報";
  if (!data) return;
  if (data.state === "done" && data.report) {
    // keep the reader on the chapter they were reading
    let at = null;
    for (const s of document.querySelectorAll(".ch")) if (s.getBoundingClientRect().bottom > 60) { at = s.id; break; }
    renderReport();
    if (at) document.getElementById(at).scrollIntoView({ block: "start" });
  } else if (data.state === "pending") renderWait();
  else renderError(data.final ? "final" : "fail");
}
$("langBtn").onclick = () => {
  lang = lang === "en" ? "zh-Hant" : "en";
  S = lang === "en" ? en : zh;
  store.set("lt.lang", lang);
  const u = new URL(location.href); u.searchParams.set("lang", lang); history.replaceState(null, "", u);
  redraw();
};
redraw();
loadChallenge();
if (!/^[0-9a-f]{64}$/.test(key)) renderError("missing"); else { renderWait(); tick(); }
