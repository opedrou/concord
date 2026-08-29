import { describe, it, expect } from 'vitest';
import {
  DRIFT_IGNORE_MS,
  DRIFT_SEEK_MS,
  LIVE_BEHIND_MS,
  MAX_RATE_NUDGE,
  type WatchMessage,
  type WatchTimeline,
  correction,
  isRedundant,
  liveTargetMs,
  parseWatchMessage,
  pickHost,
  positionAt,
  timelineFromMessage,
} from './watchSync';

// Epoch fixo — nada aqui pode depender do relógio da máquina que roda o teste.
const T0 = 1_700_000_000_000;

function timeline(patch: Partial<WatchTimeline> = {}): WatchTimeline {
  return {
    src: 'https://youtu.be/abc',
    playing: true,
    positionMs: 60_000,
    atEpochMs: T0,
    rate: 1,
    ...patch,
  };
}

describe('positionAt', () => {
  it('avança com o relógio enquanto está tocando', () => {
    expect(positionAt(timeline(), T0 + 5_000)).toBe(65_000);
  });

  it('ignora o relógio quando está pausado', () => {
    expect(positionAt(timeline({ playing: false }), T0 + 5_000)).toBe(60_000);
  });

  it('respeita a velocidade', () => {
    expect(positionAt(timeline({ rate: 2 }), T0 + 5_000)).toBe(70_000);
    expect(positionAt(timeline({ rate: 0.5 }), T0 + 5_000)).toBe(62_500);
  });

  it('nunca devolve posição negativa', () => {
    // Acontece de verdade: um comando ancorado alguns milissegundos no futuro
    // (relógio do remetente adiantado) perto do começo do vídeo.
    expect(positionAt(timeline({ positionMs: 1_000 }), T0 - 5_000)).toBe(0);
  });
});

describe('timelineFromMessage', () => {
  const message: WatchMessage = { ...timeline(), type: 'play', by: 'pedro' };

  it('sem instante de chegada, preserva o atEpochMs original', () => {
    // É o caminho do retardatário, que lê o estado de um atributo e não tem
    // instante de chegada nenhum pra usar.
    expect(timelineFromMessage(message).atEpochMs).toBe(T0);
  });

  it('com instante de chegada, reancora no relógio de quem recebe', () => {
    const adopted = timelineFromMessage(message, T0 + 42);
    expect(adopted.atEpochMs).toBe(T0 + 42);
    expect(adopted.positionMs).toBe(60_000);
    expect(adopted.src).toBe('https://youtu.be/abc');
    expect(adopted.playing).toBe(true);
    expect(adopted.rate).toBe(1);
  });

  it('a reancoragem cancela o relógio errado do remetente', () => {
    // O ponto do desenho: o remetente está 5s adiantado e diz "posição 60s no
    // instante T0+5000". Quem recebe lê o próprio relógio em T0 e reancora ali.
    // A posição-alvo tem que ser 60s — não 55s, que é o que sairia se o
    // atEpochMs do remetente fosse usado como está.
    const adiantado: WatchMessage = { ...message, atEpochMs: T0 + 5_000 };

    const semReancorar = timelineFromMessage(adiantado);
    expect(positionAt(semReancorar, T0)).toBe(55_000);

    const reancorado = timelineFromMessage(adiantado, T0);
    expect(positionAt(reancorado, T0)).toBe(60_000);
  });

  it('descarta type e by — eles não são linha do tempo', () => {
    expect(timelineFromMessage(message)).not.toHaveProperty('type');
    expect(timelineFromMessage(message)).not.toHaveProperty('by');
  });
});

describe('correction', () => {
  it('dentro da banda morta, manda voltar à velocidade do grupo', () => {
    expect(correction(60_000, 60_100, 1, true)).toEqual({ action: 'rate', rate: 1 });
  });

  it('atrasado acelera, adiantado desacelera', () => {
    const atrasado = correction(60_500, 60_000, 1, true);
    const adiantado = correction(60_000, 60_500, 1, true);
    expect(atrasado.action).toBe('rate');
    expect(adiantado.action).toBe('rate');
    if (atrasado.action !== 'rate' || adiantado.action !== 'rate') {
      throw new Error('esperava ajuste de velocidade');
    }
    expect(atrasado.rate).toBeGreaterThan(1);
    expect(adiantado.rate).toBeLessThan(1);
  });

  it('o ajuste nunca passa do teto, nem pra mais nem pra menos', () => {
    // Diferença logo abaixo do limiar de seek: é o maior ajuste possível.
    const quaseSeek = correction(60_000 + DRIFT_SEEK_MS - 1, 60_000, 1, true);
    if (quaseSeek.action !== 'rate') {
      throw new Error('esperava ajuste de velocidade');
    }
    expect(quaseSeek.rate).toBeLessThanOrEqual(1 + MAX_RATE_NUDGE);
    expect(quaseSeek.rate).toBeGreaterThanOrEqual(1 - MAX_RATE_NUDGE);
  });

  it('o ajuste é relativo à velocidade do grupo, não a 1', () => {
    // Se o grupo assiste em 1.5x, corrigir não pode devolver algo perto de 1 —
    // seria o bug do Jitsi #7159 ao contrário.
    const fix = correction(60_500, 60_000, 1.5, true);
    if (fix.action !== 'rate') {
      throw new Error('esperava ajuste de velocidade');
    }
    expect(fix.rate).toBeGreaterThan(1.5);
    expect(fix.rate).toBeLessThanOrEqual(1.5 * (1 + MAX_RATE_NUDGE));
  });

  it('diferença grande vira seek para o alvo, nos dois sentidos', () => {
    expect(correction(90_000, 60_000, 1, true)).toEqual({ action: 'seek', positionMs: 90_000 });
    expect(correction(60_000, 90_000, 1, true)).toEqual({ action: 'seek', positionMs: 60_000 });
  });

  it('pausado nunca ajusta velocidade — só seek resolve', () => {
    // Mexer no playbackRate de um player parado não move nada.
    expect(correction(60_500, 60_000, 1, false)).toEqual({ action: 'rate', rate: 1 });
    expect(correction(90_000, 60_000, 1, false)).toEqual({ action: 'seek', positionMs: 90_000 });
  });

  it('nas fronteiras exatas dos limiares', () => {
    // Exatamente na banda morta: ainda é "não mexe".
    expect(correction(60_000 + DRIFT_IGNORE_MS - 1, 60_000, 1, true)).toEqual({
      action: 'rate',
      rate: 1,
    });
    // Exatamente no limiar de ajuste: já mexe.
    const noLimiar = correction(60_000 + DRIFT_IGNORE_MS, 60_000, 1, true);
    if (noLimiar.action !== 'rate') {
      throw new Error('esperava ajuste de velocidade');
    }
    expect(noLimiar.rate).toBeGreaterThan(1);
    // Exatamente no limiar de seek: seek, não ajuste.
    expect(correction(60_000 + DRIFT_SEEK_MS, 60_000, 1, true).action).toBe('seek');
  });

  it('drift zero não mexe em nada', () => {
    expect(correction(60_000, 60_000, 1, true)).toEqual({ action: 'rate', rate: 1 });
  });
});

describe('isRedundant', () => {
  it('o heartbeat que repete o que já sabemos é redundante', () => {
    // O caso comum: nada aconteceu, o host só reanunciou. Adotar isso
    // reescreveria o atributo e re-renderizaria a árvore a cada 3s à toa.
    const atual = timeline();
    const batida = timeline({ positionMs: 65_000, atEpochMs: T0 + 5_000 });
    expect(isRedundant(atual, batida, T0 + 5_000)).toBe(true);
  });

  it('diferença de posição acima da banda morta não é redundante', () => {
    // Perdemos um seek: o heartbeat é justamente o que conserta.
    const atual = timeline();
    const batida = timeline({ positionMs: 120_000, atEpochMs: T0 });
    expect(isRedundant(atual, batida, T0)).toBe(false);
  });

  it('play/pause, velocidade e fonte diferentes nunca são redundantes', () => {
    const atual = timeline();
    expect(isRedundant(atual, timeline({ playing: false }), T0)).toBe(false);
    expect(isRedundant(atual, timeline({ rate: 1.5 }), T0)).toBe(false);
    expect(isRedundant(atual, timeline({ src: 'https://youtu.be/outro' }), T0)).toBe(false);
  });

  it('compara as duas projeções no mesmo instante, não os campos crus', () => {
    // Mesma linha do tempo descrita de dois jeitos: uma ancorada 30s antes da
    // outra. Nos campos crus elas diferem em 30s; projetadas, são idênticas.
    const atual = timeline({ positionMs: 60_000, atEpochMs: T0 });
    const mesma = timeline({ positionMs: 90_000, atEpochMs: T0 + 30_000 });
    expect(atual.positionMs).not.toBe(mesma.positionMs);
    expect(isRedundant(atual, mesma, T0 + 30_000)).toBe(true);
  });

  it('pausado compara a posição parada, sem deixar o relógio correr', () => {
    const atual = timeline({ playing: false });
    const batida = timeline({ playing: false });
    expect(isRedundant(atual, batida, T0 + 600_000)).toBe(true);
  });
});

describe('liveTargetMs', () => {
  it('senta atrás da borda', () => {
    expect(liveTargetMs(16_930_000)).toBe(16_930_000 - LIVE_BEHIND_MS);
  });

  it('não vai pra antes do começo numa live recém-começada', () => {
    expect(liveTargetMs(3_000)).toBe(0);
    expect(liveTargetMs(0)).toBe(0);
  });
});

describe('pickHost', () => {
  it('devolve o menor identity', () => {
    expect(pickHost(['pedro', 'ana', 'henrique'])).toBe('ana');
  });

  it('devolve null quando ninguém está na sessão', () => {
    expect(pickHost([])).toBeNull();
  });

  it('independe da ordem — todo mundo chega na mesma resposta', () => {
    // É o que dispensa negociação: cada cliente calcula sozinho e acerta.
    const gente = ['pedro', 'ana', 'henrique'];
    expect(pickHost([...gente].reverse())).toBe('ana');
    expect(pickHost(['henrique', 'pedro', 'ana'])).toBe('ana');
  });

  it('o bastão passa quando o host sai', () => {
    const antes = ['ana', 'henrique', 'pedro'];
    expect(pickHost(antes)).toBe('ana');
    const depois = antes.filter((quem) => quem !== 'ana');
    expect(pickHost(depois)).toBe('henrique');
  });

  it('com uma pessoa só, ela é o host', () => {
    expect(pickHost(['pedro'])).toBe('pedro');
  });
});

describe('parseWatchMessage', () => {
  const valida: WatchMessage = { ...timeline(), type: 'pause', by: 'pedro' };

  it('aceita uma mensagem válida', () => {
    expect(parseWatchMessage(JSON.stringify(valida))).toEqual(valida);
  });

  it('preenche o by quando ele não vem', () => {
    const { by: _by, ...semBy } = valida;
    expect(parseWatchMessage(JSON.stringify(semBy))?.by).toBe('alguém');
  });

  it('recusa JSON inválido', () => {
    expect(parseWatchMessage('')).toBeNull();
    expect(parseWatchMessage('{')).toBeNull();
    expect(parseWatchMessage('nada disso')).toBeNull();
  });

  it('recusa JSON válido que não é objeto', () => {
    expect(parseWatchMessage('null')).toBeNull();
    expect(parseWatchMessage('42')).toBeNull();
    expect(parseWatchMessage('"texto"')).toBeNull();
    expect(parseWatchMessage('[1,2,3]')).toBeNull();
  });

  it('recusa mensagem com campo faltando', () => {
    for (const campo of ['type', 'src', 'playing', 'positionMs', 'atEpochMs', 'rate'] as const) {
      const truncada: Record<string, unknown> = { ...valida };
      delete truncada[campo];
      expect(parseWatchMessage(JSON.stringify(truncada))).toBeNull();
    }
  });

  it('recusa campo com o tipo errado', () => {
    expect(parseWatchMessage(JSON.stringify({ ...valida, positionMs: '60000' }))).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ ...valida, playing: 'sim' }))).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ ...valida, src: 123 }))).toBeNull();
    expect(parseWatchMessage(JSON.stringify({ ...valida, type: 7 }))).toBeNull();
  });

  it('recusa número que não é finito', () => {
    // JSON.stringify vira `null` pra NaN e Infinity, mas o payload chega como
    // texto de outra máquina — nada garante que passou por JSON.stringify.
    expect(
      parseWatchMessage(
        '{"type":"play","src":"a","playing":true,"positionMs":null,"atEpochMs":1,"rate":1}',
      ),
    ).toBeNull();
    expect(
      parseWatchMessage(
        '{"type":"play","src":"a","playing":true,"positionMs":1e999,"atEpochMs":1,"rate":1}',
      ),
    ).toBeNull();
  });

  it('o que sai do parse alimenta o resto sem conversão', () => {
    // Fecha o ciclo: mensagem crua -> linha do tempo -> posição.
    const recebida = parseWatchMessage(JSON.stringify({ ...valida, playing: true }));
    expect(recebida).not.toBeNull();
    const adotada = timelineFromMessage(recebida!, T0);
    expect(positionAt(adotada, T0 + 10_000)).toBe(70_000);
  });
});
