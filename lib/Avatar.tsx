'use client';

import * as React from 'react';
import styles from '../styles/Avatar.module.css';

// Paleta fixa (nao aleatoria) pra cor do avatar gerado — mesmo criterio do
// Discord/Slack: hash do nome escolhe uma cor sempre igual pra mesma pessoa,
// sem precisar guardar nada no banco.
//
// Era a paleta do Discord (azul, verde limao, amarelo, rosa, ciano...). No
// tema quente do projeto de design isso virava confete: oito cores saturadas
// e sem parentesco nenhum com o resto da tela. A paleta agora e uma FAMILIA —
// tons do roxo da marca, do escuro ao claro. Continua dando pra distinguir
// duas pessoas de relance, e nada mais briga com o acento.
const PALETTE = [
  '#9D4EDD',
  '#7B2CBF',
  '#C77DFF',
  '#5A189A',
  '#B565E0',
  '#8E44C7',
  '#A05AD6',
  '#6A2A9E',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // 32 bits
  }
  return Math.abs(hash);
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface AvatarProps {
  username: string;
  /** URL de GET /api/avatars/:id. Quando null/undefined, cai no avatar gerado por iniciais. */
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

/**
 * Avatar reutilizavel: foto real quando existe, senão iniciais + cor
 * derivada do nome. Pensado pra galeria de membros, sidebar e pagina de
 * perfil usarem o mesmo visual em todo lugar.
 */
export function Avatar({ username, avatarUrl, size = 32, className }: AvatarProps) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const showImage = Boolean(avatarUrl) && !imgFailed;
  const style: React.CSSProperties = { width: size, height: size, fontSize: size * 0.4 };

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar servido pela nossa propria rota, sem beneficio do <Image> do Next aqui
      <img
        src={avatarUrl ?? undefined}
        alt={`Avatar de ${username}`}
        className={`${styles.avatar} ${className ?? ''}`}
        style={style}
        onError={() => setImgFailed(true)}
      />
    );
  }

  const color = PALETTE[hashString(username) % PALETTE.length];
  return (
    <div
      className={`${styles.avatar} ${styles.fallback} ${className ?? ''}`}
      style={{ ...style, backgroundColor: color }}
      aria-label={`Avatar de ${username}`}
      role="img"
    >
      {initialsFor(username)}
    </div>
  );
}
