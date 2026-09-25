// How long the table holds still after a move, so a person can take it in.
//
// The wait is set by what the move just put on screen, not by the step that
// comes next. A move that changed nothing anyone can see -- a bot with no
// power passing a priest's window, showing nothing in a scuffle, the hidden
// half of a trade -- goes by almost at once. The moves that did show something
// get the time it takes to read it. Measured over bot games at six seats,
// about half of all bot moves are the silent kind.
//
// Shared by the solo carriage in the browser and the compartment server, so a
// bot moves at the same pace wherever it sits.

export const DWELL = {
  silent: 300,   // nothing changed on screen
  read: 1000,    // the player has just dismissed a result card: they have read it
  support: 1200, // a backer declared a side in a scuffle
  begin: 1500,   // someone started a trade or a scuffle
  small: 1500,   // a pass, a stop with no event
  shown: 1800,   // something appeared on the ring: a card shown, a bystander named, a coin tossed
  normal: 2500,  // an ordinary line in the log: a trade done or refused, a gift, a demand
  big: 4000,     // a scuffle's result, a trade that announced its effect, an event card, a declaration
};
const RANK = ["silent", "read", "support", "begin", "small", "shown", "normal", "big"];
// When several moves land before the next wait (bots answering a step together),
// the wait is the longest any of them earned.
export const louder = (a, b) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

// A bot that answers the powers step with nothing still leaves an empty entry in
// f.shown: only entries with something in them show on the ring.
const visibleShown = (f) => Object.entries(f.shown || {}).filter(([, x]) => (x.items && x.items.length) || x.trade).map(([s]) => s).sort();
function ringSig(st) {
  const f = st.scuffle;
  return f ? JSON.stringify([f.support, visibleShown(f), f.hypnotized ?? null, f.gunman ?? null, f.priest ?? null, f.dice || null]) : "";
}
const isBig = (e) => e.type === "scuffle" || e.type === "declare" || e.type === "solo" ||
  (e.type === "trade" && e.accepted && (e.announced || []).length > 0) || (e.type === "event" && !!e.id);
const isSmall = (e) => e.type === "pass" || e.type === "start" || (e.type === "event" && !e.id);

// What a move from `before` to `after` put in front of the players.
export function moveTier(before, after) {
  const added = after.log.slice(before.log.length);
  if (added.some(isBig)) return "big";
  if (added.length && added.every(isSmall)) return "small";
  if (added.length) return "normal";
  if (before.phase === "scuffle" && before.scuffle && before.scuffle.step === "support") return "support";
  if (before.phase === "turn" && (after.phase === "scuffle" || after.phase === "trade")) return "begin";
  if (before.scuffle && after.scuffle && ringSig(after) !== ringSig(before)) return "shown";
  return "silent";
}
