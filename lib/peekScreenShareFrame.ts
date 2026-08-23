// "Espiar" UM quadro de uma transmissao que voce ainda nao esta assistindo,
// so pra ter o que borrar atras do botao "Assistir".
//
// O CUSTO, dito com todas as letras: transmissao nova chega desassinada de
// proposito (ver CallStage.tsx) — ninguem entra na tela dos outros sem pedir e
// a banda so e gasta no clique. Pra ter um quadro, alguem precisa receber
// video. Entao aqui a assinatura fica de pe pelo tempo de chegar o primeiro
// quadro decodificado (tipicamente menos de um segundo) e cai logo em seguida.
// E um custo de uma vez por transmissao, nao um fluxo continuo.
//
// Se nada chegar em `TIMEOUT_MS`, desiste e devolve `null` — o tile fica no
// fundo liso, que era o comportamento anterior.

import { RemoteTrackPublication, RemoteVideoTrack, Track } from 'livekit-client';
import { captureFrame } from '@/lib/CallParticipantTile';

const TIMEOUT_MS = 6000;

/** Espera `publication.track` aparecer (o TrackSubscribed pode nao ter vindo
 *  ainda quando a publicacao e listada). */
function esperarTrack(
  publication: RemoteTrackPublication,
  sinal: AbortSignal,
): Promise<RemoteVideoTrack | null> {
  return new Promise((resolve) => {
    const pronto = () => {
      const track = publication.track;
      return track && track.kind === Track.Kind.Video ? (track as RemoteVideoTrack) : null;
    };
    const jaTem = pronto();
    if (jaTem) {
      resolve(jaTem);
      return;
    }
    // Polling curto em vez de listener: `TrackSubscribed` e do Room, e este
    // modulo nao tem (nem deveria ter) o Room. 20 tentativas de 150ms cobrem
    // o mesmo intervalo do timeout.
    const timer = setInterval(() => {
      if (sinal.aborted) {
        clearInterval(timer);
        resolve(null);
        return;
      }
      const track = pronto();
      if (track) {
        clearInterval(timer);
        resolve(track);
      }
    }, 150);
    sinal.addEventListener('abort', () => {
      clearInterval(timer);
      resolve(null);
    });
  });
}

/** Resolve quando o <video> tem pelo menos um quadro decodificado. */
function esperarQuadro(video: HTMLVideoElement, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }
    const pronto = () => {
      video.removeEventListener('loadeddata', pronto);
      resolve();
    };
    video.addEventListener('loadeddata', pronto);
    sinal.addEventListener('abort', () => {
      video.removeEventListener('loadeddata', pronto);
      resolve();
    });
  });
}

/**
 * Captura um quadro da transmissao e devolve o data URL (ou `null`).
 *
 * NAO mexe na assinatura: quem chama decide quando desassinar — assim o custo
 * de banda fica visivel no mesmo lugar que decide sobre ele (CallStage).
 */
export async function peekScreenShareFrame(
  publication: RemoteTrackPublication,
): Promise<string | null> {
  const controle = new AbortController();
  const timeout = setTimeout(() => controle.abort(), TIMEOUT_MS);
  let video: HTMLVideoElement | null = null;
  let track: RemoteVideoTrack | null = null;
  try {
    track = await esperarTrack(publication, controle.signal);
    if (!track || controle.signal.aborted) {
      return null;
    }
    // `attach()` e tipado como HTMLMediaElement; numa track de VIDEO o que
    // volta e sempre um <video>.
    const el = track.attach() as HTMLVideoElement;
    video = el;
    el.muted = true;
    el.playsInline = true;
    // Precisa estar no documento: um <video> solto nao e garantido decodificar
    // em todo navegador. Fica de 1px e invisivel, fora do fluxo.
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    await el.play().catch(() => {
      // Politica de autoplay: com `muted` nao deveria barrar, e mesmo barrado
      // o `loadeddata` costuma vir. Nao ha o que fazer aqui alem de seguir.
    });
    await esperarQuadro(el, controle.signal);
    if (controle.signal.aborted) {
      return null;
    }
    return captureFrame(el);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    if (video) {
      track?.detach(video);
      video.remove();
    }
  }
}
