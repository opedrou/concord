'use client';

import * as React from 'react';
import { fetchMembers, type Member } from '@/lib/api-client';
import { usePresencePolling } from '@/lib/usePresencePolling';
import { Avatar } from '@/lib/Avatar';
import { ChevronDownIcon, ChevronRightIcon } from '@/lib/icons';
import styles from '../styles/MembersPanel.module.css';

// PENDENTE (ver relatorio da ONDA C): este componente e autocontido e ainda
// nao esta plugado em nenhuma pagina — falta decidir onde encaixar ao lado
// da ChannelSidebar (que e territorio da ONDA A). Uso pretendido:
// <MembersPanel /> em qualquer lugar do layout autenticado.

/**
 * Painel lateral com todo mundo cadastrado (nao so quem esta numa call),
 * estilo lista de membros do Discord. "Online" aqui significa especificamente
 * "esta em algum canal de voz agora" — reaproveita o mesmo polling de
 * presenca da ChannelSidebar (GET /api/channels/presence); o app nao tem
 * rastreamento de sessao "logado mas ocioso" em lugar nenhum, entao nao da
 * pra distinguir isso de "offline" sem inventar um mecanismo novo.
 */
export function MembersPanel() {
  const [members, setMembers] = React.useState<Member[]>([]);
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const [collapsed, setCollapsed] = React.useState(true);
  const { presence } = usePresencePolling();

  React.useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nome de quem esta em algum canal agora, vindo de todos os canais do mapa
  // de presenca — a identity carrega um sufixo aleatorio (ver
  // connection-details/route.ts), entao o match certo e por `name`.
  const namesOnline = React.useMemo(() => {
    const set = new Set<string>();
    for (const participants of Object.values(presence)) {
      for (const p of participants) {
        set.add(p.name);
      }
    }
    return set;
  }, [presence]);

  const sorted = React.useMemo(() => {
    return [...members].sort((a, b) => {
      const aOnline = namesOnline.has(a.username);
      const bOnline = namesOnline.has(b.username);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return a.username.localeCompare(b.username);
    });
  }, [members, namesOnline]);

  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`} aria-label="Membros">
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>Membros — {members.length}</span>
        <span className={styles.toggleIcon}>
          {collapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
        </span>
      </button>

      {!collapsed && (
        <ul className={styles.list}>
          {loadError && <li className={styles.error}>Nao foi possivel carregar os membros.</li>}
          {sorted.map((member) => {
            const online = namesOnline.has(member.username);
            return (
              <li key={member.id} className={styles.member}>
                <span className={styles.avatarWrap}>
                  <Avatar username={member.username} avatarUrl={member.avatarUrl} size={28} />
                  <span
                    className={`${styles.statusDot} ${online ? styles.statusOnline : styles.statusOffline}`}
                    title={online ? 'Em uma chamada' : 'Offline'}
                  />
                </span>
                <span className={styles.memberName}>{member.username}</span>
              </li>
            );
          })}
          {!loadError && sorted.length === 0 && <li className={styles.empty}>Nenhum membro cadastrado.</li>}
        </ul>
      )}
    </aside>
  );
}
