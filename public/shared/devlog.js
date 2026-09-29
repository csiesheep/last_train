// The 車務日誌 (dev log): every refit of the train, newest first. The dev log
// page draws these; the landing reads the newest one for its notice. Add an
// entry at the top when something a player would notice ships.
//   tag: new | rule | look | dlc | fix | launch   img: a picture under art/, or none
export const ENTRIES = [
  { id: "report", date: "2026-09-28", tag: "new", img: "event_password.jpg",
    zh: { title: "說書人替你寫一局推理", body: "一局結束後，可以請說書人把這一局寫成一篇推理小說，有自己的網址可以分享。讀到最後一站之前，先猜猜每個人是哪一邊，再按「揭曉」。" },
    en: { title: "The storyteller writes your game up as a mystery", body: "When a game ends, ask the storyteller to turn it into a short detective story at its own address, to share. Before the last stop, guess who belonged where, then press Reveal." } },
  { id: "voice", date: "2026-09-28", tag: "new", img: "carriage.jpg",
    zh: { title: "包廂可以用說的了", body: "包廂裡按住右下角的圓鈕說話，放開就停。車長也可以改成開放麥克風，或乾脆關掉；不想說話的人可以只聽。聲音只在這間包廂裡，不錄音。" },
    en: { title: "Talk in a compartment", body: "Hold the round button at the lower right to talk, let go to stop. The conductor can switch to an open mic, or turn voice off; anyone can just listen. Sound stays in the compartment and is never recorded." } },
  { id: "export", date: "2026-09-25", tag: "new",
    zh: { title: "賽後匯出這局", body: "結算頁多了「匯出這局」：好讀的行車紀錄，或是能原樣重播整局的重播檔。" },
    en: { title: "Export a finished game", body: "The result page has Export this game: a journey log to read, or a replay file that plays the whole game again." } },
  { id: "lastbag", date: "2026-09-25", tag: "rule",
    zh: { title: "沒有人空手離開衝突", body: "照原版規則修正：搶走對方最後一件行李時，贏的人要還一件自己的。" },
    en: { title: "Nobody leaves a scuffle empty-handed", body: "As in the original rules: whoever takes someone's last bag gives one of their own back." } },
  { id: "talk", date: "2026-09-25", tag: "look",
    zh: { title: "頭像上冒出閒話", body: "有人說話時，頭像旁邊冒出一個泡泡；行車紀錄多一頁「誰看過誰」。AI 動作也放慢了，看得清它們在做什麼。" },
    en: { title: "Talk over the passengers' heads", body: "When someone speaks, a bubble shows by their face; the journey log gains a page of who has seen whom. The AI passengers take their time, so you can follow them." } },
  { id: "stale", date: "2026-09-25", tag: "fix",
    zh: { title: "更新後會提醒你", body: "開著頁面時遊戲更新了，會請你重新整理，回到原本的座位。" },
    en: { title: "Told when the game is updated", body: "If the game is updated while your page is open, it asks you to reload and brings you back to your seat." } },
  { id: "journey", date: "2026-09-20", tag: "look", img: "event_lights.jpg",
    zh: { title: "行車紀錄變成車長筆記", body: "每一站可以收合，也記下只有你看到的事。" },
    en: { title: "The journey log becomes the conductor's notebook", body: "Each stop folds away, and what only you saw is written down too." } },
  { id: "tutorial", date: "2026-09-15", tag: "new", img: "hero.jpg",
    zh: { title: "新手教學與三段短片", body: "第一次上車的人有一局帶著走的教學；上車和下車各有一段十幾秒的短片。" },
    en: { title: "A first ride, and three short films", body: "A guided game for first-time passengers, and a short film each for boarding and for the end of the line." } },
  { id: "dlc", date: "2026-09-15", tag: "dlc",
    zh: { title: "車上人員、站站有事", body: "兩個可以自己打開的擴充：金條與三個新行當；每一站一張事件卡。" },
    en: { title: "The train crew, and something at every stop", body: "Two switches to try: the gold bar and three new trades, and an event card at every stop." } },
  { id: "art", date: "2026-09-14", tag: "look", img: "bench.jpg",
    zh: { title: "插畫版：十五位乘客上車", body: "每位乘客、每件行李、每個行當都有了月份牌風格的插畫；包廂大廳變成一張車票。" },
    en: { title: "Illustrated: fifteen passengers board", body: "Every passenger, bag and trade drawn in the style of old calendar posters; the compartment lobby became a railway ticket." } },
  { id: "launch", date: "2026-09-13", tag: "launch",
    zh: { title: "末班夜車開出", body: "單人對 AI、線上包廂、中英雙語，三到十人。" },
    en: { title: "The Last Night Train departs", body: "Solo against AI passengers or online compartments with friends, in Chinese and English, for three to ten." } },
];
export const LATEST = ENTRIES[0];
export const NEW_DAYS = 7; // the landing's notice shows while the newest entry is this fresh
export const SEEN_KEY = "lt.devlogSeen";
export const isFresh = (e, now = Date.now()) => now - Date.parse(e.date + "T00:00:00+08:00") < NEW_DAYS * 86_400_000;
