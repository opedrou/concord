import { describe, expect, it } from 'vitest';
import { APP_AUDIO_TRACK_NAME, isAppAudioPublication, pickAppAudioDevices } from './appAudio';

function device(partial: Partial<MediaDeviceInfo>): MediaDeviceInfo {
  return {
    deviceId: 'id',
    groupId: 'group',
    kind: 'audioinput',
    label: '',
    toJSON: () => ({}),
    ...partial,
  } as MediaDeviceInfo;
}

describe('pickAppAudioDevices', () => {
  it('acha o dispositivo do script pelo rótulo', () => {
    const found = pickAppAudioDevices([
      device({ deviceId: 'a', label: 'Microfone interno' }),
      device({ deviceId: 'b', label: 'ConcordMic' }),
    ]);
    expect(found.map((d) => d.deviceId)).toEqual(['b']);
  });

  it('ignora saída de áudio com o mesmo nome', () => {
    const found = pickAppAudioDevices([
      device({ deviceId: 'a', kind: 'audiooutput', label: 'ConcordMic' }),
    ]);
    expect(found).toEqual([]);
  });

  it('sem permissão de microfone os rótulos vêm vazios e nada casa', () => {
    const found = pickAppAudioDevices([device({ deviceId: 'a', label: '' })]);
    expect(found).toEqual([]);
  });
});

describe('isAppAudioPublication', () => {
  it('reconhece a nossa faixa', () => {
    expect(isAppAudioPublication({ kind: 'audio', trackName: APP_AUDIO_TRACK_NAME })).toBe(true);
  });

  it('não confunde com outra faixa de áudio', () => {
    expect(isAppAudioPublication({ kind: 'audio', trackName: 'microphone' })).toBe(false);
  });

  it('não confunde com vídeo de mesmo nome', () => {
    expect(isAppAudioPublication({ kind: 'video', trackName: APP_AUDIO_TRACK_NAME })).toBe(false);
  });
});
