// Who has looked at whose gang card or trade, worked out from the public log
// alone: the things the whole carriage saw happen.
//
//   a scuffle's winner choosing to look   -> the loser's gang and trade
//   a monocle handed over in a trade      -> the other side's gang
//   a codebook swap                       -> each other's trade
//
// Nothing here says what anyone saw -- only that they looked. What a seat saw
// with its own eyes comes from its own knowledge list, and the page adds it.

// One entry per looker, looked-at and card: the latest look.
export function looksFromLog(log) {
  const looks = new Map();
  const add = (by, of, what, at, via) => {
    if (by == null || of == null || by === of) return;
    const key = by + "|" + of + "|" + what, old = looks.get(key);
    if (!old || old.at <= at) looks.set(key, { by, of, what, at, via });
  };
  for (const e of log) {
    if (e.type === "scuffle" && e.choice === "peek" && e.winner != null && e.stopped == null && e.doctored == null && !e.tie) {
      const loser = e.winner === e.attacker ? e.defender : e.attacker;
      add(e.winner, loser, "gang", e.t, "scuffle");
      add(e.winner, loser, "trade", e.t, "scuffle");
    }
    if (e.type === "trade" && e.accepted) {
      for (const a of e.announced || []) if (a.kind === "monocle") add(a.seat, a.seat === e.from ? e.to : e.from, "gang", e.t, "monocle");
    }
    if (e.type === "codebook" && e.swapped) {
      add(e.seat, e.partner, "trade", e.t, "codebook");
      add(e.partner, e.seat, "trade", e.t, "codebook");
    }
  }
  return looks;
}

// A trade looked at before its owner swapped it away or took a new one is out of date.
export function isStale(look, log) {
  if (look.what !== "trade") return false;
  return log.some((e) => e.t > look.at && (e.seat === look.of || e.partner === look.of) &&
    ((e.type === "codebook" && e.swapped) || (e.type === "coat" && e.changed)));
}
