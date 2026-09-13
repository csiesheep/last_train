# The Night Boat 夜航船

A browser card game of hidden societies for 3 to 10 passengers. A boat crosses the river after midnight; everyone aboard secretly belongs to the Lamplighters or the Keyholders, carries a trade with one trick to it, and a piece of luggage. Trade items to learn who is who, pick fights to see cards or take things, and call the win when your side holds three lamps or three keys and you can say whose hands they are in. Play solo against AI passengers, or open an online room and share a four-letter code with friends; bots fill any empty seats. English and Traditional Chinese.

A free fan project, not affiliated with any publisher. All art and prose are our own. The play is inspired by *Die Kutschfahrt zur Teufelsburg*, a card game designed by Michael Palm and Lukas Zach; game rules and mechanics are not copyrightable, and this is a clean-room implementation under its own name and setting.

Will live at https://games.csiesheep.com/night_boat/ (not deployed yet).

## How it works

Everything runs on Cloudflare as one Worker, the same shape as [Tiandihui](https://github.com/csiesheep/tiandihui) and [Dice Wars](https://github.com/csiesheep/dice_war):

- `public/` is the client: landing, setup, lobby and the table view, served as static assets. `public/shared/engine.js` holds all rules (the deck, the turn machine, fights and trades, the per-seat view projection), `public/shared/bots.js` the AI and `public/shared/talk.js` the bots' table talk, all used unchanged by both the browser and the server. Every player-visible string is in `public/i18n/`.
- `src/index.js` is the Worker: the path-prefix router that serves `/night_boat/…` plus the WebSocket entry point at `/night_boat/ws`.
- `src/room.js` is a Durable Object, one per room, named by its code. It is authoritative: it deals the cards, applies every action through the engine, keeps the phase clock, runs the bot seats, and sends each seat only `view(state, seat)`, never the state.

URLs are query strings on the page so the same build works at any prefix:

- `/night_boat/` landing
- `/night_boat/?play` single player
- `/night_boat/?room=ABCD` an online room

## Milestones

1. **M0 Scaffold**: router, placeholder page, deploy.
2. **M1 Engine**: deck, turn machine, trades, fights with support, declarations, `view(state, seat)`, tests.
3. **M2 Bots**: a belief over society assignments and hidden hands, trade and fight policies, three levels, a bot-vs-bot harness.
4. **M3 Solo**: the full game against bots in the browser, with bot table talk.
5. **M4 Rooms**: Durable Object, phase timers, chat, bot fill, disconnect takeover.
6. **M5 Ship**: rules page, SEO, hub card, sitemap.

## Develop

```bash
npm install
npm run dev
```

Then open http://localhost:8787/night_boat/.

```bash
npm test          # engine and bot tests
npm run sim 300   # bot-vs-bot win rates per player count and level (M2)
```

## Deploy

```bash
npm run deploy
```

Deploys from a logged-in `wrangler`. The routes in `wrangler.jsonc` attach the Worker to `games.csiesheep.com/night_boat` and `/night_boat/*`; the `games` hub Worker keeps the hostname itself.
