'use client';

// Modo foco: cala LOCALMENTE todo mundo menos quem eu escolher.
//
// Pra que serve: jogo competitivo. Não perder um clutch por causa de conversa
// paralela, sem precisar mutar ninguém de verdade nem pedir silêncio.
//
// COMO FUNCIONA (e o que ele NÃO faz)
// -----------------------------------
// É uma máscara multiplicativa aplicada pelo <VolumeMixerBinder />, nunca uma
// escrita nos volumes individuais — ver `effectiveGain` em
// participantVolumes.ts. Consequência importante: desligar o foco devolve
// exatamente os volumes de antes, sem precisar guardar nada pra restaurar.
//
// Ninguém é mutado de verdade: é só o SEU cliente que para de tocar o áudio
// daquelas pessoas. Elas continuam falando normalmente pra todo mundo, e não
// têm como saber.
//
// O foco cala só a VOZ. Áudio de tela e soundboard continuam passando — em
// jogo competitivo o áudio da transmissão costuma ser exatamente o que se quer
// continuar ouvindo, e calar tudo transformaria isso em "modo surdo".
//
// ONDE MORA: `CallControlBar`, dentro do `RoomContext` — precisa de
// `useRemoteParticipants` pra listar quem marcar. Não dá pra levar isso pra
// janela de configurações, que renderiza no ramo irmão.

import * as React from 'react';
import { useRemoteParticipants } from '@livekit/components-react';
import { useVolumeMixer } from './VolumeMixerContext';
import { HeadphonesIcon } from '@/lib/icons';
import styles from '../styles/FocusMode.module.css';

export function FocusModeControl() {
  const mixer = useVolumeMixer();
  const participants = useRemoteParticipants();
  const [open, setOpen] = React.useState(false);

  if (!mixer) {
    return null;
  }

  const { focus } = mixer;
  const names = participants.map((p) => p.name || p.identity).sort((a, b) => a.localeCompare(b));

  const toggleName = (name: string) => {
    const next = new Set(focus.allowed);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    mixer.setFocusAllowed(next);
  };

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`lk-button ${styles.button} ${focus.enabled ? styles.buttonActive : ''}`}
        aria-pressed={focus.enabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Modo foco — ouvir só quem você escolher"
        onClick={() => setOpen((v) => !v)}
      >
        <HeadphonesIcon size={18} />
      </button>

      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.popover} role="dialog" aria-label="Modo foco">
            <header className={styles.header}>
              <span className={styles.title}>Modo foco</span>
              <button
                type="button"
                className={`lk-button ${styles.toggle} ${focus.enabled ? styles.toggleOn : ''}`}
                aria-pressed={focus.enabled}
                onClick={mixer.toggleFocus}
              >
                {focus.enabled ? 'Ligado' : 'Desligado'}
              </button>
            </header>

            <p className={styles.hint}>
              Você para de ouvir a voz de quem não estiver marcado. Ninguém é mutado de verdade — é
              só no seu áudio.
            </p>

            {names.length === 0 ? (
              <p className={styles.hint}>Ninguém mais está no canal agora.</p>
            ) : (
              <ul className={styles.list}>
                {names.map((name) => (
                  <li key={name}>
                    <label className={styles.item}>
                      <input
                        type="checkbox"
                        checked={focus.allowed.has(name)}
                        onChange={() => toggleName(name)}
                      />
                      <span>{name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {focus.enabled && focus.allowed.size === 0 && (
              <p className={styles.warning}>
                Ninguém marcado — você não está ouvindo a voz de ninguém.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Faixa de aviso no topo do palco. Feia de propósito e sem opção de esconder:
 * o requisito é que ninguém esqueça que está com o foco ligado e conclua que o
 * áudio da chamada quebrou.
 */
export function FocusModeBanner() {
  const mixer = useVolumeMixer();
  if (!mixer?.focus.enabled) {
    return null;
  }

  const allowed = Array.from(mixer.focus.allowed);
  const list =
    allowed.length === 0
      ? 'ninguém'
      : allowed.length === 1
        ? allowed[0]
        : `${allowed.slice(0, -1).join(', ')} e ${allowed[allowed.length - 1]}`;

  return (
    <div className={styles.banner} role="status">
      <strong>MODO FOCO</strong>
      <span>você está ouvindo só {list}</span>
      <button type="button" className={styles.bannerButton} onClick={mixer.toggleFocus}>
        Desligar
      </button>
    </div>
  );
}
