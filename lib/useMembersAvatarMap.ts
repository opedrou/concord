'use client';

import * as React from 'react';
import { fetchMembers } from '@/lib/api-client';

/** O que o mapa guarda por pessoa: a foto e a cor dominante dela (U1). A cor
 * viaja JUNTO com a URL de proposito — quem desenha o tile precisa das duas ao
 * mesmo tempo (foto quando a camera esta ligada... ou nao, cor quando esta
 * desligada) e uma segunda busca so pra cor seria a mesma chamada duas vezes. */
export interface MemberAvatar {
  avatarUrl: string | null;
  /** `#rrggbb`, ja validado pelo servidor. null = sem foto ou cor ainda nao
   * calculada; nesse caso quem desenha usa o `--accent` do tema. */
  avatarColor: string | null;
}

/**
 * Mapa `username -> { avatarUrl, avatarColor }`, buscado UMA UNICA VEZ (nao
 * por tile, nao por render) e reaproveitado por todo mundo que precisa
 * desenhar a foto de perfil de um participante.
 *
 * Chave e `username`, nao `identity`: a identity do LiveKit carrega um sufixo
 * aleatorio (`${username}__${randomString(4)}`, ver
 * app/api/connection-details/route.ts) pra mesma conta poder entrar de dois
 * dispositivos sem colidir — o `participant.name`, esse sim, e o username
 * limpo, e e ele que casa com o que `/api/members` devolve.
 */
export function useMembersAvatarMap(): Record<string, MemberAvatar> {
  const [map, setMap] = React.useState<Record<string, MemberAvatar>>({});

  React.useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then((members) => {
        if (cancelled) return;
        const next: Record<string, MemberAvatar> = {};
        for (const member of members) {
          next[member.username] = {
            avatarUrl: member.avatarUrl,
            avatarColor: member.avatarColor,
          };
        }
        setMap(next);
      })
      .catch(() => {
        // Falha silenciosa: sem mapa, os tiles so caem no fallback de
        // iniciais do <Avatar /> — nunca vale travar a call por isso.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
