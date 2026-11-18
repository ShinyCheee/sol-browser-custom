import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t } from './i18n';
import { Pairs, pretty } from './NetworkDetail';
import SolSelect from './SolSelect';

export type NetworkDraft = {
  Url: string;
  Method: string;
  Headers: Record<string, string>;
  Body: string;
  Status: number;
  Delay: number;
  Mode: string;
};

export type ReplayResult = {
  error?: string;
  reason?: string;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  truncated?: boolean;
};

export type NetworkTools = {
  tabId: string;
  console: { level: string; text: string }[];
  mock: NetworkDraft | null;
  result: ReplayResult | null;
  busy: boolean;
  mockBusy?: boolean;
  paused?: boolean;
  preserve?: boolean;
};

export const emptyNetworkDraft = (): NetworkDraft => ({
  Url: '',
  Method: 'GET',
  Headers: { 'Content-Type': 'application/json' },
  Body: '',
  Status: 200,
  Delay: 0,
  Mode: 'response',
});

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MOCK_MODES = ['response', 'invalid', 'empty', 'timeout'];

export function NetworkComposer({
  draft,
  setDraft,
  tools,
  tabId,
}: {
  draft: NetworkDraft;
  setDraft: (draft: NetworkDraft) => void;
  tools: NetworkTools;
  tabId: string;
}) {
  const [headers, setHeaders] = useState(() => JSON.stringify(draft.Headers, null, 2));
  const [error, setError] = useState('');

  useEffect(() => {
    setHeaders(JSON.stringify(draft.Headers, null, 2));
    setError('');
  }, [draft.Headers]);

  const effectiveTabId = tabId || tools.tabId;

  const run = (type: 'network.replay' | 'network.mock') => {
    try {
      const parsed = JSON.parse(headers);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(v => typeof v !== 'string')) {
        throw new Error();
      }
      setError('');
      send({ type, id: effectiveTabId, input: JSON.stringify({ ...draft, Headers: parsed }) });
    } catch {
      setError(t('Les en-têtes doivent être un objet JSON contenant des valeurs texte.', 'Headers must be a JSON object with string values.'));
    }
  };

  const disabled = tools.busy || tools.mockBusy || !effectiveTabId || effectiveTabId !== tools.tabId || !draft.Url;

  const preset = (status: number) =>
    setDraft({
      ...draft,
      Status: status,
      Mode: 'response',
      Headers: { ...draft.Headers, 'Content-Type': 'application/json' },
      Body: JSON.stringify({ error: status === 401 ? 'unauthorized' : 'internal_server_error' }, null, 2),
    });

  const failure = tools.result?.error;
  const resultError =
    failure === 'invalid'
      ? t('Vérifiez l’URL HTTP/HTTPS, les en-têtes, les limites et les valeurs masquées.', 'Check the HTTP/HTTPS URL, headers, limits and masked values.')
      : failure === 'canceled'
        ? t('Envoi annulé.', 'Request canceled.')
        : failure === 'timeout'
          ? t('La requête a dépassé le délai de 20 secondes.', 'The request exceeded the 20-second timeout.')
          : failure === 'mock-unavailable'
            ? t('La simulation n’a pas pu être activée sur cette page.', 'The mock could not be enabled in this page.')
            : failure
              ? `${t('La requête n’a pas abouti.', 'The request failed.')} ${tools.result?.reason ?? ''}`
              : '';

  const resultContentType =
    Object.entries(tools.result?.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  const formattedResultBody = useMemo(
    () => pretty(tools.result?.body ?? '', resultContentType),
    [tools.result?.body, resultContentType],
  );

  return (
    <div className="net-composer">
      <div className="net-response-presets" role="group" aria-label={t('Scénarios de réponse', 'Response scenarios')}>
        <Button className="pill-action" onClick={() => preset(401)}>401 · {t('Non autorisé', 'Unauthorized')}</Button>
        <Button className="pill-action" onClick={() => preset(500)}>500 · {t('Erreur serveur', 'Server error')}</Button>
        <span className="net-note">{t('Prépare le scénario ; activez ensuite la simulation.', 'Prepares the scenario; then enable the mock.')}</span>
      </div>

      <p className="net-note">
        {t(
          'Envoi manuel depuis Sol, sans cookies ni identifiants repris du site. Les redirections ne sont pas suivies. Les secrets reconnus sont masqués ; remplacez les valeurs masquées avant d’envoyer.',
          'Manual request from Sol, without site cookies or credentials. Redirects are not followed. Recognized secrets are masked; replace masked values before sending.',
        )}
      </p>

      <div className="net-compose-row">
        <label>
          {t('Méthode', 'Method')}
          <SolSelect id="network-method" label={t('Méthode', 'Method')} value={METHODS.indexOf(draft.Method)} options={METHODS} onChange={index => setDraft({ ...draft, Method: METHODS[index] })} />
        </label>
        <label className="net-compose-url">
          URL
          <input type="url" placeholder="https://…" value={draft.Url} onChange={e => setDraft({ ...draft, Url: e.target.value })} />
        </label>
      </div>

      <div className="net-compose-row">
        <label>
          {t('En-têtes (JSON)', 'Headers (JSON)')}
          <textarea value={headers} onChange={e => setHeaders(e.target.value)} />
        </label>
        <label>
          {t('Corps', 'Body')}
          <textarea value={draft.Body} onChange={e => setDraft({ ...draft, Body: e.target.value })} maxLength={20000} />
        </label>
      </div>

      <div className="net-compose-actions">
        <Button variant="ghost" size="sm" whileHover={undefined} className="pill-action" disabled={disabled} onClick={() => run('network.replay')}>
          {tools.busy ? t('Envoi…', 'Sending…') : t('Envoyer la requête', 'Send request')}
        </Button>
        {tools.busy && (
          <Button variant="ghost" size="sm" whileHover={undefined} className="pill-action" onClick={() => send({ type: 'network.cancel', id: effectiveTabId })}>
            {t('Annuler', 'Cancel')}
          </Button>
        )}
      </div>

      <details className="net-mock-options">
        <summary>{t('Simuler cette URL dans la page', 'Mock this URL in the page')}</summary>
        <p className="net-note">
          {t(
            'Une règle par onglet, URL et méthode exactes, uniquement Fetch/XHR. Rien n’est enregistré. Les réponses de service workers peuvent éviter l’interception.',
            'One exact URL and method rule per tab, for Fetch/XHR only. Nothing is saved. Service worker responses may bypass interception.',
          )}
        </p>
        <div className="net-compose-row">
          <label>
            {t('Réponse', 'Response')}
            <SolSelect
              id="network-mock"
              label={t('Réponse', 'Response')}
              value={MOCK_MODES.indexOf(draft.Mode)}
              options={[t('Corps personnalisé', 'Custom body'), t('JSON invalide', 'Invalid JSON'), t('Réponse vide', 'Empty response'), t('Expiration', 'Timeout')]}
              onChange={index => setDraft({ ...draft, Mode: MOCK_MODES[index] })}
            />
          </label>
          <label>
            {t('Statut', 'Status')}
            <input type="number" min={200} max={599} value={draft.Status} onChange={e => setDraft({ ...draft, Status: Number(e.target.value) })} />
          </label>
          <label>
            {t('Délai (ms)', 'Delay (ms)')}
            <input type="number" min={0} max={10000} value={draft.Delay} onChange={e => setDraft({ ...draft, Delay: Number(e.target.value) })} />
          </label>
        </div>
        <Button variant="ghost" size="sm" whileHover={undefined} className="pill-action" disabled={disabled} onClick={() => run('network.mock')}>
          {t('Activer la simulation', 'Enable mock')}
        </Button>
      </details>

      {error && <p role="alert" className="net-note">{error}</p>}
      {!!tools.result && (
        <section className="net-section" aria-label={t('Résultat', 'Result')}>
          <h3>{t('Résultat du rejeu', 'Replay result')} {tools.result.status && `· ${tools.result.status}`}</h3>
          {resultError ? (
            <p role="alert" className="net-note">{resultError}</p>
          ) : (
            <>
              <pre className="net-body">{formattedResultBody}</pre>
              {tools.result.truncated && <p className="net-note">{t('Seul le début de la réponse est affiché.', 'Only the beginning of the response is shown.')}</p>}
              <details>
                <summary>{t('En-têtes de la réponse', 'Response headers')}</summary>
                <Pairs pairs={tools.result.headers ?? {}} />
              </details>
            </>
          )}
        </section>
      )}
    </div>
  );
}
