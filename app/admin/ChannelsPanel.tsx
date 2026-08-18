'use client';

import * as React from 'react';
import {
  Channel,
  ChannelType,
  apiErrorMessage,
  createChannel,
  deleteChannel,
  fetchChannels,
  reorderChannels,
  updateChannel,
} from '@/lib/api-client';
import { ArrowDownIcon, ArrowUpIcon, HashIcon, SpeakerIcon } from '@/lib/icons';
import styles from '../../styles/Admin.module.css';

export function ChannelsPanel() {
  const [channels, setChannels] = React.useState<Channel[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<number | null>(null);

  const [newName, setNewName] = React.useState('');
  const [newType, setNewType] = React.useState<ChannelType>('voice');
  const [creating, setCreating] = React.useState(false);

  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editName, setEditName] = React.useState('');

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      // /api/channels já devolve ordenado por `position`.
      setChannels(await fetchChannels());
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const onCreate: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setActionError(null);
    if (!newName.trim()) {
      setActionError('Informe um nome para o canal.');
      return;
    }
    setCreating(true);
    try {
      const created = await createChannel({ name: newName.trim(), type: newType });
      setChannels((prev) => [...(prev ?? []), created]);
      setNewName('');
      setNewType('voice');
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (channel: Channel) => {
    setActionError(null);
    setEditingId(channel.id);
    setEditName(channel.name);
  };

  const onSaveRename = async (id: number) => {
    setActionError(null);
    if (!editName.trim()) {
      setActionError('O nome não pode ficar vazio.');
      return;
    }
    setBusyId(id);
    try {
      const updated = await updateChannel(id, { name: editName.trim() });
      setChannels((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? prev);
      setEditingId(null);
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (id: number) => {
    setActionError(null);
    setBusyId(id);
    try {
      await deleteChannel(id);
      setChannels((prev) => prev?.filter((c) => c.id !== id) ?? prev);
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  // Reordenação por botões ↑/↓ em vez de drag-and-drop — bem mais simples de
  // usar no celular. Manda a lista inteira de ids na nova ordem (contrato de
  // /api/channels/reorder exige todos os ids de uma vez).
  const move = async (index: number, direction: -1 | 1) => {
    if (!channels) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= channels.length) return;

    const reordered = [...channels];
    const tmp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = tmp;

    setActionError(null);
    setBusyId(tmp.id);
    try {
      setChannels(await reorderChannels(reordered.map((c) => c.id)));
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) {
    return (
      <div className={styles.errorBox}>
        <p>{loadError}</p>
        <button className="lk-button" type="button" onClick={load}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <form className={styles.createForm} onSubmit={onCreate}>
        <h2 className={styles.sectionTitle}>Novo canal</h2>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label htmlFor="new-channel-name">Nome</label>
            <input
              id="new-channel-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-channel-type">Tipo</label>
            <select
              id="new-channel-type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as ChannelType)}
            >
              <option value="voice">Voz</option>
              <option value="text">Texto</option>
            </select>
          </div>
          <button className="lk-button" type="submit" disabled={creating}>
            {creating ? 'Criando…' : 'Criar canal'}
          </button>
        </div>
      </form>

      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}

      <h2 className={styles.sectionTitle}>Canais</h2>
      {channels === null ? (
        <p className={styles.muted}>Carregando…</p>
      ) : channels.length === 0 ? (
        <p className={styles.muted}>Nenhum canal cadastrado.</p>
      ) : (
        <ul className={styles.list}>
          {channels.map((channel, index) => {
            const isEditing = editingId === channel.id;
            const isConfirmingDelete = confirmDeleteId === channel.id;
            const rowBusy = busyId === channel.id;

            return (
              <li key={channel.id} className={styles.row}>
                <div className={styles.reorderButtons}>
                  <button
                    className="lk-button"
                    type="button"
                    disabled={rowBusy || index === 0}
                    aria-label={`Mover ${channel.name} para cima`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon size={16} />
                  </button>
                  <button
                    className="lk-button"
                    type="button"
                    disabled={rowBusy || index === channels.length - 1}
                    aria-label={`Mover ${channel.name} para baixo`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon size={16} />
                  </button>
                </div>

                <div className={styles.rowMain}>
                  {!isEditing ? (
                    <>
                      <span className={styles.rowTitle}>
                        {channel.type === 'text' ? <HashIcon size={15} /> : <SpeakerIcon size={15} />}
                        {channel.name}
                      </span>
                      <span className={styles.rowMeta}>
                        {channel.slug} · {channel.type === 'text' ? 'texto' : 'voz'}
                      </span>
                    </>
                  ) : (
                    <input
                      className={styles.inlineInput}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                    />
                  )}
                </div>

                <div className={styles.rowActions}>
                  {!isEditing ? (
                    <button className="lk-button" type="button" onClick={() => startEdit(channel)}>
                      Renomear
                    </button>
                  ) : (
                    <span className={styles.inlineForm}>
                      <button
                        className="lk-button"
                        type="button"
                        disabled={rowBusy}
                        onClick={() => onSaveRename(channel.id)}
                      >
                        Salvar
                      </button>
                      <button className="lk-button" type="button" onClick={() => setEditingId(null)}>
                        Cancelar
                      </button>
                    </span>
                  )}

                  {!isConfirmingDelete ? (
                    <button
                      className={`lk-button ${styles.dangerButton}`}
                      type="button"
                      onClick={() => setConfirmDeleteId(channel.id)}
                    >
                      Apagar
                    </button>
                  ) : (
                    <span className={styles.inlineConfirm}>
                      <span>Apagar {channel.name}?</span>
                      <button
                        className={`lk-button ${styles.dangerButton}`}
                        type="button"
                        disabled={rowBusy}
                        onClick={() => onDelete(channel.id)}
                      >
                        Confirmar
                      </button>
                      <button
                        className="lk-button"
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancelar
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
