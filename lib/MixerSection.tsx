'use client';

// Seção "Mixer" da janela de configurações: volume geral da chamada e a lista
// de todo mundo que está nela, com slider e mute por pessoa.
//
// POR QUE O VOLUME GERAL É MULTIPLICAÇÃO, E NÃO A PROP `volume` DO
// <RoomAudioRenderer />
// ---------------------------------------------------------------------------
// O `RoomAudioRenderer` aceita uma prop `volume` que parece ser exatamente
// isto — e é uma armadilha. Lendo a implementação da lib, ela repassa esse
// valor para cada `<AudioTrack>`, que faz `track.setVolume(volume)` num efeito:
// ou seja, ela SOBRESCREVE todos os volumes individuais, jogando todo mundo
// pro mesmo valor. O volume geral tem que ser um fator aplicado ANTES do
// `participant.setVolume`, que é o que o <VolumeMixerBinder /> faz.
//
// DE ONDE VEM A LISTA DE PESSOAS
// ---------------------------------------------------------------------------
// Não de `useRemoteParticipants`: esse hook exige o `RoomContext`, e esta
// janela renderiza dentro da `ChannelSidebar`, que é IRMÃ da chamada. A fonte
// é o `CallStateContext` — que existe exatamente pra isso, alimentado pelo
// `<CallStateBinder />` de dentro do Room (é a mesma fonte que já desenha os
// ícones de mudo/câmera/LIVE na sidebar). Ver lib/CallStateContext.tsx.

import * as React from 'react';
import { useVolumeMixer } from './VolumeMixerContext';
import { useCallState } from './CallStateContext';
import { VolumeControl } from './ParticipantAudioPanel';
import {
  MAX_VOLUME,
  formatDb,
  gainToSlider,
  sliderToGain,
  SLIDER_STEPS,
} from './participantVolumes';
import styles from '../styles/SettingsWindow.module.css';

/** Volume geral. Funciona fora de uma chamada (é só uma preferência). */
export function MasterVolumeControl() {
  const mixer = useVolumeMixer();
  // O provider só existe no `RoomShell` — na home e nos canais de texto não há
  // mixer nenhum. Dizer isso é melhor que mostrar uma seção vazia.
  if (!mixer) {
    return <p className={styles.hint}>O mixer fica disponível dentro de um canal de voz.</p>;
  }
  const percent = Math.round(mixer.master * 100);

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="master-volume">
        <span>Volume geral da chamada</span>
        <span className={styles.fieldValue}>
          {percent}% <small>{formatDb(mixer.master)}</small>
        </span>
      </label>
      <input
        id="master-volume"
        className={styles.plainRange}
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={Math.round(gainToSlider(mixer.master))}
        onChange={(e) => mixer.setMaster(sliderToGain(Number(e.target.value)))}
        aria-label="Volume geral da chamada"
        aria-valuetext={`${percent} por cento`}
      />
      <p className={styles.hint}>
        Multiplica o volume de todo mundo, sem apagar os ajustes individuais. O teto combinado é{' '}
        {Math.round(MAX_VOLUME * 100)}%.
      </p>
    </div>
  );
}

/** Uma linha por pessoa na chamada em que EU estou. */
export function MixerParticipantList() {
  const callState = useCallState();
  const mixer = useVolumeMixer();

  // Exclui você mesmo: não existe "meu volume pra mim". O binder também só
  // aplica em participante remoto.
  const people = React.useMemo(() => {
    if (!callState?.slug) return [];
    return Object.entries(callState.byIdentity)
      .filter(([identity]) => identity !== callState.localIdentity)
      .map(([identity, state]) => ({ identity, ...state }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [callState]);

  if (!callState?.slug) {
    return <p className={styles.hint}>Entre num canal de voz para ver o mixer.</p>;
  }
  if (people.length === 0) {
    return <p className={styles.hint}>Ninguém mais está no canal agora.</p>;
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Pessoas no canal</span>
      {people.map((person) => (
        <div key={person.identity} className={styles.mixerPerson}>
          <span className={styles.mixerPersonName}>{person.name}</span>
          <VolumeControl
            name={person.name}
            sourceKey="mic"
            label="Voz"
            focusMuted={mixer?.isFocusMuted(person.name)}
          />
          {person.screenShareAudio && (
            <VolumeControl name={person.name} sourceKey="screenShareAudio" label="Áudio da tela" />
          )}
          <VolumeControl name={person.name} sourceKey="soundboard" label="Soundboard" />
        </div>
      ))}
    </div>
  );
}
