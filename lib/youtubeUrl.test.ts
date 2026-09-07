import { describe, it, expect } from 'vitest';
import { parseYouTubeId, parseYouTubeStartMs } from './youtubeUrl';

describe('parseYouTubeId', () => {
  it('aceita as formas que a pessoa realmente cola', () => {
    const esperado = 'XUGYAJtNv0U';
    for (const entrada of [
      'XUGYAJtNv0U',
      'https://www.youtube.com/watch?v=XUGYAJtNv0U',
      'https://youtube.com/watch?v=XUGYAJtNv0U',
      'https://m.youtube.com/watch?v=XUGYAJtNv0U',
      'https://youtu.be/XUGYAJtNv0U',
      'https://www.youtube.com/live/XUGYAJtNv0U',
      'https://www.youtube.com/embed/XUGYAJtNv0U',
      'https://www.youtube.com/shorts/XUGYAJtNv0U',
      'www.youtube.com/watch?v=XUGYAJtNv0U',
      'youtu.be/XUGYAJtNv0U',
      '  https://youtu.be/XUGYAJtNv0U  ',
    ]) {
      expect(parseYouTubeId(entrada), entrada).toBe(esperado);
    }
  });

  it('ignora os parâmetros que vêm junto no compartilhar', () => {
    expect(parseYouTubeId('https://youtu.be/XUGYAJtNv0U?si=aBcDeF&t=90')).toBe('XUGYAJtNv0U');
    expect(parseYouTubeId('https://www.youtube.com/watch?v=XUGYAJtNv0U&list=PL1&index=2')).toBe(
      'XUGYAJtNv0U',
    );
  });

  it('normaliza caminhos diferentes para o mesmo id', () => {
    // O ponto: duas pessoas colando a mesma live por caminhos diferentes
    // precisam abrir a MESMA sessão, não duas.
    expect(parseYouTubeId('https://youtu.be/XUGYAJtNv0U')).toBe(
      parseYouTubeId('https://www.youtube.com/live/XUGYAJtNv0U'),
    );
  });

  it('recusa o que não é vídeo do YouTube', () => {
    expect(parseYouTubeId('')).toBeNull();
    expect(parseYouTubeId('   ')).toBeNull();
    expect(parseYouTubeId('https://vimeo.com/123456')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/@algumcanal')).toBeNull();
    expect(parseYouTubeId('não é link nenhum')).toBeNull();
  });

  it('recusa id com tamanho errado', () => {
    expect(parseYouTubeId('curtodemais')).not.toBeNull(); // 11 chars, é válido
    expect(parseYouTubeId('curto')).toBeNull();
    expect(parseYouTubeId('estaidemuitolongo')).toBeNull();
    expect(parseYouTubeId('https://youtu.be/curto')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=curto')).toBeNull();
  });
});

describe('parseYouTubeStartMs', () => {
  it('lê segundos crus', () => {
    expect(parseYouTubeStartMs('https://youtu.be/XUGYAJtNv0U?t=90')).toBe(90_000);
    expect(parseYouTubeStartMs('https://www.youtube.com/watch?v=XUGYAJtNv0U&start=30')).toBe(
      30_000,
    );
  });

  it('lê o formato com letras', () => {
    expect(parseYouTubeStartMs('https://youtu.be/XUGYAJtNv0U?t=90s')).toBe(90_000);
    expect(parseYouTubeStartMs('https://youtu.be/XUGYAJtNv0U?t=1m30s')).toBe(90_000);
    expect(parseYouTubeStartMs('https://youtu.be/XUGYAJtNv0U?t=1h2m3s')).toBe(3_723_000);
  });

  it('devolve 0 quando não há marcação', () => {
    expect(parseYouTubeStartMs('https://youtu.be/XUGYAJtNv0U')).toBe(0);
    expect(parseYouTubeStartMs('XUGYAJtNv0U')).toBe(0);
    expect(parseYouTubeStartMs('https://youtu.be/XUGYAJtNv0U?t=abc')).toBe(0);
  });
});
