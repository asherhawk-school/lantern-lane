import { useEffect, useState } from 'preact/hooks';
import { ITEMS, owns, type Item, type ItemKind, type Outfit } from '../../../shared/src/catalog.ts';
import { MAX_FURNITURE_EACH } from '../../../shared/src/constants.ts';
import { SKIN } from '../../../shared/src/palette.ts';
import { applySound, play, unlock } from '../audio/sound.ts';
import { joinRoom, send } from '../net/client.ts';
import { account, meView, panel, roomInfo, self, settings, showToast, stats, syncStatus, updateSettings } from '../state.ts';
import { avatarUrl, coinUrl, itemUrl } from './icons.ts';
import { Modal } from './Modal.tsx';

// ---------- Rooms ----------

export function RoomPicker() {
  const [code, setCode] = useState('');
  const busy = !!meView.value.focus;
  const me = self.value;
  const here = roomInfo.value;

  return (
    <Modal title="Where to?">
      {busy && <p class="error">Finish or give up your session before changing rooms.</p>}
      <div class="tiles">
        <button class="tile" disabled={busy} onClick={() => joinRoom({ type: 'public', kind: 'cafe' })}>
          <b>Cafe</b>
          <span>Public. Window seats, warm light, the smell of coffee.</span>
        </button>
        <button class="tile" disabled={busy} onClick={() => joinRoom({ type: 'public', kind: 'library' })}>
          <b>Library</b>
          <span>Public. Long tables between the shelves.</span>
        </button>
        <button class="tile" disabled={busy} onClick={() => joinRoom({ type: 'home' })}>
          <b>My room</b>
          <span>Yours to decorate. Friends can visit with your code.</span>
        </button>
      </div>

      <h3>With friends</h3>
      <div class="row">
        <button class="btn alt" disabled={busy} onClick={() => joinRoom({ type: 'create', kind: 'cafe' })}>
          New private cafe
        </button>
        <button class="btn alt" disabled={busy} onClick={() => joinRoom({ type: 'create', kind: 'library' })}>
          New private library
        </button>
      </div>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length >= 4) joinRoom({ type: 'code', code: code.trim().toUpperCase() });
        }}
      >
        <input
          value={code}
          maxLength={8}
          placeholder="Invite code"
          aria-label="Invite code"
          autocomplete="off"
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
        />
        <button class="btn" type="submit" disabled={busy || code.trim().length < 4}>
          Join
        </button>
      </form>
      {here?.code && here.access === 'private' && (
        <p class="note">
          This private room's code is <b>{here.code}</b>.
        </p>
      )}
      {me && (
        <p class="note">
          Your own room's code is <b>{me.homeCode}</b>. Share it so friends can drop by.
        </p>
      )}
    </Modal>
  );
}

// ---------- Shop ----------

const TABS: { kind: ItemKind; label: string }[] = [
  { kind: 'furniture', label: 'Furniture' },
  { kind: 'top', label: 'Tops' },
  { kind: 'hair', label: 'Hair' },
  { kind: 'hairColor', label: 'Hair colour' },
  { kind: 'hat', label: 'Hats' },
];

export function Shop() {
  const [tab, setTab] = useState<ItemKind>('furniture');
  const me = self.value;
  if (!me) return null;
  const items = ITEMS.filter((i) => i.kind === tab && i.price > 0);

  const buy = (item: Item) => {
    unlock();
    send({ t: 'buy', item: item.id });
    play('coin');
  };

  return (
    <Modal title="Shop" wide>
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button role="tab" aria-selected={t.kind === tab} class={`tab${t.kind === tab ? ' on' : ''}`} onClick={() => setTab(t.kind)}>
            {t.label}
          </button>
        ))}
        <span class="purse">
          <img class="px" src={coinUrl()} alt="coins" /> {me.coins}
        </span>
      </div>
      <div class="goods">
        {items.map((item) => {
          const have = me.inventory[item.id] ?? 0;
          const isFurniture = item.kind === 'furniture';
          const maxed = isFurniture ? have >= MAX_FURNITURE_EACH : have > 0;
          return (
            <div class="good">
              <img class={`px ${isFurniture ? 'furn' : 'wear'}`} src={itemUrl(item, me.outfit)} alt="" />
              <b>{item.name}</b>
              {isFurniture && have > 0 && <span class="note">Owned x{have}</span>}
              {maxed ? (
                <span class="owned">{isFurniture ? 'Max owned' : 'Owned'}</span>
              ) : (
                <button class="btn small" disabled={me.coins < item.price} onClick={() => buy(item)}>
                  <img class="px" src={coinUrl()} alt="coins" /> {item.price}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p class="note">Clothes go to your wardrobe. Furniture is placed from Decorate, in your own room.</p>
    </Modal>
  );
}

// ---------- Wardrobe ----------

const SLOTS: { kind: ItemKind; key: keyof Outfit; label: string }[] = [
  { kind: 'hair', key: 'hair', label: 'Hair' },
  { kind: 'hairColor', key: 'hairColor', label: 'Hair colour' },
  { kind: 'top', key: 'top', label: 'Top' },
  { kind: 'hat', key: 'hat', label: 'Hat' },
];

export function Wardrobe() {
  const me = self.value;
  if (!me) return null;
  const wear = (patch: Partial<Outfit>) => send({ t: 'outfit', outfit: { ...me.outfit, ...patch } });

  return (
    <Modal title="Wardrobe" wide>
      <div class="wardrobe">
        <img class="px mirror" src={avatarUrl(me.outfit)} alt="Your avatar" />
        <div class="slots">
          <h3>Skin</h3>
          <div class="options">
            {SKIN.map((c, i) => (
              <button
                class={`swatch${me.outfit.skin === i ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={`Skin tone ${i + 1}`}
                onClick={() => wear({ skin: i })}
              />
            ))}
          </div>
          {SLOTS.map((slot) => (
            <div>
              <h3>{slot.label}</h3>
              <div class="options">
                {ITEMS.filter((i) => i.kind === slot.kind && owns(me.inventory, i.id)).map((item) =>
                  item.color && slot.kind === 'hairColor' ? (
                    <button
                      class={`swatch${me.outfit[slot.key] === item.id ? ' on' : ''}`}
                      style={{ background: item.color }}
                      title={item.name}
                      aria-label={item.name}
                      onClick={() => wear({ [slot.key]: item.id })}
                    />
                  ) : (
                    <button class={`chip${me.outfit[slot.key] === item.id ? ' on' : ''}`} onClick={() => wear({ [slot.key]: item.id })}>
                      {item.name}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p class="note">More styles are in the shop.</p>
    </Modal>
  );
}

// ---------- Stats ----------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function hoursText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function StatsPanel() {
  useEffect(() => {
    stats.value = null;
    send({ t: 'stats' });
  }, []);
  const s = stats.value;

  return (
    <Modal title="Your focus">
      {!s ? (
        <p class="note">Loading...</p>
      ) : (
        <>
          <div class="figures">
            <div>
              <b>{hoursText(s.todayMinutes)}</b>
              <span>today</span>
            </div>
            <div>
              <b>{s.streak}</b>
              <span>day streak</span>
            </div>
            <div>
              <b>{hoursText(s.totalMinutes)}</b>
              <span>all time</span>
            </div>
            <div>
              <b>{s.sessions}</b>
              <span>sessions</span>
            </div>
          </div>
          <h3>Last 7 days</h3>
          <div class="bars">
            {(() => {
              const max = Math.max(60, ...s.week.map((d) => d.minutes));
              return s.week.map((d) => (
                <div class="bar-col" title={`${d.day}: ${hoursText(d.minutes)}`}>
                  <span class="bar-val">{d.minutes || ''}</span>
                  <div class="bar" style={{ height: `${Math.round((d.minutes / max) * 100)}%` }} />
                  <span class="bar-day">{DAY_NAMES[new Date(d.day + 'T00:00:00Z').getUTCDay()]}</span>
                </div>
              ));
            })()}
          </div>
          <h3>Recent sessions</h3>
          {s.recent.length === 0 ? (
            <p class="note">Nothing yet. Sit down and start your first one.</p>
          ) : (
            <ul class="recent">
              {s.recent.map((r) => (
                <li>
                  <span>{new Date(r.endedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span class="grow">{r.label || 'Focus'}</span>
                  <span>{r.minutes} min</span>
                  <span class="coins">+{r.coins}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------- Settings ----------

export function SettingsPanel() {
  const me = self.value;
  const [name, setName] = useState(me?.name ?? '');
  const s = settings.value;

  const setNotify = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') {
        showToast('Notifications are blocked in this browser');
        return updateSettings({ notify: false });
      }
    }
    updateSettings({ notify: on });
  };

  return (
    <Modal title="Settings">
      <div class="field">
        <label>Account</label>
        <div class="row">
          <span class="grow">
            {account.value ? `Signed in as ${account.value}${syncStatus.value === 'saving' ? ' (saving...)' : ''}` : 'Guest. Progress is saved on this device only.'}
          </span>
          <button class="btn alt" type="button" onClick={() => (panel.value = 'account')}>
            {account.value ? 'Manage' : 'Create or sign in'}
          </button>
        </div>
      </div>

      <form
        class="field"
        onSubmit={(e) => {
          e.preventDefault();
          send({ t: 'rename', name });
        }}
      >
        <label for="set-name">Display name</label>
        <div class="row">
          <input id="set-name" value={name} maxLength={12} autocomplete="off" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button class="btn" type="submit" disabled={name.trim().length < 2 || name.trim() === me?.name}>
            Save
          </button>
        </div>
      </form>

      <div class="field">
        <label for="set-volume">Volume</label>
        <input
          id="set-volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={s.volume}
          onInput={(e) => {
            unlock();
            updateSettings({ volume: Number((e.target as HTMLInputElement).value) });
            applySound();
          }}
        />
      </div>

      <div class="field">
        <label for="set-ambience">Background sound</label>
        <select
          id="set-ambience"
          value={s.ambience}
          onChange={(e) => {
            unlock();
            updateSettings({ ambience: (e.target as HTMLSelectElement).value as typeof s.ambience });
            applySound();
          }}
        >
          <option value="rain">Rain</option>
          <option value="room">Room hum</option>
          <option value="off">Off</option>
        </select>
      </div>

      <label class="check">
        <input type="checkbox" checked={s.notify} onChange={(e) => void setNotify((e.target as HTMLInputElement).checked)} />
        Notify me when a session or break ends
      </label>
      <p class="note">Sound starts after your first click, because browsers require it.</p>
    </Modal>
  );
}
