'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { AlertTriangleIcon, MicOffIcon, Volume2Icon, VideoIcon } from '@/lib/icons';
import { CallStage } from '@/lib/CallStage';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { encodingFor, loadQualityPref } from '@/lib/screenShareQuality';
import { buildAudioCaptureConstraints } from '@/lib/noiseSuppression';
import { levelToDenoiseModel, loadNoiseLevelPref } from '@/lib/denoise';
import { MicProcessorBinder } from '@/lib/MicProcessorBinder';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { ConnectionDetails } from '@/lib/types';
import preJoinStyles from '@/styles/PreJoinUsername.module.css';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
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

// ---------------------------------------------------------------------------
// Bug 1 — erro em cascata ao entrar sem camera/microfone
// ---------------------------------------------------------------------------
//
// `setCameraEnabled(true)`/`setMicrophoneEnabled(true)` chamam getUserMedia
// por baixo. Numa maquina sem webcam (ou sem mic), o navegador rejeita com
// `NotFoundError` -- e o LocalParticipant, ALEM de rejeitar a promise (que o
// `.catch()` pega), TAMBEM reemite o mesmo erro via
// `ParticipantEvent.MediaDevicesError` (ver
// node_modules/livekit-client/dist/livekit-client.esm.mjs, metodo
// `setTrackEnabled`), que sobe pra `RoomEvent.MediaDevicesError`. Ou seja,
// UMA falha vira DOIS callbacks disparados pro mesmo erro. Com os dois lados
// chamando um `handleError` generico e sem deduplicacao, cada falha virava
// pelo menos 2 toasts identicos -- e se a pessoa entra numa call que fica
// tentando reconectar/republicar o dispositivo, viram N. Esse era o "erro em
// cascata" relatado.
//
// A correcao tem duas pernas:
// 1. Nao tentar habilitar o que nao existe -- `detectAvailableInputs` checa
//    antes de chamar getUserMedia, e falta de camera/mic vira UM aviso
//    informativo (nunca bloqueia a entrada na call), nao uma tentativa
//    fadada ao NotFoundError.
// 2. Pra erros que ainda assim acontecem (permissao negada, dispositivo
//    removido em runtime, etc.), `handleMediaDeviceError` deduplica por
//    `id` do toast (kind + nome do erro) -- os dois callbacks (`.catch()` e
//    o listener de `RoomEvent.MediaDevicesError`) acabam colidindo no MESMO
//    id e o `react-hot-toast` so atualiza/reinicia o mesmo toast em vez de
//    empilhar um novo.

/** Traduz o `MediaDeviceKind` do browser pro nome em portugues usado nas
 * mensagens de erro. */
function labelForDeviceKind(kind?: MediaDeviceKind): string {
  switch (kind) {
    case 'videoinput':
      return 'câmera';
    case 'audioinput':
      return 'microfone';
    case 'audiooutput':
      return 'saída de áudio';
    default:
      return 'dispositivo';
  }
}

/** Mapeia a fonte de uma track (vinda da ControlBar) pro tipo de dispositivo
 * equivalente. Tela compartilhada nao e um "dispositivo" com esse sentido —
 * retorna `undefined` de proposito. */
function sourceToDeviceKind(source: Track.Source): MediaDeviceKind | undefined {
  switch (source) {
    case Track.Source.Camera:
      return 'videoinput';
    case Track.Source.Microphone:
      return 'audioinput';
    default:
      return undefined;
  }
}

/** Mensagem clara e especifica por tipo de erro — nunca o "erro inesperado"
 * generico pra essa familia de falha, que e comum e tem causa conhecida. */
function deviceErrorMessage(kind: MediaDeviceKind | undefined, error: Error): string {
  const label = labelForDeviceKind(kind);
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return `Nenhum(a) ${label} encontrado(a) neste dispositivo.`;
  }
  if (
    error.name === 'NotAllowedError' ||
    error.name === 'PermissionDeniedError' ||
    error.name === 'SecurityError'
  ) {
    return `Permissão de ${label} negada pelo navegador. Libere o acesso nas configurações do site se quiser usar ${
      kind === 'videoinput' ? 'a câmera' : kind === 'audioinput' ? 'o microfone' : 'o dispositivo'
    }.`;
  }
  return `Erro ao acessar ${label}: ${error.message}`;
}

/** Enumera dispositivos de entrada disponiveis ANTES de tentar habilitar —
 * evita chamar getUserMedia pra algo que sabidamente nao existe.
 * `enumerateDevices()` nao exige permissao pra CONTAR quantos dispositivos de
 * cada `kind` existem (so os `label`s ficam vazios sem permissao previa),
 * entao da pra decidir sem pedir nada ainda. */
async function detectAvailableInputs(): Promise<{ hasCamera: boolean; hasMic: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    // Sem a API (browser antigo/contexto inseguro): assume que pode ter
    // dispositivo e deixa o proprio getUserMedia decidir — comportamento
    // antigo, so como ultimo recurso.
    return { hasCamera: true, hasMic: true };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      hasCamera: devices.some((d) => d.kind === 'videoinput'),
      hasMic: devices.some((d) => d.kind === 'audioinput'),
    };
  } catch {
    // enumerateDevices() quase nunca falha, mas se falhar nao trava a
    // entrada na call por causa disso.
    return { hasCamera: true, hasMic: true };
  }
}

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
    // Nivel de reducao de ruido salvo, so pro estado INICIAL da captura. A
    // partir daqui quem manda e o <MicProcessorBinder />.
    const initialNoiseLevel = loadNoiseLevelPref();
    const initialDenoiseModel = levelToDenoiseModel(initialNoiseLevel);
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
        // noiseSuppression/echoCancellation/autoGainControl/voiceIsolation —
        // antes so o deviceId ia pro getUserMedia, ou seja nada disso estava
        // ligado explicitamente (o navegador aplica os proprios defaults, que
        // variam). A preferencia e lida 1x aqui pro estado inicial da track;
        // o <MicProcessorBinder /> reaplica em runtime via applyConstraints
        // quando a pessoa muda o nivel no painel, sem precisar reconectar.
        // Ver lib/noiseSuppression.ts pro racional das camadas nativas e
        // lib/denoise.ts pra camada neural.
        ...buildAudioCaptureConstraints(initialNoiseLevel !== 'off', initialDenoiseModel !== 'off'),
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
              toast.error(
                `Você está tentando entrar numa reunião criptografada, mas seu navegador não suporta isso. Atualize para a versão mais recente e tente de novo.`,
                { duration: 10000, position: 'top-center' },
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

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    toast.error(`Erro inesperado, veja o console para detalhes: ${error.message}`, {
      duration: 8000,
      position: 'top-center',
    });
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    toast.error(`Erro de criptografia inesperado, veja o console para detalhes: ${error.message}`, {
      duration: 8000,
      position: 'top-center',
    });
  }, []);
  // Erro especifico de dispositivo (camera/mic/saida de audio) — mensagem
  // clara por tipo de erro (ver `deviceErrorMessage`) e DEDUPLICADA por
  // `id`: tanto o `.catch()` do `setCameraEnabled`/`setMicrophoneEnabled`
  // quanto o listener de `RoomEvent.MediaDevicesError` abaixo disparam pro
  // MESMO erro (ver nota no topo do arquivo) — sem o `id` estavel, viravam 2+
  // toasts identicos por falha, e de novo a cada retry. Com o `id`, o
  // `react-hot-toast` so atualiza o toast existente.
  const handleMediaDeviceError = React.useCallback((error: Error, kind?: MediaDeviceKind) => {
    console.error(error);
    toast.error(deviceErrorMessage(kind, error), {
      id: `device-error-${kind ?? 'unknown'}-${error.name}`,
      duration: 6000,
      position: 'top-center',
    });
  }, []);
  // A CallControlBar reporta erro de dispositivo por fonte (mic/camera/tela).
  const handleDeviceError = React.useCallback(
    (deviceError: { source: Track.Source; error: Error }) => {
      if (
        deviceError.source === Track.Source.ScreenShare &&
        deviceError.error.name === 'NotAllowedError'
      ) {
        // Cancelar a caixinha de selecao de tela do navegador dispara isso —
        // nao e um erro, e a pessoa desistindo do compartilhamento. Nenhum
        // toast pra isso.
        return;
      }
      handleMediaDeviceError(deviceError.error, sourceToDeviceKind(deviceError.source));
    },
    [handleMediaDeviceError],
  );

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleMediaDeviceError);

    // So usado dentro do ramo `e2eeSetupComplete` abaixo, mas declarado aqui
    // fora pra um UNICO cleanup no fim do efeito conseguir enxergar (em vez
    // de duplicar o `room.off(...)` em dois `return` diferentes).
    let cancelled = false;

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

      // Nao tenta habilitar o que sabidamente nao existe (ver nota no topo
      // do arquivo) — so decide isso depois de disparar o connect() acima,
      // pra nao atrasar a entrada na sala esperando a enumeracao.
      detectAvailableInputs().then(({ hasCamera, hasMic }) => {
        if (cancelled) return;
        if (props.userChoices.videoEnabled) {
          if (hasCamera) {
            room.localParticipant.setCameraEnabled(true).catch((error) => {
              handleMediaDeviceError(error, 'videoinput');
            });
          } else {
            // Falta de webcam nao e erro fatal — entra na call so sem video.
            toast('Nenhuma câmera encontrada. Você vai entrar sem vídeo.', {
              id: 'no-camera-on-join',
              duration: 6000,
              icon: <VideoIcon size={18} />,
              position: 'top-center',
              className: 'lk-button',
            });
          }
        }
        if (props.userChoices.audioEnabled) {
          if (hasMic) {
            room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
              handleMediaDeviceError(error, 'audioinput');
            });
          } else {
            // Falta de microfone e mais serio (ninguem ouve a pessoa), mas
            // ainda assim nao bloqueia — ela entra so ouvindo.
            toast.error('Nenhum microfone encontrado. Você vai entrar só ouvindo, sem poder falar.', {
              id: 'no-mic-on-join',
              duration: 8000,
              icon: <MicOffIcon size={18} />,
              position: 'top-center',
            });
          }
        }
      });
    }

    return () => {
      cancelled = true;
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleMediaDeviceError);
    };
  }, [
    e2eeSetupComplete,
    room,
    props.connectionDetails,
    props.userChoices,
    handleError,
    handleMediaDeviceError,
    handleOnLeave,
    handleEncryptionError,
    connectOptions,
  ]);

  // ---------------------------------------------------------------------
  // Bug 2 — pessoa duplicada na lista do canal (ver HANDOFF secao 9)
  // ---------------------------------------------------------------------
  //
  // `PageClientImpl` nunca chamava `room.disconnect()` no unmount. Quando a
  // pessoa saia da rota `/rooms/[roomName]` sem passar pelo botao de
  // desconectar (ex: navegando pra `/channels/[slug]` — pagina DIFERENTE,
  // fora do `RoomShell`, que so mantem o `<Room>` vivo pra abertura do chat
  // de texto EM CIMA da mesma sala, ver RoomShell.tsx), a conexao WebRTC
  // antiga ficava pendurada no SFU ate expirar por timeout. Ao voltar pra
  // call, um `<Room>` NOVO conectava com um sufixo de identity NOVO (o
  // `__XXXX` aleatorio e de proposito, ver ChannelSidebar.tsx) — e a pessoa
  // aparecia duas vezes na lista de ocupantes ate a sessao fantasma expirar.
  //
  // A correcao e este efeito, em SEPARADO do efeito de connect logo acima,
  // com `[room]` como UNICA dependencia — de proposito, por dois motivos:
  //
  // 1. O efeito de connect acima tem `e2eeSetupComplete` nas deps, que muda
  //    de false pra true UMA vez logo apos o mount (setup de E2EE). Se o
  //    disconnect() estivesse no cleanup DAQUELE efeito, essa transicao
  //    dispararia um disconnect() bem no meio da entrada na sala — inofensivo
  //    na pratica (o Room ainda nem tinha conectado), mas e o tipo de
  //    acoplamento fragil que e melhor nao ter. Isolado aqui, o cleanup SO
  //    roda quando o proprio componente desmonta (ou `room` mudar de
  //    identidade — o que nunca acontece, ver abaixo).
  // 2. `room` vem de `React.useMemo(() => new Room(roomOptions), [])` com
  //    deps VAZIAS, DE PROPOSITO (ver mais acima) — nao e recriado a cada
  //    render nem quando as opcoes mudam. Esse efeito nao interfere nisso:
  //    ele so OBSERVA o `room` que ja existe, nunca o recria. `[room]` como
  //    dep so existe pra satisfazer o lint (a referencia e estavel por todo
  //    o ciclo de vida do componente) — na pratica esse efeito monta e
  //    desmonta exatamente 1x por sessao (2x em StrictMode, ver abaixo).
  //
  // StrictMode do React (dev only): monta, roda os efeitos, desmonta
  // (chamando os cleanups) e remonta de proposito, pra pegar cleanup mal
  // feito. Isso significa que em dev este cleanup roda logo apos o primeiro
  // "mount" falso, ANTES do `room.connect()` do outro efeito terminar. Isso
  // e seguro: o `Room.disconnect()` da livekit-client detecta uma conexao em
  // andamento e a cancela de forma graciosa ("Abort connection attempt due
  // to user initiated disconnect", ver
  // node_modules/livekit-client/dist/livekit-client.esm.mjs) em vez de
  // lançar. O remonte seguinte chama `room.connect()` de novo no MESMO
  // objeto `Room` (o useMemo garante isso) — o pior caso em dev e uma
  // reconexao a mais, nunca perda de estado ou queda real da chamada. Em
  // producao (sem StrictMode) isso roda 1x, exatamente quando deveria.
  React.useEffect(() => {
    return () => {
      room.disconnect().catch((error) => {
        // Nunca deveria falhar (ver nota do Room.disconnect() acima), mas
        // nao deixamos uma rejeicao sem tratamento escapando do cleanup.
        console.error('Erro ao desconectar da sala no unmount:', error);
      });
    };
  }, [room]);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        {/* Sem UI: e o dono do processamento do microfone (reducao de ruido +
            gate). Precisa estar AQUI DENTRO pra ter acesso aos hooks do
            LiveKit, e precisa estar sempre montado pra o processamento nao
            depender do painel de configuracoes estar aberto. Ver
            lib/MicProcessorContext.tsx. */}
        <MicProcessorBinder />
        <CallStage chatMessageFormatter={formatChatMessageLinks} onDeviceError={handleDeviceError} />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
