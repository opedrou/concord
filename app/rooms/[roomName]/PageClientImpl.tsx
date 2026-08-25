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
import {
  createAudioContextForDenoise,
  levelToDenoiseModel,
  loadNoiseLevelPref,
} from '@/lib/denoise';
import { MicProcessorBinder } from '@/lib/MicProcessorBinder';
import { DEFAULT_USER_CHOICES } from '@/lib/userChoices';
import { CallStateBinder } from '@/lib/CallStateBinder';
import { JoinLeaveSounds } from '@/lib/JoinLeaveSounds';
import { VolumeMixerBinder } from '@/lib/VolumeMixerBinder';
import { DeafenBinder } from '@/lib/DeafenBinder';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  RoomContext,
  usePersistentUserChoices,
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
  // Nome resolvido pela sessao logada (onda 2). Sem ele nao da pra pedir o
  // token — o RoomShell so monta este componente depois de resolver a sessao.
  username?: string;
}) {
  // -------------------------------------------------------------------------
  // Entrar com UM clique (ROADMAP item 4)
  // -------------------------------------------------------------------------
  //
  // Nao existe mais tela de prejoin. Clicar no canal de voz JA e a decisao de
  // entrar — pedir camera/microfone antes era uma tela a mais na interacao
  // mais repetida do app, e no Discord ela nao existe.
  //
  // O que a tela de prejoin fazia e continua precisando existir em algum
  // lugar:
  //
  // - escolher os dispositivos -> agora e dentro da call, nos <MediaDeviceMenu>
  //   da CallControlBar, que gravam a escolha no MESMO localStorage que a
  //   gente le aqui (`usePersistentUserChoices`, chave `lk-user-choices`).
  // - ligar/desligar mic e camera antes de entrar -> tambem vira estado
  //   lembrado: a CallControlBar salva, e a proxima entrada respeita. Igual
  //   Discord, que lembra que voce estava mudo.
  // - o username -> vem do login, nunca foi escolha de ninguem aqui.
  //
  // Na PRIMEIRA vez (localStorage vazio) o padrao e microfone LIGADO e camera
  // DESLIGADA: e o comportamento do Discord, e ninguem quer descobrir que
  // entrou com a camera aberta sem ter escolhido isso.
  const { userChoices: savedChoices } = usePersistentUserChoices({
    defaults: DEFAULT_USER_CHOICES,
    // So LEITURA aqui — quem grava e a CallControlBar, durante a call.
    preventSave: true,
    // No servidor nao existe localStorage e a lib loga um erro a cada render.
    // O valor de verdade e lido na hidratacao, antes de qualquer coisa
    // depender dele (a primeira pintura e sempre "Entrando no canal…").
    preventLoad: typeof window === 'undefined',
  });

  const { username } = props;
  const userChoices = React.useMemo<LocalUserChoices>(
    () => ({ ...savedChoices, username: username ?? savedChoices.username }),
    [savedChoices, username],
  );

  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );
  const [joinError, setJoinError] = React.useState<string | null>(null);
  // Incrementado pelo botao de tentar de novo; e a unica coisa que faz o
  // efeito abaixo rodar outra vez.
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!username) {
      return;
    }
    let cancelled = false;
    setJoinError(null);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    fetch(url.toString())
      .then(async (resp) => {
        if (!resp.ok) {
          // Antes esta resposta era usada sem checar `ok` — um 4xx/5xx virava
          // um objeto sem token e a falha so aparecia la na frente, como erro
          // generico de conexao.
          throw new Error(`O servidor respondeu ${resp.status}.`);
        }
        return (await resp.json()) as ConnectionDetails;
      })
      .then((details) => {
        if (!cancelled) setConnectionDetails(details);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) {
          setJoinError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.roomName, props.region, username, attempt]);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined ? (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100%',
            textAlign: 'center',
            gap: '0.75rem',
          }}
        >
          {joinError ? (
            <div style={{ display: 'grid', justifyItems: 'center', gap: '0.75rem' }}>
              <p style={{ margin: 0 }}>Não foi possível entrar no canal. {joinError}</p>
              <button type="button" className="lk-button" onClick={() => setAttempt((n) => n + 1)}>
                Tentar de novo
              </button>
            </div>
          ) : (
            <p style={{ margin: 0 }}>Entrando no canal…</p>
          )}
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={userChoices}
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

  // O AudioContext do webAudioMix (ver roomOptions logo abaixo) nasce aqui,
  // num useMemo de deps VAZIAS, pra viver exatamente o mesmo ciclo que o
  // `room` — e morrer junto com ele, no cleanup la embaixo.
  //
  // Por que fechar virou necessario: o RoomShell passa `key={roomName}` ao
  // PageClientImpl, entao trocar de canal de voz DESMONTA e remonta esta
  // arvore (antes era reload de pagina inteira, que recolhia tudo sozinho). E
  // a livekit-client so fecha o AudioContext que ELA cria — no cleanup do
  // Room ela testa `typeof options.webAudioMix === 'boolean'`, e o nosso cai
  // no ramo do objeto. Sem o close, cada troca de canal deixaria um contexto
  // aberto pra sempre, e o Chrome corta perto de 6 simultaneos (ver
  // lib/TileErrorBoundary.tsx): o sintoma seria audio que so volta no F5.
  //
  // Criar aqui e nao dentro do roomOptions tambem evita um vazamento menor: o
  // roomOptions recalcula quando as props mudam, mas so o PRIMEIRO chega a
  // virar `new Room(...)` — os contextos dos recalculos seguintes nasceriam
  // orfaos.
  const audioContext = React.useMemo(
    () => createAudioContextForDenoise() ?? new AudioContext(),
    [],
  );

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
      //
      // Passamos nosso proprio AudioContext em vez de deixar o LiveKit criar
      // um com a taxa "nativa" do SO: forcamos 48kHz aqui (ver
      // createAudioContextForDenoise em lib/denoise.ts) porque a saida de
      // audio Bluetooth no Windows costuma travar em 44.1kHz, o que deixava a
      // reducao de ruido neural (RNNoise/GTCRN) sempre indisponivel pra quem
      // usa fone Bluetooth. O navegador reamostra isso na borda sem custo
      // perceptivel.
      webAudioMix: { audioContext },
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [audioContext, props.userChoices, props.options.hq, props.options.codec]);

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
        toast('Compartilhe uma ABA pra levar áudio', {
          id: 'screen-share-audio-hint',
          duration: 1500,
          icon: <Volume2Icon size={18} />,
        });
      }
      // Qualidade escolhida pela pessoa no dropdown. Precisa ser lida AQUI, no
      // momento do compartilhamento, e nao no `publishDefaults` do Room: o
      // Room ja foi construido e seu screenShareEncoding e imutavel. Um
      // `videoEncoding` explicito em publishOptions tem precedencia sobre ele.
      const chosenEncoding = encodingFor(loadQualityPref());
      return original(
        enabled,
        {
          // restrictOwnAudio e a constraint que resolve DE VERDADE o eco de
          // "todo mundo se ouve" quando alguem compartilha audio de SISTEMA:
          // ela manda o navegador tirar, do mix capturado, o audio que esta
          // aba esta tocando — inclusive o audio remoto da RTCPeerConnection,
          // ou seja, a propria call. Chrome 141+ (set/2025); onde nao existe,
          // e ignorada silenciosamente.
          //
          // echoCancellation fica junto como paliativo pra navegadores sem
          // restrictOwnAudio, mas nao resolve esse caso: ele foi feito pra
          // realimentacao microfone↔alto-falante, nao pra separar as vozes
          // dos outros participantes de um mix de sistema. Foi o que o Jitsi
          // descobriu (jitsi-meet#16434) antes do Chrome shipar a constraint.
          audio: {
            restrictOwnAudio: true,
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
          contentHint: 'motion',
          systemAudio: 'include',
          ...options,
        },
        { videoEncoding: chosenEncoding, ...publishOptions },
      ).then((publication) => {
        if (enabled) {
          const audioPub = lp.getTrackPublication(Track.Source.ScreenShareAudio);
          const hasAudio = !!audioPub;
          if (hasAudio) {
            // Publicou audio de tela. Se restrictOwnAudio nao pegou, o mix
            // capturado ainda contem a propria call e todo mundo vai se
            // ouvir. Nao da pra corrigir depois de capturado — so avisar,
            // com a saida que sempre funciona (compartilhar uma ABA).
            const settings = audioPub.track?.mediaStreamTrack.getSettings() as
              | (MediaTrackSettings & { restrictOwnAudio?: boolean })
              | undefined;
            if (settings?.restrictOwnAudio !== true) {
              toast(
                'Atenção: seu navegador não filtrou o áudio da própria call do que está sendo compartilhado — quem está na sala pode se ouvir de volta. Pra evitar, compartilhe uma ABA (com "Compartilhar áudio da guia") em vez de tela inteira ou janela.',
                {
                  id: 'screen-share-own-audio',
                  duration: 8000,
                  icon: <AlertTriangleIcon size={18} />,
                },
              );
            }
          }
          if (!hasAudio) {
            // Reativo: publicou video de tela mas SEM faixa de audio. Nao e
            // bug — quase sempre e a pessoa ter escolhido janela/tela cheia
            // (Linux), nao marcado a caixinha, ou estar no Firefox (sem
            // suporte nenhum). So avisa, sem travar o compartilhamento.
            toast(
              'Compartilhamento de tela iniciado SEM áudio. No Chrome/Linux só existe áudio de aba (janela/tela cheia não têm); Firefox não suporta áudio de tela. Alternativa pra som de jogo: escolha o dispositivo "Monitor of ..." no seletor de microfone.',
              {
                id: 'screen-share-no-audio',
                duration: 6000,
                icon: <AlertTriangleIcon size={18} />,
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
                { duration: 6000 },
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
      duration: 6000,
    });
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    toast.error(`Erro de criptografia inesperado, veja o console para detalhes: ${error.message}`, {
      duration: 6000,
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
            toast.error(
              'Nenhum microfone encontrado. Você vai entrar só ouvindo, sem poder falar.',
              {
                id: 'no-mic-on-join',
                duration: 6000,
                icon: <MicOffIcon size={18} />,
              },
            );
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
  // Este cleanup tambem e o que sustenta a troca de canal de voz sem reload
  // da pagina: o RoomShell da uma `key={roomName}` ao PageClientImpl, entao
  // trocar de canal desmonta esta arvore (rodando o disconnect abaixo) e
  // monta outra, com um `Room` novo pro canal novo. Ver RoomShell.tsx.
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

  // Cleanup do AudioContext do webAudioMix (o porque esta no comentario de
  // onde ele e criado, mais acima). Fica num efeito separado do disconnect de
  // proposito — aquele ali esta pronto e revisado, e este so precisa rodar no
  // mesmo momento: o unmount da arvore da call, que hoje acontece a cada
  // troca de canal por causa da `key` do RoomShell.
  //
  // A guarda do `state !== 'closed'` existe porque close() num contexto ja
  // fechado lanca InvalidStateError. Ela tambem cobre o StrictMode do React,
  // que em dev desmonta e remonta de proposito reaproveitando o mesmo useMemo
  // — o remonte reencontraria este contexto fechado. Neste projeto isso nao
  // chega a acontecer: `reactStrictMode: false` no next.config.js faz o
  // `next dev` ter o mesmo ciclo de producao. Se alguem religar o StrictMode,
  // este e o ponto a revisar (o contexto precisaria ser recriado no remonte).
  React.useEffect(() => {
    return () => {
      if (audioContext.state === 'closed') {
        return;
      }
      audioContext.close().catch((error) => {
        // Mesmo estilo do cleanup vizinho: nada de rejeicao solta escapando.
        console.error('Erro ao fechar o AudioContext do webAudioMix no unmount:', error);
      });
    };
  }, [audioContext]);

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
        {/* Tambem sem UI: publica mudo/camera/tela/falando pro CallStateContext,
            que a ChannelSidebar le de fora da arvore da call. Ver
            lib/CallStateContext.tsx. */}
        <CallStateBinder />
        {/* Idem: e o unico lugar que chama participant.setVolume, combinando
            volume individual + volume geral + modo foco. Ver
            lib/VolumeMixerContext.tsx. */}
        <VolumeMixerBinder />
        {/* Idem: e quem aplica o mute do rodape da sidebar (e o mute que
            vem junto com o surdo) ao microfone. Ver lib/deafenPrefs.ts. */}
        <DeafenBinder />
        {/* Tambem sem UI: toca os sons de entrar/sair/transmitir. O liga e
            desliga fica na janela de configuracoes, secao Notificacoes. */}
        <JoinLeaveSounds />
        <CallStage
          chatMessageFormatter={formatChatMessageLinks}
          onDeviceError={handleDeviceError}
        />
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
