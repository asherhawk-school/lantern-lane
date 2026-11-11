import { useEffect, useRef } from 'preact/hooks';
import { unlock } from '../audio/sound.ts';
import { startGame } from '../engine/game.ts';
import { connect, reconnectNow } from '../net/client.ts';
import { connState, decorate, kickReason, needName, panel, people, roomInfo, self, showToast, toast, type Panel } from '../state.ts';
import { AccountPanel } from './Account.tsx';
import { coinUrl, flameUrl } from './icons.ts';
import { RoomPicker, SettingsPanel, Shop, StatsPanel, Wardrobe } from './Panels.tsx';
import { DecorateBar, EmoteBar, People } from './Side.tsx';
import { TimerPanel } from './TimerPanel.tsx';
import { Welcome } from './Welcome.tsx';

function Hud() {
  const me = self.value;
  const room = roomInfo.value;
  const focusing = people.value.filter((p) => p.focusEndsAt !== null).length;

  const copy = async () => {
    if (!room?.code) return;
    try {
      await navigator.clipboard.writeText(room.code);
      showToast('Invite code copied');
    } catch {
      showToast(`Invite code: ${room.code}`);
    }
  };

  return (
    <header class="hud">
      <span class="brand">Lantern Lane</span>
      <span class="where">{room ? room.name : 'Lantern Lane'}</span>
      {room?.code && (
        <button class="code" onClick={copy} title="Copy invite code">
          {room.code}
        </button>
      )}
      <span class="grow" />
      {room && <span class="stat">{focusing} focusing</span>}
      {me && (
        <>
          <span class="stat" title="Day streak">
            <img class="px" src={flameUrl()} alt="Streak" /> {me.streak}
          </span>
          <span class="stat" title="Coins">
            <img class="px" src={coinUrl()} alt="Coins" /> {me.coins}
          </span>
        </>
      )}
    </header>
  );
}

function Toolbar() {
  const me = self.value;
  const room = roomInfo.value;
  const mine = !!me && !!room && room.ownerId === me.id;
  const open = (p: Panel) => () => {
    unlock();
    panel.value = panel.value === p ? null : p;
  };
  const d = decorate.value;

  return (
    <nav class="bar">
      <button class="btn" onClick={open('rooms')}>
        Rooms
      </button>
      {mine && (
        <button class={`btn${d.on ? '' : ' alt'}`} onClick={() => (decorate.value = { on: !d.on, item: null, moving: null })}>
          Decorate
        </button>
      )}
      <button class="btn alt" onClick={open('shop')}>
        Shop
      </button>
      <button class="btn alt" onClick={open('wardrobe')}>
        Wardrobe
      </button>
      <button class="btn alt" onClick={open('stats')}>
        Stats
      </button>
      <button class="btn alt" onClick={open('settings')}>
        Settings
      </button>
    </nav>
  );
}

function Status() {
  const state = connState.value;
  if (state === 'kicked') {
    return (
      <div class="modal-back solid">
        <div class="box modal welcome">
          <h2>Signed out here</h2>
          <p>{kickReason.value || 'This tab was disconnected.'}</p>
          <button class="btn" onClick={reconnectNow}>
            Use Lantern Lane here
          </button>
        </div>
      </div>
    );
  }
  if (state === 'offline') return <div class="banner">Offline: your timer still works. Looking for other players...</div>;
  return null;
}

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startGame(canvas.current!, stage.current!);
    connect();
  }, []);

  const p = panel.value;
  const note = toast.value;

  return (
    <div class="app">
      <Hud />
      <main class="stage" ref={stage}>
        <canvas id="game" ref={canvas} aria-label="The room. Click a chair to sit, click the floor to walk." />
      </main>
      <aside class="side">
        <DecorateBar />
        <TimerPanel />
        <EmoteBar />
        <People />
      </aside>
      <Toolbar />
      {p === 'rooms' && <RoomPicker />}
      {p === 'shop' && <Shop />}
      {p === 'wardrobe' && <Wardrobe />}
      {p === 'stats' && <StatsPanel />}
      {p === 'settings' && <SettingsPanel />}
      {p === 'account' && <AccountPanel />}
      {needName.value && <Welcome />}
      <Status />
      {note && (
        <div class="toast" key={note.id} role="status">
          {note.text}
        </div>
      )}
    </div>
  );
}
