'use client';

// O que cada pessoa anuncia pra sala sobre QUEM ELA ESTÁ OUVINDO.
//
// Duas coisas, pelo mesmo canal (atributos de participante): o modo foco e a
// lista de quem foi mutado individualmente. As duas respondem à mesma pergunta
// do outro lado — "essa pessoa está me ouvindo?".
//
// MUDANÇA DE PREMISSA, VALE LER
// -----------------------------
// O modo foco nasceu 100% local: só quem ligava sabia, e ninguém tinha como
// descobrir que não estava sendo ouvido. Agora é o contrário — o estado é
// PÚBLICO de propósito, pra todo mundo ver quem está em foco e, principalmente,
// pra cada um saber se continua sendo ouvido por aquela pessoa.
//
// O que continua igual: o mute segue sendo LOCAL. Ninguém é mutado de verdade
// no servidor, e quem está em foco continua podendo falar normalmente pra todo
// mundo. O que mudou é só a visibilidade da escolha.
//
// CONSEQUÊNCIA DE PRIVACIDADE, EXPLÍCITA: a lista de quem você escolheu ouvir
// vai junto no atributo, e atributo de participante é legível por qualquer um
// na sala. Ou seja, dá pra saber que você ligou o foco e quem você deixou de
// fora. Isso é o pedido — transparência sobre "não estou te ouvindo" — mas não
// é um detalhe que dê pra esconder depois sem mudar o desenho.
//
// Trafega pelo mesmo canal do contador de espectadores (atributos de
// participante) e exige o mesmo grant `canUpdateOwnMetadata` no token — ver
// app/api/connection-details/route.ts e lib/useScreenShareViewers.ts.

export const FOCUS_ATTRIBUTE = 'concord.focus';

/**
 * Prefixo `on:` em vez de só a lista: foco LIGADO com ninguém marcado é um
 * estado real e diferente de foco desligado (num, você não ouve ninguém; no
 * outro, ouve todo mundo). Sem o prefixo os dois virariam string vazia.
 */
const ON_PREFIX = 'on:';

export function encodeFocus(enabled: boolean, allowed: ReadonlySet<string>): string {
  if (!enabled) {
    return '';
  }
  return ON_PREFIX + [...allowed].sort().join(',');
}

export interface ParsedFocus {
  enabled: boolean;
  allowed: ReadonlySet<string>;
}

export function parseFocus(value: string | undefined): ParsedFocus {
  if (!value || !value.startsWith(ON_PREFIX)) {
    return { enabled: false, allowed: new Set() };
  }
  const names = value.slice(ON_PREFIX.length).split(',').filter(Boolean);
  return { enabled: true, allowed: new Set(names) };
}

/** Como o tile de alguém deve ser anelado, do ponto de vista de QUEM OLHA. */
export type FocusRing =
  /** Está em modo foco e continua me ouvindo. */
  | 'listening'
  /** Está em modo foco e NÃO está me ouvindo. */
  | 'excluded';

/**
 * @param focus o que a pessoa anunciou
 * @param myName meu username limpo (`participant.name`)
 */
export function ringFor(focus: ParsedFocus, myName: string | undefined): FocusRing | undefined {
  if (!focus.enabled) {
    return undefined;
  }
  return myName && focus.allowed.has(myName) ? 'listening' : 'excluded';
}

// --- Mute individual --------------------------------------------------------
//
// O modo foco não é o único jeito de deixar de ouvir alguém: dá pra mutar uma
// pessoa específica no card de volume (ou na seção Mixer), a qualquer momento,
// sem foco nenhum ligado. Do ponto de vista de quem foi mutado o efeito é
// idêntico — o que você fala não chega — então isso também é anunciado.
//
// Só a VOZ conta aqui. Mutar o áudio de tela ou a soundboard de alguém não é
// "não te ouço", é "não quero esse barulho", e anunciar isso seria ruído social
// sem utilidade.

export const MUTED_ATTRIBUTE = 'concord.muted';

export function encodeMuted(names: ReadonlySet<string>): string {
  return [...names].sort().join(',');
}

export function parseMuted(value: string | undefined): ReadonlySet<string> {
  if (!value) {
    return new Set();
  }
  return new Set(value.split(',').filter(Boolean));
}

/** O que o tile de alguém precisa dizer sobre me ouvir ou não. */
export interface Audibility {
  /** Anel roxo: está em modo foco (e se eu sobrevivi à lista). */
  ring?: FocusRing;
  /** Me mutou individualmente — vale mesmo fora do modo foco. */
  mutedMe: boolean;
}
