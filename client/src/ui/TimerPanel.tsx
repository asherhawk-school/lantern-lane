import { useState } from 'preact/hooks';
import { MAX_FOCUS, MIN_FOCUS } from '../../../shared/src/constants.ts';
import { play, unlock } from '../audio/sound.ts';
import { send } from '../net/client.ts';
import { focusLabel, formatClock, meView, remainingMs, result, serverNow, settings, updateSettings } from '../state.ts';
import { coinUrl } from './icons.ts';

const PRESETS = [15, 25, 50, 90];

function Setup() {
  const [minutes, setMinutes] = useState(settings.value.minutes);
  const [label, setLabel] = useState('');
  const valid = Number.isInteger(minutes) && minutes >= MIN_FOCUS && minutes <= MAX_FOCUS;

  const start = () => {
    if (!valid) return;
    unlock();
    if (settings.value.notify && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    focusLabel.value = label.trim();
    send({ t: 'focus_start', minutes, label: label.trim() || undefined });
    updateSettings({ minutes });
    play('click');
  };

  return (
    <form
      class="box card"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <h3>Ready to focus?</h3>
      <div class="chips">
        {PRESETS.map((m) => (
          <button type="button" class={`chip${m === minutes ? ' on' : ''}`} onClick={() => setMinutes(m)}>
            {m}
          </button>
        ))}
        <input
          class="mins"
          type="number"
          min={MIN_FOCUS}
          max={MAX_FOCUS}
          value={minutes}
          aria-label="Minutes"
          onInput={(e) => setMinutes(Math.round(Number((e.target as HTMLInputElement).value)))}
        />
        <span class="unit">min</span>
      </div>
      <input
        value={label}
        maxLength={60}
        placeholder="What are you working on? (only you see this)"
        aria-label="Task"
        onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
      />
      <button class="btn" type="submit" disabled={!valid}>
        Start {valid ? minutes : ''} min
      </button>
      <p class="note">
        Finish to earn {valid ? minutes : 0} coins.{' '}
        <button type="button" class="link" onClick={() => send({ t: 'stand' })}>
          Stand up
        </button>
      </p>
    </form>
  );
}

function Focusing() {
  const [confirm, setConfirm] = useState(false);
  const f = meView.value.focus!;
  const at = serverNow.value;
  const done = Math.min(1, Math.max(0, (at - f.startedAt) / Math.max(1, f.endsAt - f.startedAt)));
  return (
    <div class="box card focus">
      <h3>{focusLabel.value || 'Focusing'}</h3>
      <div class="clock" role="timer">
        {formatClock(remainingMs(f.endsAt, at))}
      </div>
      <div class="meter" aria-hidden="true">
        <div style={{ width: `${Math.round(done * 100)}%` }} />
      </div>
      {confirm ? (
        <div class="row">
          <button
            class="btn danger"
            onClick={() => {
              send({ t: 'focus_cancel' });
              setConfirm(false);
            }}
          >
            Give up, no coins
          </button>
          <button class="btn alt" onClick={() => setConfirm(false)}>
            Keep going
          </button>
        </div>
      ) : (
        <button class="link" onClick={() => setConfirm(true)}>
          Give up
        </button>
      )}
    </div>
  );
}

function Result() {
  const r = result.value!;
  const seated = meView.value.seated;
  return (
    <div class="box card result">
      <h3>Session complete</h3>
      <div class="reward">
        <img class="px" src={coinUrl()} alt="" />+{r.coins}
      </div>
      <p>
        {r.minutes} minutes{r.label ? ` on "${r.label}"` : ''}.
        {r.bonus > 0 && ` Includes a ${r.bonus} coin bonus for day ${r.streak} of your streak.`}
      </p>
      <div class="row">
        {seated && (
          <button
            class="btn"
            onClick={() => {
              result.value = null;
              send({ t: 'break_start', minutes: 5 });
            }}
          >
            5 min break
          </button>
        )}
        <button class="btn alt" onClick={() => (result.value = null)}>
          {seated ? 'Go again' : 'Nice'}
        </button>
      </div>
    </div>
  );
}

function Break() {
  const at = serverNow.value;
  return (
    <div class="box card">
      <h3>On a break</h3>
      <div class="clock" role="timer">
        {formatClock(remainingMs(meView.value.breakEndsAt!, at))}
      </div>
      <button class="btn alt" onClick={() => send({ t: 'break_cancel' })}>
        Skip break
      </button>
    </div>
  );
}

export function TimerPanel() {
  const v = meView.value;
  if (result.value) return <Result />;
  if (v.focus) return <Focusing />;
  if (v.breakEndsAt !== null) return <Break />;
  if (v.seated) return <Setup />;
  return (
    <div class="box card hint">
      <h3>Find a seat</h3>
      <p>Click a free chair to sit down, then start a focus timer. Click the door to change rooms.</p>
    </div>
  );
}
