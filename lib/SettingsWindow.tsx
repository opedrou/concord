'use client';

// Janela única de configurações, estilo Discord: navegação de seções à
// esquerda, conteúdo à direita.
//
// Substitui o antigo `SettingsPanel` — um popover de 20rem ancorado acima da
// barra de usuário. O popover morreu porque as coisas que precisavam entrar
// (volume geral, lista de pessoas do mixer, ganho de entrada, seletores de
// dispositivo) não cabem em 20rem, e porque ter as configurações de conta num
// lugar e as de áudio em outro já era a reclamação original.
//
// A casca (portal pro <body>, backdrop, Escape, aviso de chamada em andamento)
// é o `<AccountOverlay />`, que já existia pra Perfil e Admin — aqui ele só
// ganhou um miolo com navegação.
//
// ONDE ISTO MORA: dentro da `ChannelSidebar`, que é IRMÃ da chamada. É de
// propósito e não pode mudar: mover pra dentro do `PageClientImpl` faria a
// janela desmontar a cada troca de canal e reintroduziria o bug que derrubava
// a call ao abrir o perfil. Tudo que precisa do LiveKit chega por Context
// (MicProcessorContext, VolumeMixerContext, CallStateContext).

import * as React from 'react';
import { AccountOverlay } from '@/lib/AccountOverlay';
import { AudioSettingsSection } from '@/lib/AudioSettingsSection';
import { MasterVolumeControl, MixerParticipantList } from '@/lib/MixerSection';
import { ProfileClientImpl } from '@/app/profile/ProfileClientImpl';
import { AdminDashboard } from '@/app/admin/AdminDashboard';
import { JoinLeaveSoundsSettings } from '@/lib/JoinLeaveSounds';
import { FocusModeSettings } from '@/lib/FocusModeControl';
import { SoundboardSettings } from '@/lib/Soundboard';
import styles from '../styles/SettingsWindow.module.css';

export type SettingsSection =
  | 'profile'
  | 'voice'
  | 'mixer'
  | 'focus'
  | 'soundboard'
  | 'notifications'
  | 'admin';

interface SectionDef {
  id: SettingsSection;
  label: string;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Perfil' },
  { id: 'voice', label: 'Voz e vídeo' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'focus', label: 'Modo foco' },
  { id: 'soundboard', label: 'Soundboard' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'admin', label: 'Admin', adminOnly: true },
];

export function SettingsWindow(props: {
  username: string;
  isAdmin: boolean;
  initialSection: SettingsSection;
  onClose: () => void;
  onLogout?: () => void;
}) {
  const [section, setSection] = React.useState<SettingsSection>(props.initialSection);
  const visible = SECTIONS.filter((s) => !s.adminOnly || props.isAdmin);
  const current = visible.find((s) => s.id === section) ?? visible[0];

  return (
    <AccountOverlay title="Configurações" size="large" onClose={props.onClose}>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Seções das configurações">
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.navItem} ${s.id === current.id ? styles.navItemActive : ''}`}
              aria-current={s.id === current.id ? 'true' : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
          {props.onLogout && (
            <>
              <span className={styles.navDivider} />
              <button
                type="button"
                className={`${styles.navItem} ${styles.navItemDanger}`}
                onClick={() => {
                  props.onClose();
                  props.onLogout?.();
                }}
              >
                Sair
              </button>
            </>
          )}
        </nav>

        <div className={styles.content}>
          {current.id === 'profile' && <ProfileClientImpl onClose={props.onClose} />}
          {current.id === 'voice' && <AudioSettingsSection />}
          {current.id === 'mixer' && (
            <>
              <MasterVolumeControl />
              <MixerParticipantList />
            </>
          )}
          {current.id === 'focus' && <FocusModeSettings />}
          {current.id === 'soundboard' && <SoundboardSettings />}
          {current.id === 'notifications' && <JoinLeaveSoundsSettings />}
          {current.id === 'admin' && (
            <AdminDashboard currentUsername={props.username} onClose={props.onClose} />
          )}
        </div>
      </div>
    </AccountOverlay>
  );
}
