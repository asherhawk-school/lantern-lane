import type { ComponentChildren } from 'preact';
import { panel } from '../state.ts';

export function Modal(props: { title: string; children: ComponentChildren; onClose?: () => void; wide?: boolean }) {
  const close = props.onClose ?? (() => (panel.value = null));
  return (
    <div
      class="modal-back"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section class={`box modal${props.wide ? ' wide' : ''}`} role="dialog" aria-label={props.title}>
        <header class="modal-head">
          <h2>{props.title}</h2>
          <button class="btn alt small" onClick={close} aria-label="Close">
            X
          </button>
        </header>
        {props.children}
      </section>
    </div>
  );
}
