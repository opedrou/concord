// Áudio de UM app do Linux publicado como faixa própria na call.
//
// Regra pura, sem React e sem LiveKit em runtime — quem monta o botão é o
// <AppAudioButton />, quem aplica volume é o <VolumeMixerBinder />. Mesma
// divisão de participantVolumes.ts, e pelo mesmo motivo: dá pra testar.
//
// A cadeia PipeWire que cria o dispositivo é montada FORA do navegador, pelo
// script `scripts/concord-audio`. A página não dispara comando nenhum: um
// daemon local ou um Electron só compraria o botão ao custo de expor execução
// de comando a uma página remota (ver AUDIO-APP-LINUX.md, seção 7).

/**
 * Nome da faixa publicada. É por ele — e não pela `Track.Source` — que o outro
 * lado reconhece o áudio de app.
 *
 * A fonte é `Track.Source.Unknown` de propósito. `ScreenShareAudio` colidiria
 * com quem também compartilha uma aba com som: ficariam duas publicações da
 * mesma fonte, e `getTrackPublication` devolve A PRIMEIRA que casa — o slider
 * mexeria na faixa errada e o `setScreenShareEnabled(false)` poderia
 * despublicar a errada. `Unknown` não colide com nada e o `RoomAudioRenderer`
 * já toca as três fontes (Microphone, ScreenShareAudio, Unknown).
 */
export const APP_AUDIO_TRACK_NAME = 'concord-app-audio';

/** `device.description` que o `module-remap-source` do script publica. */
export const APP_AUDIO_DEVICE_LABEL = 'ConcordMic';

/** O comando que a pessoa precisa rodar quando não há nenhum dispositivo. */
export const APP_AUDIO_COMMAND = 'scripts/concord-audio';

/**
 * Os dispositivos de entrada criados pelo script.
 *
 * Filtra por rótulo porque é a única coisa estável: o `deviceId` muda a cada
 * remontagem da cadeia. Rótulo vazio significa que a permissão de microfone
 * ainda não foi concedida — nesse caso não dá pra reconhecer nada, e devolver
 * lista vazia é o certo (a UI manda rodar o script, que é o passo anterior de
 * qualquer jeito).
 */
export function pickAppAudioDevices(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter(
    (device) => device.kind === 'audioinput' && device.label.includes(APP_AUDIO_DEVICE_LABEL),
  );
}

/**
 * Tipo estrutural em vez de `TrackPublication` do livekit-client: mantém este
 * módulo (e o teste) sem import de runtime da lib. Uma publicação de verdade
 * satisfaz isto.
 */
export interface PublicationLike {
  kind: string;
  trackName: string;
}

/** Só a nossa faixa — outra publicação `Unknown` qualquer não conta. */
export function isAppAudioPublication(publication: PublicationLike): boolean {
  return publication.kind === 'audio' && publication.trackName === APP_AUDIO_TRACK_NAME;
}
