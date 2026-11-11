import { useState } from 'preact/hooks';
import { unlock } from '../audio/sound.ts';
import { submitName } from '../net/client.ts';
import { needName } from '../state.ts';

export function Welcome() {
  const [name, setName] = useState('');
  const reason = needName.value?.reason;

  return (
    <div class="modal-back solid">
      <form
        class="box modal welcome"
        onSubmit={(e) => {
          e.preventDefault();
          unlock();
          submitName(name);
        }}
      >
        <h1>Lantern Lane</h1>
        <p>A quiet little room for getting things done. Pull up a chair, set a timer, and focus alongside everyone else.</p>
        <label for="name">What should we call you?</label>
        <input
          id="name"
          value={name}
          maxLength={12}
          autoFocus
          autocomplete="off"
          placeholder="2-12 letters or numbers"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        {reason && <p class="error">{reason}</p>}
        <button class="btn" type="submit" disabled={name.trim().length < 2}>
          Come in
        </button>
        <p class="note">No sign-up. Your progress is saved in this browser.</p>
      </form>
    </div>
  );
}
