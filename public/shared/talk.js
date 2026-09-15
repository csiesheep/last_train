// Table talk: a short line a bot says when it acts, built from the `why` its
// decision carried, so the line is true to what the bot actually concluded.
// Templates live in the language files under `talk`; this module holds no
// prose. ctx: { rng, names, T (the language's talk table) }

const pick = (rng, arr) => arr[rng.int(arr.length)];
const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ""));

// What a bot says on an action, or null for silence. Most actions are quiet
// most of the time; a table where everyone comments on everything is noise.
export function sayAction(action, view, ctx) {
  const T = ctx.T, rng = ctx.rng, N = (s) => ctx.names[s];
  const say = (key, p = {}, chance = 1) => (T[key] && rng.next() < chance ? fill(pick(rng, T[key]), p) : null);
  const f = view.scuffle;
  switch (action.type) {
    case "offer": {
      if (action.why === "probe") return say("probe", { to: N(action.to) }, 0.5);
      if (action.why === "dump") return say("dump", { to: N(action.to) }, 0.7);
      return say("offer", { to: N(action.to) }, 0.35);
    }
    case "attack": return say(action.why === "attack_take" ? "attackTake" : "attack", { to: N(action.target) }, 0.7);
    case "declare": return say("declare", {}, 0.9);
    case "support":
      if (action.side === "attacker") return say("backAttacker", { a: N(f.attacker) }, 0.6);
      if (action.side === "defender") return say("backDefender", { d: N(f.defender) }, 0.6);
      return say("stayOut", {}, 0.25);
    case "window":
      if (!action.use) return null;
      return say(f.step, f.step === "pharmacist" ? { w: N(action.winner) } : {}, 0.9);
    case "show":
      if (action.trade && action.winner != null) return say("pharmacist", { w: N(action.winner) }, 0.9);
      return null;
    case "choice": return say(action.take ? "take" : "peek", {}, 0.3);
    case "answer":
      if (action.why === "good_deal") return say("goodDeal", {}, 0.4);
      if (action.why === "help_ally") return say("helpAlly", {}, 0.5);
      if (action.why === "bad_deal") return say("badDeal", {}, 0.5);
      return null;
    case "bribe": return action.pay ? say("bribe", {}, 0.7) : null;
    case "yieldItem": return say("yield", {}, 0.4);
    default: return null;
  }
}

// A reaction to a public event this seat was part of, or null.
export function sayResult(entry, seat, ctx) {
  const T = ctx.T, rng = ctx.rng;
  if (entry.type === "scuffle" && entry.winner != null && !entry.doctored) {
    const loser = entry.winner === entry.attacker ? entry.defender : entry.attacker;
    if (seat === entry.winner) return rng.next() < 0.3 ? pick(rng, T.won) : null;
    if (seat === loser) return rng.next() < 0.4 ? pick(rng, T.lost) : null;
  }
  if (entry.type === "declare" && !entry.correct && seat === entry.seat) return pick(rng, T.wrongDeclared);
  return null;
}
