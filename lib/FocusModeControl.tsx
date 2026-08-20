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
// ONDE SE LIGA E DESLIGA: pelo atalho de teclado (ver lib/KeyboardShortcuts.tsx)
// ou pela seção "Modo foco" da janela de configurações. Não há mais botão na
// barra de controles — ele ocupava espaço permanente pra uma ação que é de
// atalho, e o estado agora aparece no anel roxo em volta dos tiles.
//
// O estado é ANUNCIADO pra sala (lib/focusBroadcast.ts): todo mundo vê quem
// está em foco, e cada um vê se continua sendo ouvido.

import * as React from 'react';
import { useVolumeMixer } from './VolumeMixerContext';
import { useCallState } from './CallStateContext';
import styles from '../styles/FocusMode.module.css';
import settingsStyles from '../styles/SettingsWindow.module.css';

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

/**
 * Seção "Modo foco" da janela de configurações. Mexe no MESMO estado do botão
 * da barra de controles — os dois ficam em sincronia porque o dono é o
 * `VolumeMixerContext`.
 *
 * A lista de pessoas vem do `CallStateContext`, e não de
 * `useRemoteParticipants`: esta seção renderiza dentro da `ChannelSidebar`,
 * que é IRMÃ da chamada e não enxerga o `RoomContext`. Mesma solução da seção
 * Mixer (ver lib/MixerSection.tsx).
 */
export function FocusModeSettings() {
  const mixer = useVolumeMixer();
  const callState = useCallState();

  const people = React.useMemo(() => {
    if (!callState?.slug) return [];
    return Object.entries(callState.byIdentity)
      .filter(([identity]) => identity !== callState.localIdentity)
      .map(([, state]) => state.name)
      .sort((a, b) => a.localeCompare(b));
  }, [callState]);

  if (!mixer) {
    return (
      <p className={settingsStyles.hint}>O modo foco fica disponível dentro de um canal de voz.</p>
    );
  }

  const { focus } = mixer;

  const toggleName = (name: string) => {
    const next = new Set(focus.allowed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    mixer.setFocusAllowed(next);
  };

  return (
    <div className={settingsStyles.field}>
      <label className={settingsStyles.checkboxRow}>
        <input type="checkbox" checked={focus.enabled} onChange={mixer.toggleFocus} />
        <span>Ligar o modo foco</span>
      </label>
      <p className={settingsStyles.hint}>
        Você para de ouvir a voz de quem não estiver marcado abaixo. Ninguém é mutado de verdade —
        as pessoas continuam falando normalmente pra todo mundo, e não têm como saber. Áudio de tela
        e soundboard continuam passando.
      </p>

      {!callState?.slug ? (
        <p className={settingsStyles.hint}>Entre num canal de voz para escolher quem ouvir.</p>
      ) : people.length === 0 ? (
        <p className={settingsStyles.hint}>Ninguém mais está no canal agora.</p>
      ) : (
        <>
          <span className={settingsStyles.fieldLabel}>Continuo ouvindo</span>
          {people.map((name) => (
            <label key={name} className={settingsStyles.checkboxRow}>
              <input
                type="checkbox"
                checked={focus.allowed.has(name)}
                onChange={() => toggleName(name)}
              />
              <span>{name}</span>
            </label>
          ))}
        </>
      )}

      {focus.enabled && focus.allowed.size === 0 && (
        <p className={settingsStyles.warning}>
          Ninguém marcado — você não está ouvindo a voz de ninguém.
        </p>
      )}

      <p className={settingsStyles.hint}>
        O modo foco nunca é lembrado entre sessões: ele sempre nasce desligado, pra ninguém voltar
        amanhã sem ouvir o grupo por causa de um botão apertado hoje.
      </p>
    </div>
  );
}
