import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
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
      { rel: 'mask-icon', url: '/images/concord-mark.svg', color: '#4c3ddb' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#070707',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-lk-theme="default">
        <AppToaster />
        {children}
      </body>
    </html>
  );
}
