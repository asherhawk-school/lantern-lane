import { PAL } from '../../../shared/src/palette.ts';
import type { ClientMsg, JoinTarget, ServerMsg } from '../../../shared/src/protocol.ts';
import { play } from '../audio/sound.ts';
import { Host, type Store } from '../host/host.ts';
import { connState, decorate, kickReason, needName, net, panel, result, roomInfo, self, settings, showToast, stats } from '../state.ts';
import { addPlayer, applyMoved, applyPatch, celebrate, loadRoom, refreshPeople, removePlayer, setFurniture, showEmote, world } from '../world/world.ts';
import { createRelay, type LiveRelay } from './relay.ts';

/**
 * Wires the in-browser game host to the interface and to the relay.
 * The host answers the panels' requests; the relay carries what other players are doing.
 */

const params = new URLSearchParams(location.search);
// `?guest=2` gives a tab its own saved player, so two tabs in one browser can be two people.
const guest = params.get('guest');
const suffix = guest ? `.${guest.replace(/[^\w-]/g, '')}` : '';
const SAVE_KEY = 'lanternlane.save' + suffix;
// `?speed=60` runs session clocks 60x faster, for testing.
const speed = Number(params.get('speed')) || 1;

const store: Store = {
  get() {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      localStorage.setItem(SAVE_KEY, value);
    } catch {
      // Storage is unavailable (private window): progress lasts for this visit only.
    }
  },
};

let host: Host | null = null;
let relay: LiveRelay | null = null;
let lastTarget: JoinTarget = { type: 'public', kind: 'cafe' };

// Only one tab per saved player: a newer tab takes over and the older one steps aside.
const tabId = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lanternlane' + suffix) : null;
channel?.addEventListener('message', (ev) => {
  if (ev.data?.t === 'here' && ev.data.tab !== tabId && host) {
    shutdown();
    kickReason.value = 'Lantern Lane is open in another tab.';
    connState.value = 'kicked';
  }
});

function shutdown(): void {
  host?.stop();
  host = null;
  relay?.end();
  relay = null;
}

export function send(msg: ClientMsg): void {
  host?.handle(msg);
}

export function submitName(name: string): void {
  send({ t: 'hello', name });
}

export function joinRoom(target: JoinTarget): void {
  send({ t: 'join', target });
}

function notify(title: string, body: string): void {
  if (!settings.value.notify || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  try {
    new Notification(title, { body });
  } catch {
    // Some browsers only allow notifications from a service worker; the chime still plays.
  }
}

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case 'need_name':
      needName.value = { reason: m.reason };
      return;
    case 'welcome':
      net.timeScale = m.timeScale;
      self.value = m.self;
      world.meId = m.self.id;
      needName.value = null;
      if (m.result) result.value = m.result;
      joinRoom(m.resume ? { type: 'resume' } : lastTarget);
      return;
    case 'room': {
      const r = m.room;
      loadRoom(r);
      roomInfo.value = { id: r.id, kind: r.kind, name: r.name, access: r.access, code: r.code, ownerId: r.ownerId };
      decorate.value = { on: false, item: null, moving: null };
      panel.value = null;
      if (r.access === 'public') lastTarget = { type: 'public', kind: r.kind === 'library' ? 'library' : 'cafe' };
      else if (r.code) lastTarget = { type: 'code', code: r.code };
      return;
    }
    case 'join':
      addPlayer(m.p);
      return;
    case 'leave':
      removePlayer(m.id);
      return;
    case 'moved':
      applyMoved(m.id, m.path, m.sitting);
      return;
    case 'upd':
      applyPatch(m.id, m.patch);
      return;
    case 'emote':
      showEmote(m.id, m.kind);
      return;
    case 'done':
      celebrate(m.id, [PAL.yellow, PAL.orange, PAL.white]);
      if (m.id !== world.meId) play('soft');
      return;
    case 'self':
      self.value = m.self;
      refreshPeople();
      return;
    case 'result':
      result.value = m.result;
      play('done');
      notify('Session complete', `${m.result.minutes} minutes done. +${m.result.coins} coins`);
      return;
    case 'break_done':
      play('break');
      showToast('Break is over');
      notify('Break is over', 'Ready for another session?');
      return;
    case 'furniture':
      setFurniture(m.items);
      return;
    case 'stats':
      stats.value = m.stats;
      return;
    case 'error':
      showToast(m.msg);
      return;
    case 'kicked':
    case 'pong':
      return;
  }
}

export function connect(): void {
  shutdown();
  connState.value = 'connecting';
  channel?.postMessage({ t: 'here', tab: tabId });

  relay = createRelay({
    onMessage: (topic, payload) => host?.relayMessage(topic, payload),
    onStatus: (online) => {
      if (connState.value === 'kicked') return;
      connState.value = online ? 'online' : 'offline';
      if (online) host?.relayOnline();
    },
  });
  host = new Host({ store, relay, deliver: onMessage, timeScale: speed, bots: params.get('bots') !== '0' });
  host.start();
  send({ t: 'hello' });
}

/** After another tab took over, bring the game back to this one. */
export function reconnectNow(): void {
  connect();
}

// Tell the room we are going, so our avatar disappears at once instead of timing out.
window.addEventListener('pagehide', () => host?.stop());
