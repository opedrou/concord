'use client';

// Toaster da app. Existe como componente proprio (em vez de `<Toaster />`
// direto no layout) por dois motivos:
//
//  1. O botao de fechar exige o render-prop `<Toaster>{(t) => ...}</Toaster>`,
//     e funcao nao atravessa a fronteira server -> client. `app/layout.tsx` e
//     Server Component, entao o render-prop precisa morar num arquivo
//     'use client'.
//  2. Concentra o tema num lugar so: os ~9 call sites de `toast()` espalhados
//     pelo app nao precisam saber nada de aparencia.
//
// TEMA: `data-lk-theme="default"` esta no <body> (ver app/layout.tsx), e o
// Toaster e filho do body — entao as variaveis --lk-* resolvem normalmente
// aqui. Nao e preciso repetir valores literais.

import * as React from 'react';
import { Toaster, ToastBar, toast } from 'react-hot-toast';
import { CloseIcon } from '@/lib/icons';
import styles from '../styles/AppToaster.module.css';

/** Quanto tempo um aviso fica na tela antes de sumir sozinho.
 *
 * Todos somem, inclusive erro — a decisao e deliberada: nenhum aviso desta
 * app exige acao imediata dentro do proprio aviso, e erro que fica pendurado
 * pra sempre em cima do video incomoda mais do que ajuda. Quem perdeu a
 * mensagem reproduz o erro de novo. O X esta la pra dispensar antes. */
const DEFAULT_DURATION_MS = 6000;

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      // Fora do caminho do video e da barra de controles (que e centralizada
      // embaixo). O default da lib e top-center, bem no meio da transmissao.
      gutter={8}
      toastOptions={{
        duration: DEFAULT_DURATION_MS,
        style: {
          // Estes precisam ser inline: a classe que o goober injeta em runtime
          // entra no <head> depois das nossas folhas e venceria um CSS module.
          background: 'var(--lk-bg3, #1e1e1e)',
          color: 'var(--lk-fg, #fff)',
          border: '1px solid var(--lk-border-color, rgba(255,255,255,0.1))',
          borderRadius: 'var(--lk-border-radius, 0.5rem)',
          boxShadow: 'var(--lk-box-shadow, 0 0.5rem 1.5rem rgba(0,0,0,0.35))',
          // Menor e mais apertado que o default da lib (16px / 8px 10px):
          // o pedido era "discreto", nao um cartao.
          fontSize: '0.8rem',
          padding: '0.55rem 0.7rem',
          maxWidth: '22rem',
        },
      }}
    >
      {(t) => (
        <ToastBar toast={t}>
          {({ icon, message }) => (
            <div className={styles.body}>
              <span className={styles.icon}>{icon}</span>
              {/* O `message` do react-hot-toast ja vem embrulhado num <div>
                  com margin propria; a classe so controla a quebra de linha. */}
              <div className={styles.message}>{message}</div>
              <button
                type="button"
                className={styles.close}
                onClick={() => toast.dismiss(t.id)}
                aria-label="Fechar aviso"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
