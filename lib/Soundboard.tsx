'use client';

// Painel da soundboard: grade de botões, upload e remoção.
//
// A biblioteca é COMPARTILHADA — o que alguém sobe aparece pra todo mundo. O
// mecanismo de tocar (e o porquê de não ser uma track de áudio) está em
// lib/soundboardEvents.ts.
//
// Mora na `CallControlBar`, dentro do `RoomContext`: o disparo depende do canal
// de dados, que só existe com uma sala conectada.

import * as React from 'react';
import {
  apiErrorMessage,
  deleteSound,
  fetchSounds,
  uploadSound,
  type CurrentUser,
  type Sound,
} from '@/lib/api-client';
import { useSoundboard } from '@/lib/soundboardEvents';
import { MAX_SOUND_BYTES } from '@/lib/uploadLimits';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { CloseIcon, Volume2Icon } from '@/lib/icons';
import styles from '../styles/Soundboard.module.css';

export function Soundboard() {
  const [open, setOpen] = React.useState(false);
  const { play, lastEvent } = useSoundboard();

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`lk-button ${styles.button}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Soundboard"
        onClick={() => setOpen((v) => !v)}
      >
        <Volume2Icon size={18} />
      </button>

      {/* Fora do popover de propósito: dá pra ver quem tocou o quê mesmo com o
          painel fechado. */}
      {lastEvent && <LastPlayed event={lastEvent} />}

      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <SoundboardPanel onPlay={play} onClose={() => setOpen(false)} />
        </>
      )}
    </div>
  );
}

/** Some sozinho — é um aviso, não um histórico. */
function LastPlayed({ event }: { event: { by: string; name: string; at: number } }) {
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [event.at]);

  if (!visible) {
    return null;
  }
  return (
    <span className={styles.lastPlayed}>
      {event.by} tocou <strong>{event.name}</strong>
    </span>
  );
}

function SoundboardPanel(props: { onPlay: (sound: Sound) => void; onClose: () => void }) {
  const { user } = useCurrentUser({ redirectToLogin: false });
  const [sounds, setSounds] = React.useState<Sound[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchSounds()
      .then((list) => {
        if (!cancelled) setSounds(list);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpload = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    // Checagem local só pra dar erro rápido; quem decide de verdade é o
    // servidor, que valida tamanho e formato pelos magic bytes.
    if (file.size > MAX_SOUND_BYTES) {
      setError('Som grande demais — o limite é 1 MB.');
      return;
    }
    setBusy(true);
    try {
      const created = await uploadSound(file);
      setSounds((prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDelete = React.useCallback(async (sound: Sound) => {
    setError(null);
    try {
      await deleteSound(sound.id);
      setSounds((prev) => (prev ?? []).filter((s) => s.id !== sound.id));
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, []);

  const canDelete = (sound: Sound, current: CurrentUser | null) =>
    !!current && (current.isAdmin || sound.uploadedBy === current.id);

  return (
    <div className={styles.panel} role="dialog" aria-label="Soundboard">
      <header className={styles.header}>
        <span className={styles.title}>Soundboard</span>
        <button type="button" className="lk-button" onClick={props.onClose} aria-label="Fechar">
          <CloseIcon size={14} />
        </button>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {sounds === null && !error && <p className={styles.hint}>Carregando…</p>}

      {sounds !== null && sounds.length === 0 && (
        <p className={styles.hint}>Nenhum som ainda. Suba um — todo mundo vai poder tocar.</p>
      )}

      {sounds !== null && sounds.length > 0 && (
        <div className={styles.grid}>
          {sounds.map((sound) => (
            <div key={sound.id} className={styles.item}>
              <button
                type="button"
                className={styles.soundButton}
                onClick={() => props.onPlay(sound)}
                title={`Tocar ${sound.name} pra todo mundo`}
              >
                {sound.name}
              </button>
              {canDelete(sound, user) && (
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => handleDelete(sound)}
                  aria-label={`Apagar ${sound.name}`}
                  title="Apagar da biblioteca (vale pra todo mundo)"
                >
                  <CloseIcon size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          void handleUpload(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="lk-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
      >
        {busy ? 'Enviando…' : 'Adicionar som'}
      </button>
      <p className={styles.hint}>
        Áudio de até 1 MB. Quem sobe compartilha com o grupo inteiro. Cada pessoa pode calar a
        soundboard de quem quiser sem perder a voz — é só clicar no tile dela.
      </p>
    </div>
  );
}
