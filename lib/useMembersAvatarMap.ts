'use client';

import * as React from 'react';
import { fetchMembers } from '@/lib/api-client';

/**
 * Mapa `username -> avatarUrl`, buscado UMA UNICA VEZ (nao por tile, nao por
 * render) e reaproveitado por todo mundo que precisa desenhar a foto de
 * perfil de um participante — hoje so o <CallParticipantTile />.
 *
 * Chave e `username`, nao `identity`: a identity do LiveKit carrega um sufixo
 * aleatorio (`${username}__${randomString(4)}`, ver
 * app/api/connection-details/route.ts) pra mesma conta poder entrar de dois
 * dispositivos sem colidir — o `participant.name`, esse sim, e o username
 * limpo, e e ele que casa com o que `/api/members` devolve.
 */
export function useMembersAvatarMap(): Record<string, string | null> {
  const [map, setMap] = React.useState<Record<string, string | null>>({});

  React.useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then((members) => {
        if (cancelled) return;
        const next: Record<string, string | null> = {};
        for (const member of members) {
          next[member.username] = member.avatarUrl;
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
