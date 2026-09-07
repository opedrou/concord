import { describe, it, expect } from 'vitest';
import { decodeWatchSource, encodeWatchSource, type WatchSource } from './watchSource';

describe('watchSource', () => {
  it('vai e volta', () => {
    for (const source of [
      { kind: 'youtube', id: 'XUGYAJtNv0U' },
      { kind: 'jellyfin', id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
    ] satisfies WatchSource[]) {
      expect(decodeWatchSource(encodeWatchSource(source))).toEqual(source);
    }
  });

  it('recusa o que não reconhece', () => {
    expect(decodeWatchSource('')).toBeNull();
    expect(decodeWatchSource('XUGYAJtNv0U')).toBeNull();
    expect(decodeWatchSource('vimeo:123')).toBeNull();
    expect(decodeWatchSource('yt:')).toBeNull();
  });

  it('não se perde com dois-pontos no id', () => {
    expect(decodeWatchSource('yt:a:b')).toEqual({ kind: 'youtube', id: 'a:b' });
  });
});
