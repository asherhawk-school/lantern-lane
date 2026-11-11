import { useState } from 'preact/hooks';
import { unlock } from '../audio/sound.ts';
import { submitName } from '../net/client.ts';
import { needName } from '../state.ts';
import { AccountForm } from './Account.tsx';

export function Welcome() {
  const [name, setName] = useState('');
  const reason = needName.value?.reason;
  const [signingIn, setSigningIn] = useState(false);

  if (signingIn) {
    return (
      <div class="modal-back solid">
        <div class="box modal welcome">
          <h1>Lantern Lane</h1>
          <p>Sign in to load your coins, outfits, room and streak onto this device.</p>
          <AccountForm mode="in" />
          <button class="link" type="button" onClick={() => setSigningIn(false)}>
            Back
          </button>
        </div>
      </div>
    );
  }

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
        <p class="note">
          No sign-up needed. Already have an account?{' '}
          <button class="link" type="button" onClick={() => setSigningIn(true)}>
            Sign in
          </button>
        </p>
      </form>
    </div>
  );
}
