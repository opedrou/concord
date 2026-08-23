// Conjunto de icones SVG inline, estilo Discord (traco, sem preenchimento,
// `currentColor`), pra substituir os emoji que a UI usava como icone. Emoji
// renderiza diferente em cada SO/fonte e destoa do tema escuro do LiveKit —
// SVG com `currentColor` respeita `--lk-fg`/tema automaticamente.
//
// Inline em vez de dependencia (ex.: lucide-react) pelo mesmo motivo que
// ChannelSidebar.tsx ja registrava pros dois primeiros icones (Hash/Speaker):
// nao adiciona peso nem risco novo ao build standalone/Alpine so por um
// punhado de tracos. Todo icone e puramente decorativo (`aria-hidden`) — o
// texto acessivel (aria-label/title) continua no elemento que o envolve.

import * as React from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

function baseProps(size: number) {
  return {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
}

/**
 * A marca do Concord: tres barras de equalizador, niveis de voz subindo.
 * Vem do projeto de design (`logoBadge` em Concord.dc.html) — 2D chapada, sem
 * gradiente nem profundidade, e por isso funciona tanto em 34px na sidebar
 * quanto em 92px na home.
 *
 * Nao usa `baseProps`: os outros icones sao traco em `currentColor` num
 * viewBox 24; este e preenchimento solido no acento, num viewBox 100.
 */
export function ConcordMark({ size = 34, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden
      style={{ display: 'block' }}
    >
      {[
        [22, 44, 34],
        [44, 24, 54],
        [66, 38, 40],
      ].map(([x, y, h]) => (
        <rect key={x} x={x} y={y} width={12} height={h} rx={6} fill="var(--accent)" />
      ))}
    </svg>
  );
}

/** Sol — tema claro. */
export function SunIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <circle cx="12" cy="12" r="4.2" />
      {[
        'M12 2v2.5',
        'M12 19.5V22',
        'M2 12h2.5',
        'M19.5 12H22',
        'M4.9 4.9l1.8 1.8',
        'M17.3 17.3l1.8 1.8',
        'M19.1 4.9l-1.8 1.8',
        'M6.7 17.3l-1.8 1.8',
      ].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Lua — tema escuro. */
export function MoonIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** Escudo — area de administracao do servidor. */
export function ShieldIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Canal de texto ("#"), estilo Discord. */
export function HashIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <line x1="9" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="15" y2="20" />
      <line x1="4.5" y1="9" x2="19.5" y2="9" />
      <line x1="3.5" y1="15" x2="18.5" y2="15" />
    </svg>
  );
}

/** Canal de voz (alto-falante), estilo Discord. */
export function SpeakerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M3 10v4h3.5l4.5 4V6l-4.5 4H3z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

/** Alto-falante com ondas (audio ligado / volume). */
export function Volume2Icon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M3 10v4h3.5l4.5 4V6l-4.5 4H3z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

/** Alto-falante cortado (mutado / sem audio). */
export function VolumeXIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M3 10v4h3.5l4.5 4V6l-4.5 4H3z" />
      <line x1="16" y1="9" x2="21" y2="14" />
      <line x1="21" y1="9" x2="16" y2="14" />
    </svg>
  );
}

/** Microfone (reducao de ruido ligada). */
export function MicIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <line x1="12" y1="17.5" x2="12" y2="21.5" />
      <line x1="8.5" y1="21.5" x2="15.5" y2="21.5" />
    </svg>
  );
}

/** Microfone cortado (reducao de ruido indisponivel/desligada). */
export function MicOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <line x1="12" y1="17.5" x2="12" y2="21.5" />
      <line x1="8.5" y1="21.5" x2="15.5" y2="21.5" />
      <line x1="4" y1="3" x2="20" y2="21" />
    </svg>
  );
}

/** Sino (som de entrada/saida de participante ativo). */
export function BellIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c0.5-0.5 2-2 2-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** Sino cortado (som de entrada/saida silenciado). */
export function BellOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M6 10a6 6 0 0 1 9.8-4.65" />
      <path d="M18 10c0 4 1.5 5.5 2 6H8" />
      <path d="M4 16h2" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

/** Cursores de mixagem (painel de volume por participante). */
export function SlidersIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <line x1="5" y1="21" x2="5" y2="14" />
      <line x1="5" y1="10" x2="5" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="19" y1="21" x2="19" y2="16" />
      <line x1="19" y1="12" x2="19" y2="3" />
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="10" r="2" />
      <circle cx="19" cy="14" r="2" />
    </svg>
  );
}

/** Camera (gravacao em andamento). */
export function VideoIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="M15.5 10.5 21 7v10l-5.5-3.5z" />
    </svg>
  );
}

/** Triangulo de alerta. */
export function AlertTriangleIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M12 3.5 22 20H2z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.2" />
    </svg>
  );
}

/** "X" de fechar. */
export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}

/** Seta simples pra cima (reordenar). */
export function ArrowUpIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}

/** Seta simples pra baixo (reordenar). */
export function ArrowDownIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="18 13 12 19 6 13" />
    </svg>
  );
}

/** Chevron pra direita (item recolhido). */
export function ChevronRightIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <polyline points="9 5 16 12 9 19" />
    </svg>
  );
}

/** Chevron pra baixo (item expandido). */
export function ChevronDownIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <polyline points="5 9 12 16 19 9" />
    </svg>
  );
}

/** Fone de ouvido (rodape de perfil, estilo Discord — "deafen"). */
export function HeadphonesIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2.5" y="13" width="4" height="7" rx="1.5" />
      <rect x="17.5" y="13" width="4" height="7" rx="1.5" />
    </svg>
  );
}

/** Engrenagem (configuracoes da conta, rodape de perfil). */
export function SettingsIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      {/* Engrenagem de verdade (dentes), nao raios — a versao anterior
          desenhava circulo + 8 raios retos, que le como SOL, nao como
          configuracoes. */}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Monitor — usado pra "esta compartilhando tela". Proprio, e nao o
 * `ScreenShareIcon` do @livekit/components-react, pra manter a familia visual
 * deste arquivo (stroke currentColor, viewBox 24, mesma espessura). */
export function ScreenShareIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

/** Setas pra fora — "expandir / tela cheia". */
export function ExpandIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M9 3H3v6" />
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M15 21h6v-6" />
    </svg>
  );
}

/** Setas pra dentro — "sair da tela cheia". */
export function CollapseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M3 9h6V3" />
      <path d="M21 9h-6V3" />
      <path d="M3 15h6v6" />
      <path d="M21 15h-6v6" />
    </svg>
  );
}

/** Olho aberto — "assistir a transmissao". */
export function EyeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

/** Olho cortado — "parar de assistir". */
export function EyeOffIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className}>
      <path d="M9.9 5.7A10.6 10.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17.6 17.6 0 0 1-3.4 4.2" />
      <path d="M6.3 7.8A17.4 17.4 0 0 0 2 12s3.6 6.5 10 6.5a10.9 10.9 0 0 0 4-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}
