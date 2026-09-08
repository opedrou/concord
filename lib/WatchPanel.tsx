'use client';

// "Assistir junto" (W5): botão na barra de controle que abre um modal pra
// colar um link do YouTube, e a barra de controles que fica sob o player.
//
// Mesmo formato do CallPeoplePanel: botão + AccountOverlay, dentro do
// RoomContext. A sessão em si mora no WatchContext.

import * as React from 'react';
import { AccountOverlay } from '@/lib/AccountOverlay';
import { PlayIcon } from '@/lib/icons';
import { useWatch } from '@/lib/WatchContext';
import { fetchJellyfinItems, type JellyfinItem } from '@/lib/api-client';
import { positionAt } from '@/lib/watchSync';
import styles from '../styles/WatchPanel.module.css';

export function WatchPanel() {
  const watch = useWatch();
  const [open, setOpen] = React.useState(false);
  if (!watch) {
    return null;
  }

  const emSessao = watch.sync.timeline !== null;

  return (
    <>
      <button
        type="button"
        className="lk-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={emSessao ? 'Assistindo junto' : 'Assistir junto'}
        data-active={emSessao || undefined}
        onClick={() => setOpen(true)}
      >
        <PlayIcon size={18} />
      </button>
      {open && <WatchModal onClose={() => setOpen(false)} />}
    </>
  );
}

function WatchModal({ onClose }: { onClose: () => void }) {
  const watch = useWatch();
  const [input, setInput] = React.useState('');
  const [erro, setErro] = React.useState<string | null>(null);

  if (!watch) {
    return null;
  }
  const { sync, open: abrir } = watch;
  const emSessao = sync.timeline !== null;

  const submeter = (event: React.FormEvent) => {
    event.preventDefault();
    if (!abrir(input)) {
      setErro('Não reconheci um vídeo do YouTube nesse link.');
      return;
    }
    setErro(null);
    onClose();
  };

  return (
    <AccountOverlay title="Assistir junto" size="narrow" onClose={onClose}>
      {emSessao ? (
        <div className={styles.body}>
          <p className={styles.hint}>Outro link troca pra todos.</p>
          <button
            type="button"
            className={`lk-button ${styles.stop}`}
            onClick={() => {
              sync.stop();
              onClose();
            }}
          >
            Encerrar pra todo mundo
          </button>
        </div>
      ) : null}
      <form className={styles.body} onSubmit={submeter}>
        <label className={styles.label} htmlFor="watch-url">
          Link do YouTube
        </label>
        <input
          id="watch-url"
          className={styles.input}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setErro(null);
          }}
          placeholder="https://youtu.be/..."
          autoFocus
        />
        {erro && <p className={styles.erro}>{erro}</p>}
        <p className={styles.hint}>Todo mundo assiste e controla.</p>
        <button type="submit" className={`lk-button ${styles.submit}`} disabled={!input.trim()}>
          {emSessao ? 'Trocar o vídeo' : 'Começar'}
        </button>
      </form>
      <JellyfinBrowser onClose={onClose} />
    </AccountOverlay>
  );
}

/**
 * Navegar a biblioteca do Jellyfin. Some inteira quando o servidor não está
 * configurado (a rota devolve 503) — quem não usa Jellyfin não vê uma seção
 * quebrada, vê nada.
 */
function JellyfinBrowser({ onClose }: { onClose: () => void }) {
  const watch = useWatch();
  const [items, setItems] = React.useState<JellyfinItem[] | null>(null);
  const [indisponivel, setIndisponivel] = React.useState(false);
  const [trilha, setTrilha] = React.useState<{ id: string; name: string }[]>([]);

  const parentId = trilha.length > 0 ? trilha[trilha.length - 1].id : undefined;

  React.useEffect(() => {
    let cancelado = false;
    setItems(null);
    fetchJellyfinItems(parentId)
      .then((lista) => {
        if (!cancelado) setItems(lista);
      })
      .catch(() => {
        if (!cancelado) setIndisponivel(true);
      });
    return () => {
      cancelado = true;
    };
  }, [parentId]);

  if (indisponivel || !watch) {
    return null;
  }

  return (
    <div className={styles.body}>
      <span className={styles.label}>Da biblioteca</span>
      {trilha.length > 0 && (
        <button
          type="button"
          className={`lk-button ${styles.barButton}`}
          onClick={() => setTrilha((atual) => atual.slice(0, -1))}
        >
          ← {trilha[trilha.length - 1].name}
        </button>
      )}
      {items === null ? (
        <p className={styles.hint}>Carregando…</p>
      ) : items.length === 0 ? (
        <p className={styles.hint}>Nada aqui.</p>
      ) : (
        <ul className={styles.lista}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.item}
                onClick={() => {
                  // Pasta, série e temporada navegam; o resto abre a sessão.
                  if (item.type === 'Folder' || item.type === 'Series' || item.type === 'Season') {
                    setTrilha((atual) => [...atual, { id: item.id, name: item.name }]);
                    return;
                  }
                  watch.openJellyfin(item.id);
                  onClose();
                }}
              >
                <span>{item.name}</span>
                {item.year && <span className={styles.ano}>{item.year}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PROBLEMA: Record<string, string> = {
  'embed-bloqueado': 'O dono desse vídeo não deixa assistir fora do YouTube.',
  'nao-carregou': 'Não deu pra carregar o player.',
  'live-sem-dvr': 'Essa live não deixa voltar atrás, então a sincronia vai ficar grosseira.',
};

/**
 * Os controles do player. Existem porque o player roda com `controls: 0` — os
 * controles nativos do YouTube não propagam nada, e brigariam com o loop de
 * sincronia (ver o comentário no topo de YouTubeWatchPlayer.tsx). Daqui,
 * play/pause/pular viram comando pra sala inteira.
 */
export function WatchBar() {
  const watch = useWatch();
  if (!watch?.sync.timeline) {
    return null;
  }
  const { sync, problem } = watch;
  // O early return acima ja garante que existe, mas o narrowing nao sobrevive
  // ao acesso via `sync` — daí a constante local.
  const timeline = watch.sync.timeline;
  if (!timeline) {
    return null;
  }
  const tocando = timeline.playing;

  const pular = (deltaMs: number) => {
    // `positionAt` e nao `timeline.positionMs`: o campo cru e a posicao no
    // instante em que a linha do tempo foi ancorada, que pode ter sido ha
    // minutos. Pular 10s a partir dele voltaria o filme pra onde ele estava
    // quando alguem apertou play.
    sync.seek(Math.max(0, positionAt(timeline, Date.now()) + deltaMs));
  };

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={`lk-button ${styles.barButton}`}
        onClick={() => pular(-10_000)}
        title="Voltar 10 segundos, pra todo mundo"
      >
        −10s
      </button>
      <button
        type="button"
        className={`lk-button ${styles.barButton}`}
        onClick={() => (tocando ? sync.pause() : sync.play())}
        title={tocando ? 'Pausar pra todo mundo' : 'Continuar pra todo mundo'}
      >
        {tocando ? 'Pausar' : 'Continuar'}
      </button>
      <button
        type="button"
        className={`lk-button ${styles.barButton}`}
        onClick={() => pular(10_000)}
        title="Pular 10 segundos, pra todo mundo"
      >
        +10s
      </button>
      {problem && <span className={styles.problema}>{PROBLEMA[problem] ?? problem}</span>}
      {sync.lastEvent && sync.lastEvent.type !== 'hb' && (
        <span className={styles.evento}>
          {sync.lastEvent.by} {sync.lastEvent.type === 'pause' ? 'pausou' : 'mexeu no vídeo'}
        </span>
      )}
    </div>
  );
}
