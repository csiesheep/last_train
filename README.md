# The Last Night Train 末班夜車

A browser card game of hidden gangs for 3 to 10 passengers. The 1930s, the last train out; everyone in the carriage secretly belongs to the Timekeepers or the Sealbearers, has a trade with one trick to it, and a piece of luggage. Trade items to learn who is who, start scuffles to see cards or take things, and show your hand when your side holds three pocket watches or three jade seals and you can say whose bags they are in. Play solo against AI passengers, or open an online compartment and share a four-letter code with friends; bots fill any empty seats. English and Traditional Chinese.

A free fan project, not affiliated with any publisher. All art and prose are our own. The play is inspired by *Die Kutschfahrt zur Teufelsburg*, a card game designed by Michael Palm and Lukas Zach; game rules and mechanics are not copyrightable, and this is a clean-room implementation under its own name and setting.

Will live at https://games.csiesheep.com/last_train/ (not deployed yet).

## How it works

Everything runs on Cloudflare as one Worker, the same shape as [Tiandihui](https://github.com/csiesheep/tiandihui) and [Dice Wars](https://github.com/csiesheep/dice_war):

- `public/` is the client: landing, setup, lobby and the carriage view, served as static assets. `public/shared/engine.js` holds all rules (the deck, the turn machine, scuffles and trades, the per-seat view projection), `public/shared/bots.js` the AI and `public/shared/talk.js` the bots' table talk, all used unchanged by both the browser and the server. Every player-visible string is in `public/i18n/`.
- `src/index.js` is the Worker: the path-prefix router that serves `/last_train/…` plus the WebSocket entry point at `/last_train/ws`.
- `src/room.js` is a Durable Object, one per compartment, named by its code. It is authoritative: it deals the cards, applies every action through the engine, keeps the phase clock, runs the bot seats, and sends each seat only `view(state, seat)`, never the state.

URLs are query strings on the page so the same build works at any prefix:

- `/last_train/` landing
- `/last_train/?play` single player
- `/last_train/?room=ABCD` an online compartment

## Milestones

1. **M0 Scaffold**: router, placeholder page, deploy.
2. **M1 Engine**: deck, turn machine, trades, scuffles with support, declarations, `view(state, seat)`, tests.
3. **M2 Bots**: a belief over gang assignments and hidden hands, trade and scuffle policies, three levels, a bot-vs-bot harness.
4. **M3 Solo**: the full game against bots in the browser, with bot table talk.
5. **M4 Rooms**: Durable Object, phase timers, chat, bot fill, disconnect takeover.
6. **M5 Ship**: rules page, SEO, hub card, sitemap.

## Develop

```bash
npm install
npm run dev
```

Then open http://localhost:8787/last_train/.

```bash
npm test          # engine and bot tests
npm run sim 300   # bot-vs-bot win rates per player count and level (M2)
```

## Deploy

```bash
npm run deploy
```

Deploys from a logged-in `wrangler`. The routes in `wrangler.jsonc` attach the Worker to `games.csiesheep.com/last_train` and `/last_train/*`; the `games` hub Worker keeps the hostname itself.
