import { ITEMS } from '../../../shared/src/catalog.ts';
import { EMOTES, MAX_FURNITURE_EACH } from '../../../shared/src/constants.ts';
import { unlock } from '../audio/sound.ts';
import { send } from '../net/client.ts';
import { decorate, formatClock, people, placed, remainingMs, roomInfo, self, serverNow } from '../state.ts';
import { emoteUrl, itemUrl } from './icons.ts';

const EMOTE_NAMES: Record<string, string> = { wave: 'Wave', thumbs: 'Thumbs up', coffee: 'Coffee', heart: 'Heart', brb: 'Be right back' };

export function EmoteBar() {
  return (
    <div class="box card emotes">
      {EMOTES.map((kind) => (
        <button
          class="btn alt small"
          title={EMOTE_NAMES[kind]}
          aria-label={EMOTE_NAMES[kind]}
          onClick={() => {
            unlock();
            send({ t: 'emote', kind });
          }}
        >
          {kind === 'brb' ? 'BRB' : <img class="px" src={emoteUrl(kind)} alt="" />}
        </button>
      ))}
    </div>
  );
}

export function People() {
  const list = people.value;
  const at = serverNow.value;
  const focusing = list.filter((p) => p.focusEndsAt !== null).length;
  return (
    <div class="box card people">
      <h3>
        Here now <span class="count">{list.length}</span>
      </h3>
      <p class="note">{focusing} focusing</p>
      <ul>
        {list.map((p) => (
          <li class={p.me ? 'me' : ''}>
            <span class="who">
              {p.name}
              {p.me && ' (you)'}
              {p.bot && <span class="tag">bot</span>}
            </span>
            <span class="what">
              {p.away ? 'away' : p.focusEndsAt !== null ? formatClock(remainingMs(p.focusEndsAt, at)) : p.onBreak ? 'break' : 'idle'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shown in your own room while decorating: pick something you own, then click a tile. */
export function DecorateBar() {
  const d = decorate.value;
  const me = self.value;
  const room = roomInfo.value;
  if (!d.on || !me || !room || room.ownerId !== me.id) return null;

  const owned = ITEMS.filter((i) => i.kind === 'furniture' && (me.inventory[i.id] ?? 0) > 0);
  const used = (id: string) => placed.value.filter((f) => f.item === id).length;

  return (
    <div class="box card decorate">
      <h3>Decorate</h3>
      {owned.length === 0 ? (
        <p class="note">You have no furniture yet. The shop sells plants, lamps, rugs and more.</p>
      ) : (
        <p class="note">{d.item ? 'Click a tile to place it.' : d.moving !== null ? 'Click where it should go.' : 'Pick an item, or click furniture in the room to move it.'}</p>
      )}
      <div class="inv">
        {owned.map((item) => {
          const left = (me.inventory[item.id] ?? 0) - used(item.id);
          return (
            <button
              class={`slot${d.item === item.id ? ' on' : ''}`}
              disabled={left <= 0}
              title={item.name}
              onClick={() => (decorate.value = { on: true, item: d.item === item.id ? null : item.id, moving: null })}
            >
              <img class="px" src={itemUrl(item, me.outfit)} alt={item.name} />
              <span>x{left}</span>
            </button>
          );
        })}
      </div>
      <div class="row">
        {d.moving !== null && (
          <button
            class="btn alt"
            onClick={() => {
              send({ t: 'remove_item', id: d.moving! });
              decorate.value = { on: true, item: null, moving: null };
            }}
          >
            Put away
          </button>
        )}
        <button class="btn" onClick={() => (decorate.value = { on: false, item: null, moving: null })}>
          Done
        </button>
      </div>
      <p class="note">Up to {MAX_FURNITURE_EACH} of each item.</p>
    </div>
  );
}
