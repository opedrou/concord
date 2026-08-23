// ORDEM IMPORTA: o tema do LiveKit primeiro, o nosso por cima. Estava ao
// contrario, e como as duas folhas disputam os mesmos `--lk-*` na mesma
// especificidade, quem chegava depois (a lib) ganhava. Ver a nota longa em
// styles/globals.css.
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import '../styles/globals.css';
import type { Metadata, Viewport } from 'next';
import { AppToaster } from '@/lib/AppToaster';

export const metadata: Metadata = {
  title: {
    default: 'Concord',
    template: '%s',
  },
  // App de voz self-hosted para o grupo. Construido sobre LiveKit (tecnologia
  // de WebRTC), mas o produto e o nome sao proprios — nada de branding do
  // "LiveKit Meet" original aqui.
  description: 'Concord — chamadas de voz e compartilhamento de tela self-hosted para o grupo.',
  openGraph: {
    siteName: 'Concord',
  },
  icons: {
    icon: {
      rel: 'icon',
      url: '/favicon.ico',
    },
    apple: [
      {
        rel: 'apple-touch-icon',
        url: '/images/concord-apple-touch.png',
        sizes: '512x512',
      },
      { rel: 'mask-icon', url: '/images/concord-mark.svg', color: '#9d4edd' },
    ],
  },
};

export const viewport: Viewport = {
  // Barra do navegador no mobile, na cor do papel do tema (ver styles/globals.css).
  themeColor: '#221d18',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* As duas familias do projeto de design: Bricolage Grotesque para
            titulos, Hanken Grotesk para texto. Via <link> e nao `next/font`
            de proposito — `next/font` baixa a fonte no BUILD, e o build roda
            no Coolify; um hiccup de rede la viraria deploy quebrado por causa
            de tipografia. Aqui o pior caso e cair no system-ui. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body data-lk-theme="default">
        {/* Aplica o tema salvo ANTES da primeira pintura. Sem isto a pagina
            pinta escura e so vira clara quando o React monta — o "flash" que
            todo app com tema claro/escuro tem se deixa isso pro cliente.
            Precisa ser inline e sincrono; um efeito de componente ja e tarde.
            Ver lib/ThemeToggle.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement.dataset;if(localStorage.getItem('concord:theme')==='light')d.concordTheme='light';if(localStorage.getItem('concord:ring')==='recortado')d.concordRing='recortado'}catch(e){}",
          }}
        />
        <AppToaster />
        {children}
      </body>
    </html>
  );
}
