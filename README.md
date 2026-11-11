# Lantern Lane

A multiplayer pixel-art focus room. Walk your avatar into a cafe or library, sit down, and run a
focus timer alongside other people. Finished sessions earn coins for outfits and for furniture in
your own room.

**Play:** https://asherhawk-school.github.io/lantern-lane/

## How it plays

- Click the floor to walk (or use WASD / arrow keys). Click a free chair to sit.
- Seated, pick a length and start a session. Everyone in the room sees your timer over your head.
- Finishing pays 1 coin per minute, plus a bonus on the first session of each day that grows with
  your streak. Giving up pays nothing.
- If you close the tab mid-session it keeps counting; reopen the page and you are back in a seat.
- Click the door (or Rooms) to switch between the public Cafe and Library, your own room, or a
  private room shared by a 6-character invite code.
- Shop sells clothes and furniture. Decorate (in your own room) places furniture, and friends can
  visit with your room's code.
- Quiet public rooms get a few characters labelled `[BOT]` so they never feel empty.

## How it works

There is no game server. The whole game is a static page:

- **Your progress** (coins, outfit, furniture, streak, session history) is saved in your browser's
  storage. It stays on that browser and device; clearing site data resets it.
- **Other players** reach you through a free public message relay, the HiveMQ MQTT broker
  (`wss://broker.hivemq.com:8884/mqtt`), using [MQTT.js](https://github.com/mqttjs/MQTT.js). Each
  browser publishes its own avatar's state for the room it is in and listens for everyone else's.
- **Room furniture** is kept on the relay as a retained message, so visitors see a room even when
  its owner is away.
- **Bots** are run by each browser for itself, so two players may see different ones.

Because the relay is public and each browser keeps its own score, this is not secure against a
determined cheater: someone technical could edit their own coins, or publish fake avatars. What is
protected is everyone else: anything arriving from the relay is checked against a schema and the
room's rules before it is shown, a flooding sender is rate-limited, and nothing another player
sends can change your coins, seat, or saved data. If the relay is down or slow, the timer and your
own room still work; you just will not see other people until it comes back.

All art is drawn in code from one palette (`shared/src/palette.ts`); there are no image or audio
files.

## Run it yourself

Needs Node.js 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with live reload |
| `npm test` | Rules, sync and untrusted-input tests |
| `npm run typecheck` | Type-check everything |
| `npm run build` | Build the static site into `client/dist` |

Pushing to `main` runs the tests and publishes `client/dist` to GitHub Pages.

Handy URL options:

- `?guest=2` gives a tab its own saved player, so two tabs can be two people.
- `?speed=60` runs session clocks 60x faster (a 25-minute session takes 25 seconds).
- `?bots=0` turns off the filler bots.

In the browser console, `window.__hour = 22` previews the night-time look (any hour 0-24).

## Layout

```
shared/src        Rules: room layouts, pathfinding, rewards, catalog, name checks, message types
client/src/host   The game logic that runs in each browser, and the peer-to-peer wire format
client/src/net    The relay connection and the glue to the interface
client/src        Canvas game (engine/, world/, art/), Preact panels (ui/), sound (audio/)
tests/            Vitest suites; several simulated browsers talk through an in-memory relay
```
