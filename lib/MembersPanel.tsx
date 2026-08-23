'use client';

import * as React from 'react';
import { fetchMembers, type Member } from '@/lib/api-client';
import { usePresencePolling } from '@/lib/usePresencePolling';
import { Avatar } from '@/lib/Avatar';
import { ChevronDownIcon, ChevronRightIcon } from '@/lib/icons';
import styles from '../styles/MembersPanel.module.css';

// So aparece no contexto de canal de TEXTO (TextChannelShell.tsx e no
// overlay de texto do RoomShell.tsx) — na tela de call ela so competia por
// espaco com os controles de video, era uma das queixas originais.

const COLLAPSED_STORAGE_KEY = 'lk-members-panel-collapsed';

function loadCollapsedPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    // Default recolhido: colapsada ela ocupa so o botao, nunca uma largura
    // fixa "de graca" — so expande quando a pessoa pede.
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

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
  // Estado de aberto/fechado persistido — quem fecha o painel nao quer
  // reabri-lo toda vez que troca de canal de texto.
  const [collapsed, setCollapsed] = React.useState(loadCollapsedPref);
  const { presence } = usePresencePolling();

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // localStorage pode falhar (modo privado, quota etc); a UI continua
        // funcionando, so nao lembra a preferencia entre sessoes.
      }
      return next;
    });
  }, []);

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

  // Duas listas, nao uma lista ordenada com bolinha de status: e assim que o
  // projeto de design separa ("Online — N" / "Offline — N"). A diferenca
  // pratica e que da pra ver a contagem de quem esta disponivel sem contar
  // cabeca, e os offline podem ir apagados sem sumir.
  const { online, offline } = React.useMemo(() => {
    const byName = (a: Member, b: Member) => a.username.localeCompare(b.username);
    return {
      online: members.filter((m) => namesOnline.has(m.username)).sort(byName),
      offline: members.filter((m) => !namesOnline.has(m.username)).sort(byName),
    };
  }, [members, namesOnline]);

  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ''}`} aria-label="Membros">
      <button
        type="button"
        className={styles.toggle}
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
      >
        <span>Membros — {members.length}</span>
        <span className={styles.toggleIcon}>
          {collapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
        </span>
      </button>

      {!collapsed && (
        <div className={styles.list}>
          {loadError && <p className={styles.error}>Nao foi possivel carregar os membros.</p>}

          {online.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Online — {online.length}</div>
              <ul className={styles.group}>
                {online.map((member) => (
                  <li key={member.id} className={styles.member}>
                    <span className={styles.avatarWrap}>
                      <Avatar username={member.username} avatarUrl={member.avatarUrl} size={34} />
                      <span
                        className={`${styles.statusDot} ${styles.statusOnline}`}
                        title="Em uma chamada"
                      />
                    </span>
                    <span className={styles.memberName}>{member.username}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {offline.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Offline — {offline.length}</div>
              <ul className={`${styles.group} ${styles.groupOffline}`}>
                {offline.map((member) => (
                  <li key={member.id} className={styles.member}>
                    <span className={styles.avatarWrap}>
                      <Avatar username={member.username} avatarUrl={member.avatarUrl} size={34} />
                    </span>
                    <span className={styles.memberName}>{member.username}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!loadError && members.length === 0 && (
            <p className={styles.empty}>Nenhum membro cadastrado.</p>
          )}
        </div>
      )}
    </aside>
  );
}
