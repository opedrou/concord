'use client';

import * as React from 'react';
import { Track } from 'livekit-client';
import {
  ChatIcon,
  ChatToggle,
  DisconnectButton,
  LeaveIcon,
  MediaDeviceMenu,
  StartAudio,
  TrackToggle,
  useMaybeLayoutContext,
} from '@livekit/components-react';
import { ChevronDownIcon, ChevronRightIcon } from '@/lib/icons';
import { JoinLeaveSounds } from '@/lib/JoinLeaveSounds';
import { NoiseSuppressionControl } from '@/lib/NoiseSuppressionControl';
import { ScreenShareQualityControl } from '@/lib/ScreenShareQualityControl';
import styles from '../styles/CallControlBar.module.css';

const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

/**
 * Barra de controle propria, no lugar do `<ControlBar>` padrao.
 *
 * `ControlBarProps` do @livekit/components-react nao tem slot pra injetar um
 * botao extra — foi exatamente isso que empurrou qualidade de transmissao,
 * redução de ruído e volume por participante pra virarem botões flutuantes
 * soltos (a reclamação original). Compondo a barra a mão com as mesmas peças
 * públicas que o `<ControlBar>` usa por baixo (`TrackToggle`,
 * `MediaDeviceMenu`, `ChatToggle`, `DisconnectButton`), a qualidade da
 * transmissão vira um chevron que abre DENTRO do grupo do botão de tela — não
 * mais um painel permanente.
 */
export function CallControlBar(props: {
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
}) {
  const layoutContext = useMaybeLayoutContext();
  const [qualityOpen, setQualityOpen] = React.useState(false);

  return (
    <div className={`lk-control-bar ${styles.bar}`}>
      <div className="lk-button-group">
        <TrackToggle
          source={Track.Source.Microphone}
          onDeviceError={(e) => props.onDeviceError?.({ source: Track.Source.Microphone, error: e })}
        />
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="audioinput" />
        </div>
      </div>

      <NoiseSuppressionControl />

      <div className="lk-button-group">
        <TrackToggle
          source={Track.Source.Camera}
          onDeviceError={(e) => props.onDeviceError?.({ source: Track.Source.Camera, error: e })}
        />
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="videoinput" />
        </div>
      </div>

      {/* Compartilhar tela + qualidade escondida atrás do chevron — só
          aparece com um clique, nunca mais um painel permanente. */}
      <div className={`lk-button-group ${styles.screenShareGroup}`}>
        <TrackToggle
          source={Track.Source.ScreenShare}
          onDeviceError={(e) => props.onDeviceError?.({ source: Track.Source.ScreenShare, error: e })}
        />
        <div className="lk-button-group-menu">
          <button
            type="button"
            className="lk-button"
            onClick={() => setQualityOpen((v) => !v)}
            aria-expanded={qualityOpen}
            aria-label="Qualidade da transmissão"
            title="Qualidade da transmissão"
          >
            {qualityOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
          </button>
        </div>
        {qualityOpen && (
          <>
            <div className={styles.popoverBackdrop} onClick={() => setQualityOpen(false)} />
            <div className={styles.qualityPopover}>
              <ScreenShareQualityControl />
            </div>
          </>
        )}
      </div>

      {/* Antes era outro botao flutuante solto (mesma familia visual do
          "Participantes" antigo) — agora e so mais um item da fileira. */}
      <JoinLeaveSounds />

      <ChatToggle>
        <ChatIcon />
      </ChatToggle>

      {SHOW_SETTINGS_MENU && (
        <button
          type="button"
          className="lk-button"
          onClick={() => layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' })}
          aria-label="Configurações"
        >
          Configurações
        </button>
      )}

      <DisconnectButton>
        <LeaveIcon />
      </DisconnectButton>

      <StartAudio label="Ativar áudio" />
    </div>
  );
}
