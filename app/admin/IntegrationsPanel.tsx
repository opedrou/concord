'use client';

import * as React from 'react';
import {
  WebhookSettings,
  apiErrorMessage,
  fetchWebhookSettings,
  generateWebhookSecret,
  saveWebhookSettings,
  testWebhook,
  webhookTestMessage,
} from '@/lib/api-client';
import styles from '../../styles/Admin.module.css';

/**
 * Aba "Integrações": por enquanto só o webhook do botão de chamar pessoas.
 *
 * O formulário é write-only por decisão da rota, não por preguiça: a URL pode
 * carregar o token embutido, então o servidor nunca a devolve (ver
 * app/api/settings/webhook/route.ts). Por isso o campo nasce vazio mesmo com um
 * webhook já configurado, e o que aparece do estado atual é só o host.
 *
 * O segredo de assinatura segue a mesma lógica, e mais estrita: o valor aparece
 * na tela UMA vez, logo depois de gerado (é o único momento em que a API o
 * devolve), e some no próximo carregamento do painel. Daí o aviso em destaque —
 * quem não copiar na hora vai ter que regenerar e reconfigurar o n8n.
 */
export function IntegrationsPanel() {
  const [settings, setSettings] = React.useState<WebhookSettings | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const [url, setUrl] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const [generating, setGenerating] = React.useState(false);
  // Só é preenchido logo após gerar. Nunca vem do servidor em nenhum outro
  // momento, então não há como "reexibir" — recarregou a página, sumiu.
  const [freshSecret, setFreshSecret] = React.useState<string | null>(null);
  const [secretError, setSecretError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      setSettings(await fetchWebhookSettings());
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const onSave: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setActionError(null);
    setSaved(false);
    setTestResult(null);
    if (!url.trim()) {
      setActionError('Cole a URL do webhook.');
      return;
    }
    setSaving(true);
    try {
      setSettings(await saveWebhookSettings(url.trim()));
      // Limpa o campo depois de salvar: deixar o segredo na tela não ajuda em
      // nada, e o estado atual já aparece logo acima.
      setUrl('');
      setSaved(true);
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    setActionError(null);
    setSaved(false);
    setTestResult(null);
    setSaving(true);
    try {
      setSettings(await saveWebhookSettings(null));
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setActionError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const result = await testWebhook();
      setTestResult({ ok: result.ok, message: webhookTestMessage(result) });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const onGenerateSecret = async () => {
    setSecretError(null);
    setFreshSecret(null);
    setGenerating(true);
    try {
      const { secret } = await generateWebhookSecret();
      setFreshSecret(secret);
      setSettings((prev) => (prev ? { ...prev, hasSecret: true } : prev));
    } catch (err) {
      setSecretError(apiErrorMessage(err));
    } finally {
      setGenerating(false);
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
    <>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Webhook de chamada</h2>
        <p className={styles.muted}>
          Endereço https que o botão de chamar pessoas vai acionar (n8n, Home Assistant, script
          próprio). Como a URL costuma trazer um token, ela nunca é exibida de volta — só o destino.
        </p>

        {settings === null ? (
          <p className={styles.muted}>Carregando…</p>
        ) : settings.configured ? (
          <p className={styles.muted}>Configurado{settings.host ? ` — ${settings.host}` : ''}</p>
        ) : (
          <p className={styles.muted}>Nenhum webhook configurado.</p>
        )}

        <form className={styles.createForm} onSubmit={onSave}>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label htmlFor="webhook-url">
                {settings?.configured ? 'Substituir pela URL' : 'URL do webhook'}
              </label>
              <input
                id="webhook-url"
                type="url"
                placeholder="https://hook.exemplo/abc?token=…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button className="lk-button" type="submit" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            {settings?.configured && (
              <button
                className={`lk-button ${styles.dangerButton}`}
                type="button"
                disabled={saving}
                onClick={onRemove}
              >
                Remover
              </button>
            )}
          </div>
        </form>

        {saved && <p className={styles.muted}>Webhook salvo.</p>}
        {actionError && (
          <p className={styles.error} role="alert">
            {actionError}
          </p>
        )}

        <div className={styles.formRow}>
          <button
            className="lk-button"
            type="button"
            onClick={onTest}
            disabled={testing || !settings?.configured}
          >
            {testing ? 'Testando…' : 'Testar webhook'}
          </button>
          <p className={styles.muted}>
            Envia um POST assinado com <code>{'{ "test": true, … }'}</code> — o destino recebe uma
            chamada de verdade, marcada como teste.
          </p>
        </div>

        {testResult && (
          <p className={testResult.ok ? styles.muted : styles.error} role="status">
            {testResult.message}
          </p>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Segredo de assinatura</h2>
        <p className={styles.muted}>
          Todo POST vai assinado com HMAC-SHA256 nos headers <code>X-Concord-Timestamp</code> e{' '}
          <code>X-Concord-Signature</code>. Cole este segredo no n8n para ele conferir que a chamada
          veio daqui: a assinatura é{' '}
          <code>sha256=HMAC(segredo, timestamp + &quot;.&quot; + corpo)</code>, calculada sobre o
          corpo cru recebido.
        </p>

        {settings === null ? (
          <p className={styles.muted}>Carregando…</p>
        ) : settings.hasSecret ? (
          <p className={styles.muted}>Segredo configurado.</p>
        ) : (
          <p className={styles.muted}>Nenhum segredo. Gere um antes de testar.</p>
        )}

        <div className={styles.formRow}>
          <button
            className="lk-button"
            type="button"
            onClick={onGenerateSecret}
            disabled={generating}
          >
            {generating ? 'Gerando…' : settings?.hasSecret ? 'Gerar novo segredo' : 'Gerar segredo'}
          </button>
          {settings?.hasSecret && (
            <p className={styles.muted}>
              Gerar de novo invalida o atual — o n8n para de aceitar as chamadas até você colar o
              novo valor lá.
            </p>
          )}
        </div>

        {freshSecret && (
          <div className={styles.errorBox}>
            <p>
              <strong>Copie agora.</strong> Este valor não aparece de novo — nem recarregando a
              página. Se perder, gere outro e atualize o n8n.
            </p>
            <code style={{ wordBreak: 'break-all' }}>{freshSecret}</code>
          </div>
        )}

        {secretError && (
          <p className={styles.error} role="alert">
            {secretError}
          </p>
        )}
      </div>
    </>
  );
}
