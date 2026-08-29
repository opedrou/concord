'use client';

// "Chamar pessoas" (C2 + C3 do PLANO-2.md): botão na barra de controle que
// abre um modal com a lista de membros, seleção múltipla, e dispara
// POST /api/call-people com quem foi marcado. O backend (validação, rate
// limit, disparo do webhook) já está pronto — este componente é só a UI.
//
// Mora dentro do `RoomContext` (é renderizado pela CallControlBar, que só
// existe dentro da call) — é isso que dá acesso a `useRoomContext()` pra
// resolver o canal atual sem prop drilling nenhum, mesmo padrão do
// CallStateBinder.tsx.

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { apiErrorMessage, callPeople, fetchMembers, type Member } from '@/lib/api-client';
import { AccountOverlay } from '@/lib/AccountOverlay';
import { Avatar } from '@/lib/Avatar';
import { BellIcon } from '@/lib/icons';
import styles from '../styles/CallPeoplePanel.module.css';

// Espelha MAX_CALLED de app/api/call-people/route.ts. Não dá pra importar de
// lá (é um route handler, não um módulo compartilhado) — se o Pedro mudar o
// teto no servidor, mudar aqui também.
const MAX_CALLED = 10;

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; called: number }
  | { kind: 'error'; message: string };

export function CallPeoplePanel() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        className="lk-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Chamar pessoas"
        onClick={() => setOpen(true)}
      >
        <BellIcon size={18} />
      </button>
      {open && <CallPeopleModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CallPeopleModal({ onClose }: { onClose: () => void }) {
  const room = useRoomContext();
  // A sala do LiveKit é nomeada com o slug do canal (ver o comentário no topo
  // de CallStateBinder.tsx) — é daqui que sai o `channelSlug`, sem precisar
  // furar prop nenhuma.
  const channelSlug = room.name;
  // `participant.name` é o username LIMPO (a `identity` carrega um sufixo
  // aleatório pra permitir duas sessões da mesma conta — ver o comentário no
  // topo de useMembersAvatarMap.ts). É contra isso que casamos pra excluir a
  // própria pessoa da lista, nunca contra `identity`.
  const selfName = room.localParticipant.name;

  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [send, setSend] = React.useState<SendState>({ kind: 'idle' });

  React.useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const callable = React.useMemo(
    () => (members ?? []).filter((m) => m.username !== selfName),
    [members, selfName],
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const overLimit = selected.size > MAX_CALLED;
  const canSend = selected.size > 0 && !overLimit && send.kind !== 'sending';

  async function handleSend() {
    setSend({ kind: 'sending' });
    try {
      await callPeople(Array.from(selected), channelSlug);
      setSend({ kind: 'success', called: selected.size });
      // Sucesso é bom motivo pra fechar sozinho — a confirmação já apareceu
      // na hora (o disparo é "e não espera", ver callPeople em api-client.ts),
      // não faz sentido segurar o modal aberto esperando mais nada.
      setTimeout(onClose, 1200);
    } catch (err) {
      setSend({ kind: 'error', message: apiErrorMessage(err) });
    }
  }

  return (
    <AccountOverlay title="Chamar pessoas" size="narrow" onClose={onClose}>
      <div className={styles.wrap}>
        {members === null && !loadError && <p className={styles.muted}>Carregando…</p>}

        {loadError && <p className={styles.error}>Não foi possível carregar a lista de membros.</p>}

        {members !== null && !loadError && callable.length === 0 && (
          <p className={styles.muted}>Não há mais ninguém pra chamar.</p>
        )}

        {members !== null && !loadError && callable.length > 0 && (
          <>
            <ul className={styles.list}>
              {callable.map((member) => {
                const checked = selected.has(member.id);
                return (
                  <li key={member.id} className={styles.row}>
                    <label className={styles.rowLabel}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(member.id)} />
                      <Avatar username={member.username} avatarUrl={member.avatarUrl} size={28} />
                      <span className={styles.rowName}>{member.username}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {overLimit && (
              <p className={styles.error} role="alert">
                Máximo de {MAX_CALLED} pessoas por vez. Desmarque alguém.
              </p>
            )}

            {send.kind === 'error' && (
              <p className={styles.error} role="alert">
                {send.message}
              </p>
            )}

            {send.kind === 'success' && (
              <p className={styles.success} role="status">
                Chamada enviada para {send.called} {send.called === 1 ? 'pessoa' : 'pessoas'}.
              </p>
            )}

            <button type="button" className="lk-button" disabled={!canSend} onClick={handleSend}>
              {send.kind === 'sending'
                ? 'Enviando…'
                : `Chamar${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </>
        )}
      </div>
    </AccountOverlay>
  );
}
