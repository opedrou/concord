'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { AlertTriangleIcon, Volume2Icon } from '@/lib/icons';
import { JoinLeaveSounds } from '@/lib/JoinLeaveSounds';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { NoiseSuppressionControl } from '@/lib/NoiseSuppressionControl';
import { ScreenShareQualityControl } from '@/lib/ScreenShareQualityControl';
import { encodingFor, loadQualityPref } from '@/lib/screenShareQuality';
import { buildAudioCaptureConstraints, loadNoiseSuppressionPref } from '@/lib/noiseSuppression';
import { ParticipantAudioPanel } from '@/lib/ParticipantAudioPanel';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import preJoinStyles from '@/styles/PreJoinUsername.module.css';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
} from '@livekit/components-react';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  ScreenSharePresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  Track,
  TrackPublishDefaults,
  VideoCaptureOptions,
  ScreenShareCaptureOptions,
  TrackPublishOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
  // Nome resolvido pela sessao logada (onda 2). Quando presente, o campo de
  // username do PreJoin fica preenchido e escondido — nao faz sentido pedir
  // de novo um nome que ja veio do login.
  username?: string;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: props.username ?? '',
      videoEnabled: true,
      audioEnabled: true,
    };
  }, [props.username]);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, []);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div
          className={props.username ? preJoinStyles.hideUsername : undefined}
          style={{ display: 'grid', placeItems: 'center', height: '100%' }}
        >
          <PreJoin
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{
            codec: props.codec,
            hq: props.hq,
            singlePeerConnection: props.singlePeerConnection,
          }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
    singlePeerConnection: boolean;
  };
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h720,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      // O default da livekit-client e ScreenSharePresets.h1080fps15 (1080p @ 15fps, 2.5 Mbps),
      // baixo demais pra acompanhar jogo. Forcamos 1920x1080 @ 30fps, 5 Mbps.
      screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
      // default e 'balanced'; pra jogo queremos derrubar resolucao antes de derrubar fps.
      degradationPreference: 'maintain-framerate',
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
        // noiseSuppression/echoCancellation/autoGainControl/voiceIsolation —
        // antes so o deviceId ia pro getUserMedia, ou seja nada disso estava
        // ligado explicitamente (o navegador aplica os proprios defaults, que
        // variam). A preferencia e lida 1x aqui pro estado inicial da track;
        // o <NoiseSuppressionControl /> reaplica em runtime via
        // applyConstraints quando a pessoa liga/desliga, sem precisar
        // reconectar. Ver lib/noiseSuppression.ts pro racional das camadas.
        ...buildAudioCaptureConstraints(loadNoiseSuppressionPref()),
      },
      adaptiveStream: true,
      dynacast: true,
      // Necessario pro slider de volume por participante passar de 100%.
      // Sem audioContext, RemoteAudioTrack.setVolume cai em `el.volume` do
      // <audio>, que o navegador clampa em 1.0 e o boost nao tem efeito.
      // Com webAudioMix a track usa um GainNode, cujo gain aceita > 1.
      webAudioMix: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // O ControlBar do <VideoConference> chama setScreenShareEnabled(true, undefined, ...) e
  // ControlBarProps nao expoe captureOptions. Sem `audio: true` o navegador nem exibe a
  // opcao de compartilhar o audio junto com a tela. Injetamos aqui.
  //
  // `systemAudio: 'include'` pede pro Chrome oferecer tambem a opcao de audio
  // do SISTEMA (nao so de aba) na caixinha de selecao — quando o navegador
  // suporta, aumenta a chance de aparecer alguma opcao de audio. Mas o
  // resultado final ainda depende do que o navegador/SO realmente oferecem:
  // Chrome/Linux so tem audio de ABA (janela/tela cheia nao tem), Firefox nao
  // suporta nada disso. Isso e limitacao do navegador, nao da nossa opcao —
  // ver HANDOFF secao 4.
  React.useEffect(() => {
    const lp = room.localParticipant;
    const original = lp.setScreenShareEnabled.bind(lp);
    lp.setScreenShareEnabled = (
      enabled: boolean,
      options?: ScreenShareCaptureOptions,
      publishOptions?: TrackPublishOptions,
    ) => {
      if (enabled) {
        // Aviso PROATIVO, antes da caixinha do navegador abrir — a maior
        // fonte de "o audio nao funciona" e a pessoa escolher janela/tela
        // cheia ou esquecer de marcar a caixinha de audio.
        toast(
          'Pra levar áudio junto: escolha compartilhar uma ABA (não janela nem tela inteira) e marque "Compartilhar áudio da guia/aba" na caixinha do navegador.',
          {
            id: 'screen-share-audio-hint',
            duration: 8000,
            icon: <Volume2Icon size={18} />,
            position: 'top-center',
            className: 'lk-button',
          },
        );
      }
      // Qualidade escolhida pela pessoa no dropdown. Precisa ser lida AQUI, no
      // momento do compartilhamento, e nao no `publishDefaults` do Room: o
      // Room ja foi construido e seu screenShareEncoding e imutavel. Um
      // `videoEncoding` explicito em publishOptions tem precedencia sobre ele.
      const chosenEncoding = encodingFor(loadQualityPref());
      return original(
        enabled,
        { audio: true, contentHint: 'motion', systemAudio: 'include', ...options },
        { videoEncoding: chosenEncoding, ...publishOptions },
      ).then((publication) => {
        if (enabled) {
          const hasAudio = !!lp.getTrackPublication(Track.Source.ScreenShareAudio);
          if (!hasAudio) {
            // Reativo: publicou video de tela mas SEM faixa de audio. Nao e
            // bug — quase sempre e a pessoa ter escolhido janela/tela cheia
            // (Linux), nao marcado a caixinha, ou estar no Firefox (sem
            // suporte nenhum). So avisa, sem travar o compartilhamento.
            toast(
              'Compartilhamento de tela iniciado SEM áudio. No Chrome/Linux só existe áudio de aba (janela/tela cheia não têm); Firefox não suporta áudio de tela. Alternativa pra som de jogo: escolha o dispositivo "Monitor of ..." no seletor de microfone.',
              {
                id: 'screen-share-no-audio',
                duration: 10000,
                icon: <AlertTriangleIcon size={18} />,
                position: 'top-center',
                className: 'lk-button',
              },
            );
          }
        }
        return publication;
      });
    };
  }, [room]);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
      if (props.userChoices.videoEnabled) {
        room.localParticipant.setCameraEnabled(true).catch((error) => {
          handleError(error);
        });
      }
      if (props.userChoices.audioEnabled) {
        room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
          handleError(error);
        });
      }
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected error, check the console logs for details: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />
        <ParticipantAudioPanel />
        <NoiseSuppressionControl />
        <ScreenShareQualityControl />
        <JoinLeaveSounds />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
