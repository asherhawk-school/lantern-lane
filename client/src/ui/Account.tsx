import { useState } from 'preact/hooks';
import { MIN_PASSWORD } from '../host/sync.ts';
import { signIn, signOut, signUp } from '../net/client.ts';
import { account, connState, panel, self, syncStatus } from '../state.ts';
import { Modal } from './Modal.tsx';

const STATUS_TEXT = {
  off: '',
  saving: 'Saving to your account...',
  synced: 'Saved to your account.',
  offline: 'Offline. Changes will be saved when the connection is back.',
} as const;

/** Username and password form, used for both creating an account and signing in. */
export function AccountForm(props: { mode: 'up' | 'in'; onDone?: () => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = props.mode === 'up';
  const offline = connState.value !== 'online';

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = await (creating ? signUp(user, pass) : signIn(user, pass));
    setBusy(false);
    if (problem) setError(problem);
    else {
      setPass('');
      props.onDone?.();
    }
  };

  return (
    <form class="field" onSubmit={submit}>
      <label for="acct-user">Username</label>
      <input
        id="acct-user"
        value={user}
        maxLength={20}
        autocomplete="username"
        autocapitalize="off"
        spellcheck={false}
        onInput={(e) => setUser((e.target as HTMLInputElement).value)}
      />
      <label for="acct-pass">Password</label>
      <input
        id="acct-pass"
        type="password"
        value={pass}
        maxLength={100}
        autocomplete={creating ? 'new-password' : 'current-password'}
        onInput={(e) => setPass((e.target as HTMLInputElement).value)}
      />
      {error && <p class="error">{error}</p>}
      {offline && <p class="note">Waiting for a connection...</p>}
      <button class="btn" type="submit" disabled={busy || offline || user.trim().length < 3 || pass.length < (creating ? MIN_PASSWORD : 1)}>
        {busy ? 'One moment...' : creating ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}

export function AccountPanel() {
  const who = account.value;
  const [mode, setMode] = useState<'up' | 'in'>('up');
  const [leaving, setLeaving] = useState(false);

  if (who) {
    return (
      <Modal title="Account">
        <p>
          Signed in as <b>{who}</b>.
        </p>
        <p class="note">{STATUS_TEXT[syncStatus.value]}</p>
        <p class="note">Sign in with the same username and password on another device to pick up your coins, outfits, room and streak there.</p>
        {leaving ? (
          <>
            <p>Signing out removes your progress from this device. It stays in your account.</p>
            <div class="row">
              <button
                class="btn danger"
                onClick={() => {
                  setLeaving(false);
                  void signOut();
                }}
              >
                Sign out
              </button>
              <button class="btn alt" onClick={() => setLeaving(false)}>
                Stay signed in
              </button>
            </div>
          </>
        ) : (
          <button class="btn alt" onClick={() => setLeaving(true)}>
            Sign out
          </button>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Account">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'up'} class={`tab${mode === 'up' ? ' on' : ''}`} onClick={() => setMode('up')}>
          Create account
        </button>
        <button role="tab" aria-selected={mode === 'in'} class={`tab${mode === 'in' ? ' on' : ''}`} onClick={() => setMode('in')}>
          Sign in
        </button>
      </div>
      {mode === 'up' ? (
        <p class="note">
          Saves {self.value ? `${self.value.name}'s` : 'your'} progress on this device to a new account, so you can pick it up on other devices. Passwords need at
          least {MIN_PASSWORD} characters and cannot be recovered if forgotten.
        </p>
      ) : (
        <p class="note">Loads your account's progress onto this device, replacing what is here now.</p>
      )}
      <AccountForm key={mode} mode={mode} onDone={() => (panel.value = null)} />
    </Modal>
  );
}
