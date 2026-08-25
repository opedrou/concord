'use client';

import * as React from 'react';
import Link from 'next/link';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { uploadAvatar, changePassword, apiErrorMessage } from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH, checkPassword } from '@/lib/passwordPolicy';
import { resizeImageClientSide } from '@/lib/resizeImageClientSide';
import { dominantColorFromBlob } from '@/lib/dominantColor';
import { Avatar } from '@/lib/Avatar';
import styles from '../../styles/Login.module.css';

// Onde a pessoa troca a propria foto de perfil e a propria senha. So a
// propria conta em ambos os casos — POST /api/avatars e POST
// /api/auth/change-password sempre agem sobre o usuario da sessao, nunca
// aceitam id de outra conta no corpo da requisicao.
export function ProfileClientImpl(props: { onClose?: () => void } = {}) {
  const { user, loading } = useCurrentUser({ redirectToLogin: true });
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  const [avatarSuccess, setAvatarSuccess] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [passwordBusy, setPasswordBusy] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      // A URL que vem de /api/auth/me ja e versionada no servidor
      // (?v=<avatar_path atual>, ver avatarUrlFor em lib/avatars.ts) —
      // nao precisa mais inventar cache-bust com Date.now() aqui: a URL so
      // muda quando o arquivo muda de verdade, o que deixa o navegador
      // cachear a imagem de forma agressiva sem risco de mostrar foto velha.
      setAvatarUrl(user.avatarUrl);
    }
  }, [user]);

  const handleFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    setAvatarBusy(true);
    setAvatarError(null);
    setAvatarSuccess(false);
    try {
      const resized = await resizeImageClientSide(file);
      // Cor dominante calculada AQUI, uma vez na vida da foto, e mandada junto
      // do upload — e o que pinta o tile de camera desligada na chamada (U1).
      // Fica no cliente pelo mesmo motivo do redimensionamento acima: o
      // servidor nao ganha dependencia de decodificacao de imagem. Se falhar,
      // vem null e a foto entra sem cor (o tile usa o `--accent`).
      const color = await dominantColorFromBlob(resized);
      const result = await uploadAvatar(resized, color);
      // Resposta do upload ja vem com a URL versionada com o arquivo novo
      // (ver avatarUrlFor) — troca o estado direto, sem gambiarra de
      // timestamp, e a foto nova aparece na hora nesta mesma pagina.
      setAvatarUrl(result.avatarUrl);
      setAvatarSuccess(true);
    } catch (err) {
      setAvatarError(apiErrorMessage(err));
    } finally {
      setAvatarBusy(false);
    }
  }, []);

  const handlePasswordSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setPasswordError(null);
      setPasswordSuccess(false);
      // Feedback de UX — quem decide e o servidor (POST /api/auth/change-password).
      const problem = checkPassword(newPassword, user?.username);
      if (problem) {
        setPasswordError(problem.reason);
        return;
      }
      setPasswordBusy(true);
      try {
        await changePassword({ currentPassword, newPassword, confirmPassword });
        setPasswordSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } catch (err) {
        setPasswordError(apiErrorMessage(err));
      } finally {
        setPasswordBusy(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, user?.username],
  );

  if (loading || !user) {
    return <p>Carregando...</p>;
  }

  return (
    <div className={styles.form}>
      {/* Cabecalho do perfil no projeto de design: faixa em gradiente e a foto
          grande cavalgando a borda dela. O resto desta tela continua sendo o
          formulario de sempre (trocar foto / trocar senha) — o design desenha
          um perfil de LEITURA, com bio e distintivos, e nada disso existe no
          banco; inventar campos aqui seria inventar produto. */}
      <div className={styles.profileBanner} aria-hidden="true" />
      <div className={styles.profileIdentity}>
        <span className={styles.profileAvatar}>
          <Avatar username={user.username} avatarUrl={avatarUrl} size={104} />
        </span>
        <span className={styles.profileName}>{user.username}</span>
      </div>

      <div className={styles.field}>
        <label htmlFor="avatar-input">Trocar foto</label>
        <input
          id="avatar-input"
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          disabled={avatarBusy}
        />
      </div>

      {avatarBusy && <p>Enviando...</p>}
      {avatarError && <p className={styles.error}>{avatarError}</p>}
      {avatarSuccess && !avatarBusy && <p>Foto atualizada.</p>}

      <hr style={{ width: '100%', border: 'none', borderTop: '1px solid var(--border)' }} />

      <form className={styles.form} onSubmit={handlePasswordSubmit}>
        <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Trocar senha</h2>

        <div className={styles.field}>
          <label htmlFor="current-password">Senha atual</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={passwordBusy}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="new-password">Nova senha</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={passwordBusy}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="confirm-password">Confirmar nova senha</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={passwordBusy}
            required
          />
        </div>

        {passwordError && <p className={styles.error}>{passwordError}</p>}
        {passwordSuccess && !passwordBusy && (
          <p>
            Senha atualizada. Se você estiver logado em outro dispositivo, essa sessão continua
            valendo até expirar — trocar a senha não desconecta os outros de propósito.
          </p>
        )}

        <button type="submit" className="lk-button" disabled={passwordBusy}>
          {passwordBusy ? 'Salvando...' : 'Salvar nova senha'}
        </button>
      </form>

      {/* Sobreposto (durante uma chamada) o "Voltar" fecha a janela; um <Link>
          aqui navegaria e derrubaria a chamada. Na rota /profile, sem
          `onClose`, continua sendo o link de sempre. */}
      {props.onClose ? (
        <button type="button" className="lk-button" onClick={props.onClose}>
          Voltar
        </button>
      ) : (
        <Link href="/" style={{ textAlign: 'center' }}>
          Voltar
        </Link>
      )}
    </div>
  );
}
