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
  type Sound,
} from '@/lib/api-client';
import { useSoundboard } from '@/lib/soundboardEvents';
import { playSfx } from '@/lib/sfx';
import { MAX_SOUND_BYTES } from '@/lib/uploadLimits';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { CloseIcon, Volume2Icon } from '@/lib/icons';
import styles from '../styles/Soundboard.module.css';
import settingsStyles from '../styles/SettingsWindow.module.css';

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
  const [sounds, setSounds] = React.useState<Sound[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
        <p className={styles.hint}>
          Nenhum som ainda. Suba um em Configurações &rsaquo; Soundboard — todo mundo vai poder
          tocar.
        </p>
      )}

      {sounds !== null && sounds.length > 0 && (
        <div className={styles.grid}>
          {sounds.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className={styles.soundButton}
              onClick={() => props.onPlay(sound)}
              title={`Tocar ${sound.name} pra todo mundo`}
            >
              {sound.name}
            </button>
          ))}
        </div>
      )}

      {/* Subir e apagar moram na janela de configuracoes: aqui e o lugar de
          TOCAR no meio do jogo, e gerenciar biblioteca no meio de uma call
          competitiva nao e o caso de uso. */}
      <p className={styles.hint}>Adicionar ou apagar sons: Configurações &rsaquo; Soundboard.</p>
    </div>
  );
}

/**
 * Seção "Soundboard" da janela de configurações: gerenciar a biblioteca.
 *
 * Separada do painel da barra de controles de propósito — lá é AÇÃO (tocar
 * pra todo mundo, no meio do jogo), aqui é CONFIGURAÇÃO (subir, ouvir só pra
 * si, apagar). Mesma divisão do volume: card no tile durante a call, lista
 * completa na janela.
 *
 * Não precisa do RoomContext: mexer na biblioteca é só HTTP.
 */
export function SoundboardSettings() {
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

  return (
    <div className={settingsStyles.field}>
      <span className={settingsStyles.fieldLabel}>Biblioteca compartilhada</span>
      <p className={settingsStyles.hint}>
        O que você sobe fica disponível pro grupo inteiro tocar — não é uma coleção sua. Áudio de
        até 1 MB (um efeito de 1 a 3 segundos).
      </p>

      {error && (
        <p className={settingsStyles.warning} role="alert">
          {error}
        </p>
      )}

      {sounds === null && !error && <p className={settingsStyles.hint}>Carregando…</p>}

      {sounds !== null && sounds.length === 0 && (
        <p className={settingsStyles.hint}>Nenhum som ainda.</p>
      )}

      {sounds?.map((sound) => {
        const canDelete = !!user && (user.isAdmin || sound.uploadedBy === user.id);
        return (
          <div key={sound.id} className={styles.settingsRow}>
            <span className={styles.settingsName}>{sound.name}</span>
            {/* Toca só pra você: aqui é o lugar de conferir o som antes de
                soltar pro grupo, não de tocar pro grupo. */}
            <button
              type="button"
              className="lk-button"
              onClick={() => playSfx(sound.url, { gain: 1 })}
              title="Ouvir só pra você"
            >
              Ouvir
            </button>
            {canDelete && (
              <button
                type="button"
                className="lk-button"
                onClick={() => handleDelete(sound)}
                title="Apagar da biblioteca — vale pra todo mundo"
              >
                Apagar
              </button>
            )}
          </div>
        );
      })}

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

      <p className={settingsStyles.hint}>
        Pra calar a soundboard de uma pessoa específica sem perder a voz dela, use o controle
        &quot;Soundboard&quot; dela na seção Mixer.
      </p>
    </div>
  );
}
