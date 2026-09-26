// A finished game as a file. The engine is a pure reducer, so a seed plus every
// move played is the whole game: `replay` builds it again, move for move, to the
// same end. That is the full record. The "seat" record is what one passenger
// saw -- the public log and their own notes -- and cannot be replayed, since the
// moves would give away everyone else's secrets.
import * as E from "./engine.js";

export const FORMAT = "last-train/game";
export const FORMAT_VERSION = 1;

// Moves as the engine takes them, stamped with the turn they were played on.
// Bots attach their reasons ("why", a confidence "p"): those are not moves.
export function cleanAction(turn, action) {
  const { why, p, ...rest } = action;
  return { t: turn, ...rest };
}

// The last state's cards on the table, by seat.
export function finalTable(st) {
  return st.seats.map((sd, seat) => ({ seat, gang: sd.gang, trade: sd.trade, bags: sd.items.map((id) => st.items[id]) }));
}

export function resultOf(st) {
  const last = [...st.log].reverse().find((e) => e.type === "declare" || e.type === "solo");
  return {
    winner: st.winner, reason: st.reason, by: last ? last.seat : null,
    stop: Math.max(1, Math.ceil(st.turnNo / st.n)), turn: st.turnNo,
  };
}

// Everything in a fixed order, so two exports of one game read the same.
export function buildRecord(r) {
  const out = {
    format: FORMAT, version: FORMAT_VERSION, exportedAt: r.exportedAt, build: r.build,
    mode: r.mode, scope: r.scope, lang: r.lang,
  };
  if (r.room) out.room = r.room;
  if (r.scope === "full") out.seed = r.seed;
  out.seats = r.n;
  out.options = { smuggling: !!(r.options && r.options.smuggling), events: !!(r.options && r.options.events), dlc: (r.options && r.options.dlc) || null };
  out.passengers = r.passengers;
  out.result = r.result;
  out.final = r.final;
  if (r.scope === "full") out.actions = r.actions;
  else { out.me = r.me; out.notes = r.notes; }
  out.log = r.log;
  return out;
}

// The game again from a full record: the same seed, the same moves, the same end.
export function replay(record) {
  if (record.format !== FORMAT || record.scope !== "full") throw new Error("only a full record can be replayed");
  let st = E.createGame(record.seed, record.seats, record.options);
  for (const { t, ...action } of record.actions) st = E.apply(st, action);
  return st;
}
