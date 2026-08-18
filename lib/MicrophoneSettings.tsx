import React from 'react';
import { TrackToggle } from '@livekit/components-react';
import { MediaDeviceMenu } from '@livekit/components-react';
import { Track } from 'livekit-client';

// O botao de "Enhanced Noise Cancellation" daqui usava @livekit/krisp-noise-filter,
// que so funciona no LiveKit Cloud (ver HANDOFF secao 3) — numa instancia
// self-hosted como esta o filtro nunca carrega de verdade, e a UI ficava
// oferecendo um botao que nao faz nada. Removido daqui; a reducao de ruido
// de verdade (constraints nativas do navegador, com fallback automatico) fica
// no <NoiseSuppressionControl /> renderizado ao lado do <VideoConference>.
export function MicrophoneSettings() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: '10px',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <section className="lk-button-group">
        <TrackToggle source={Track.Source.Microphone}>Microphone</TrackToggle>
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="audioinput" />
        </div>
      </section>
    </div>
  );
}
