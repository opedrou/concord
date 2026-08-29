'use client';

import * as React from 'react';
import { Track } from 'livekit-client';
import {
  DisconnectButton,
  LeaveIcon,
  MediaDeviceMenu,
  StartAudio,
  TrackToggle,
  useMaybeLayoutContext,
  usePersistentUserChoices,
} from '@livekit/components-react';
import { ChevronDownIcon, ChevronRightIcon } from '@/lib/icons';
import { Soundboard } from '@/lib/Soundboard';
import { CallPeoplePanel } from '@/lib/CallPeoplePanel';
import { ScreenShareQualityControl } from '@/lib/ScreenShareQualityControl';
import { DEFAULT_USER_CHOICES } from '@/lib/userChoices';
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

  // Sem tela de prejoin (ROADMAP item 4), esta barra virou o UNICO lugar onde
  // se escolhe microfone e camera — e o que for escolhido aqui precisa valer
  // na proxima entrada, senao toda call comecaria no dispositivo errado. O
  // hook guarda tudo na chave `lk-user-choices` do localStorage, a mesma que o
  // PageClientImpl le pra montar o Room. Ver lib/userChoices.ts.
  const {
    saveAudioInputEnabled,
    saveVideoInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputDeviceId,
  } = usePersistentUserChoices({ defaults: DEFAULT_USER_CHOICES });

  return (
    <div className={`lk-control-bar ${styles.bar}`}>
      {/* Tudo dentro de uma pilula so — ver CallControlBar.module.css. */}
      <div className={styles.pill}>
        <div className="lk-button-group">
          <TrackToggle
            source={Track.Source.Microphone}
            // `isUserInitiated` filtra as mudancas que o proprio LiveKit faz
            // (publicar/despublicar a track na conexao, reconexao) — so a
            // decisao consciente da pessoa merece virar preferencia salva.
            onChange={(enabled, isUserInitiated) => {
              if (isUserInitiated) saveAudioInputEnabled(enabled);
            }}
            onDeviceError={(e) =>
              props.onDeviceError?.({ source: Track.Source.Microphone, error: e })
            }
          />
          <div className="lk-button-group-menu">
            <MediaDeviceMenu
              kind="audioinput"
              onActiveDeviceChange={(_kind, deviceId) => saveAudioInputDeviceId(deviceId ?? '')}
            />
          </div>
        </div>

        <div className="lk-button-group">
          <TrackToggle
            source={Track.Source.Camera}
            onChange={(enabled, isUserInitiated) => {
              if (isUserInitiated) saveVideoInputEnabled(enabled);
            }}
            onDeviceError={(e) => props.onDeviceError?.({ source: Track.Source.Camera, error: e })}
          />
          <div className="lk-button-group-menu">
            <MediaDeviceMenu
              kind="videoinput"
              onActiveDeviceChange={(_kind, deviceId) => saveVideoInputDeviceId(deviceId ?? '')}
            />
          </div>
        </div>

        {/* Compartilhar tela + qualidade escondida atrás do chevron — só
          aparece com um clique, nunca mais um painel permanente. */}
        <div className={`lk-button-group ${styles.screenShareGroup}`}>
          <TrackToggle
            source={Track.Source.ScreenShare}
            onDeviceError={(e) =>
              props.onDeviceError?.({ source: Track.Source.ScreenShare, error: e })
            }
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
        {/* Soundboard compartilhada (ver lib/soundboardEvents.tsx). */}
        <Soundboard />

        {/* "Chamar pessoas" (C2 + C3 do PLANO-2.md) — avisa quem não está na
          call agora, via webhook configurado em /admin. Ver lib/CallPeoplePanel.tsx. */}
        <CallPeoplePanel />

        {/* O botao de chat saiu daqui: virou acao do cabecalho do palco
            (ver lib/CallStage.tsx), junto do modo teatro. Esta barra ficou so
            com midia + sair, como no projeto de design. */}

        {/* As configuracoes de audio (sensibilidade de entrada + reducao de
          ruido) NAO ficam mais aqui: viraram uma secao do painel unico aberto
          pela engrenagem da ChannelSidebar (ver lib/SettingsPanel.tsx). Havia
          duas engrenagens no app, uma em cada canto, e o dono pediu uma so.
          A barra volta a ser so botoes de acao da chamada. */}

        {SHOW_SETTINGS_MENU && (
          <button
            type="button"
            className="lk-button"
            onClick={() => layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' })}
            aria-label="Dispositivos"
          >
            Dispositivos
          </button>
        )}

        <span className={styles.separator} aria-hidden="true" />

        <DisconnectButton>
          <LeaveIcon />
        </DisconnectButton>

        <StartAudio label="Ativar áudio" />
      </div>
    </div>
  );
}
