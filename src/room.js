// One Durable Object per room, named by its four-letter code. M4 fills this
// in from the tiandihui shape: WebSocket Hibernation, one alarm for every
// timer, bots in empty seats, per-seat `view(state, seat)` and never the
// state. Until then the object only answers the router's existence probe so
// M0 can deploy the Worker with its binding in place.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      const room = await this.ctx.storage.get("room");
      return Response.json({ exists: !!room });
    }
    return new Response("Rooms open in M4", { status: 501 });
  }
}
