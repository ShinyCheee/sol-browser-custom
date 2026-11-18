import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { Checkbox } from '@/components/motion/checkbox';
import { Input } from '@/components/motion/input';
import { onMessage, send } from './bridge';
import { t, useLang } from './i18n';
import { Icon } from './Icons';
import {
  emptyNetworkDraft,
  NetworkComposer,
  type NetworkDraft,
  type NetworkTools,
} from './NetworkComposer';
import { CopyAction, type Detail } from './NetworkDetail';
import { matchesRequest } from './networkFormat';
import {
  formatNetBytes,
  NetworkConsole,
  NetworkRequestView,
  type NetworkReq,
} from './NetworkTable';
import SolTabs from './SolTabs';

type Filter = 'all' | 'api' | 'errors';

const isApi = (r: NetworkReq) => r.type === 'XHR' || r.type === 'Fetch';
const isError = (r: NetworkReq) => !!r.failed || r.status >= 400;

export default function Panel() {
  useLang();
  const [items, setItems] = useState<NetworkReq[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tools, setTools] = useState<NetworkTools>({ tabId: '', console: [], mock: null, result: null, busy: false });
  const [mode, setMode] = useState<'network' | 'console' | 'compose'>('network');
  const [draft, setDraft] = useState<NetworkDraft>(emptyNetworkDraft);
  const [draftTab, setDraftTab] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'duration' | 'size'>('recent');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const activeTab = useRef('');
  const selectedRef = useRef<string | null>(null);

  const selectRequest = (id: string | null) => {
    selectedRef.current = id;
    setSelectedRequestId(id);
  };

  useEffect(() => {
    const off = onMessage(data => {
      const message = data as { panel?: string; items?: NetworkReq[] };
      if (message.panel === 'network') {
        setItems(message.items ?? []);
        const next = data as NetworkTools;
        if (activeTab.current && activeTab.current !== next.tabId) {
          setDetail(null);
          selectRequest(null);
          setMode('network');
          setDraft(emptyNetworkDraft());
          setDraftTab('');
          setQuery('');
        }
        activeTab.current = next.tabId;
        setTools(next);
        if (selectedRef.current && !message.items?.some(item => item.id === selectedRef.current)) {
          setDetail(null);
          selectRequest('');
        }
      }
      if (message.panel === 'network-detail') {
        const next = data as Detail;
        if (next.tabId === activeTab.current && (selectedRef.current === null || next.id === selectedRef.current)) {
          selectRequest(next.id);
          setDetail(next);
        }
      }
    });
    send({ type: 'network.ready' });
    return off;
  }, []);

  const shown = items
    .filter(r => matchesRequest(r, query) && (filter === 'api' ? isApi(r) : filter === 'errors' ? isError(r) : true))
    .reverse();

  if (sort !== 'recent') {
    shown.sort((a, b) => (sort === 'duration' ? (b.ms ?? 0) - (a.ms ?? 0) : b.size - a.size));
  }

  const lines = tools.console.filter(
    line =>
      line.text.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== 'errors' || line.level === 'error' || line.level === 'warning'),
  );

  const filters: [Filter, string, number][] = [
    ['all', t('Tout', 'All'), items.length],
    ['api', 'API', items.filter(isApi).length],
    ['errors', t('Erreurs', 'Errors'), items.filter(isError).length],
  ];

  const pauseLabel = tools.paused ? t('Reprendre la capture', 'Resume capture') : t('Mettre la capture en pause', 'Pause capture');
  const reloadLabel = t('Recharger la page', 'Reload page');
  const exportLabel = t('Exporter le journal JSON · requêtes, en-têtes et console', 'Export JSON log · requests, headers and console');
  const devtoolsLabel = t('DevTools natifs · F12', 'Native DevTools · F12');
  const clearLabel = t('Vider le journal', 'Clear log');

  return (
    <Card size="compact" className="sol-surface-card net">
      <header className="net-bar">
        <span className="net-title">{t('Outils dev', 'Dev tools')}</span>
        <Button
          variant="ghost"
          size="sm"
          whileHover={undefined}
          className="pill-action"
          title={t(
            'Ouvrir l’aide au développement de Sol AI, sans envoyer les journaux',
            'Open Sol AI development help without sending logs',
          )}
          onClick={() => send({ type: 'chat.toggle', id: 'developer' })}
        >
          Sol AI
        </Button>
        <SolTabs
          className="net-filters"
          value={mode}
          label={t('Outils réseau', 'Network tools')}
          change={value => {
            const key = value as typeof mode;
            setMode(key);
            if (key === 'compose' && !draftTab) setDraftTab(tools.tabId);
          }}
          items={[
            { value: 'network', label: <><Icon name="network" size={14} />{t('Requêtes', 'Requests')}</> },
            { value: 'console', label: <><Icon name="tools" size={14} />Console</> },
            { value: 'compose', label: <><Icon name="edit" size={14} />{t('Rejeu / Simulation', 'Replay / Mock')}</> },
          ]}
        />
        <span className="net-space" />
        <Button variant="ghost" size="sm" whileHover={undefined} className={`net-icon${tools.paused ? ' on' : ''}`} data-action="pause" aria-pressed={!!tools.paused} aria-label={pauseLabel} title={pauseLabel} onClick={() => send({ type: 'network.pause', id: tools.tabId, index: tools.paused ? 0 : 1 })}>
          <Icon name={tools.paused ? 'play' : 'pause'} size={16} />
        </Button>
        <Button variant="ghost" size="sm" whileHover={undefined} className="net-icon" data-action="reload" aria-label={reloadLabel} title={reloadLabel} onClick={() => send({ type: 'nav.reload', id: tools.tabId })}>
          <Icon name="reload" size={16} />
        </Button>
        <Button variant="ghost" size="sm" whileHover={undefined} className="net-icon" data-action="export" aria-label={exportLabel} title={exportLabel} disabled={!items.length && !tools.console.length} onClick={() => send({ type: 'network.export', id: tools.tabId })}>
          <Icon name="download" size={16} />
        </Button>
        <Button variant="ghost" size="sm" whileHover={undefined} className="net-icon" data-action="devtools" aria-label={devtoolsLabel} title={devtoolsLabel} onClick={() => send({ type: 'devtools.open' })}>
          <Icon name="tools" size={16} />
        </Button>
        <Button variant="ghost" size="sm" whileHover={undefined} className="net-icon" data-action="clear" aria-label={clearLabel} title={clearLabel} onClick={() => { setDetail(null); selectRequest(''); send({ type: 'network.clear' }); }}>
          <Icon name="delete" size={16} />
        </Button>
        <Button variant="ghost" size="sm" whileHover={undefined} className="net-close" aria-label={t('Fermer le panneau', 'Close panel')} title={t('Fermer le panneau', 'Close panel')} onClick={() => send({ type: 'network.toggle' })}>
          <Icon name="close" size={13} />
        </Button>
      </header>

      {mode !== 'compose' && (
        <div className="net-controls">
          <Input
            className="net-search sol-popup-input"
            classNames={{ field: 'sol-popup-input-field' }}
            leftIcon={<Icon name="search" size={14} />}
            aria-label={t('Rechercher dans le journal', 'Search log')}
            placeholder={mode === 'network' ? t('URL, méthode, type ou statut…', 'URL, method, type or status…') : t('Rechercher un message…', 'Find a message…')}
            value={query}
            onChange={setQuery}
          />
          {mode === 'network' ? (
            <SolTabs
              className="net-filters"
              value={filter}
              change={value => setFilter(value as Filter)}
              label={t('Filtre', 'Filter')}
              items={filters.map(([value, label, count]) => ({ value, label: <>{label}<span className="popup-seg-count">{count}</span></> }))}
            />
          ) : (
            <Button variant="ghost" size="sm" whileHover={undefined} className={`pill-action${filter === 'errors' ? ' on' : ''}`} aria-pressed={filter === 'errors'} onClick={() => setFilter(filter === 'errors' ? 'all' : 'errors')}>
              {t('Erreurs et alertes', 'Errors and warnings')}
            </Button>
          )}
          {mode === 'network' && (
            <SolTabs
              className="net-filters"
              value={sort}
              change={value => setSort(value as typeof sort)}
              label={t('Trier les requêtes', 'Sort requests')}
              items={[
                { value: 'recent', label: t('Récentes', 'Recent') },
                { value: 'duration', label: t('Durée', 'Duration') },
                { value: 'size', label: t('Taille', 'Size') },
              ]}
            />
          )}
          <Checkbox
            className="net-preserve"
            checked={tools.preserve ?? true}
            onCheckedChange={checked => send({ type: 'network.preserve', id: tools.tabId, index: checked ? 1 : 0 })}
            label={t('Conserver au rechargement', 'Keep across reloads')}
          />
        </div>
      )}

      <div className="net-summary">
        <span>{tools.paused ? t('Capture en pause', 'Capture paused') : t('Capture active', 'Capturing')}</span>
        <span>{shown.length} / {items.length} {t('requêtes', 'requests')}</span>
        <span>{formatNetBytes(items.reduce((sum, item) => sum + item.size, 0))}</span>
        {mode === 'console' && (
          <CopyAction label={t('Copier les messages', 'Copy messages')} text={lines.map(line => `${line.level} · ${line.text}`).join('\n')} />
        )}
      </div>

      {tools.mock && (
        <div className="net-mock-banner">
          <span>{t('Simulation active sur cet onglet :', 'Active mock in this tab:')} {tools.mock.Method} {tools.mock.Url}</span>
          <Button variant="ghost" size="sm" whileHover={undefined} className="pill-action" disabled={tools.mockBusy} onClick={() => send({ type: 'network.unmock', id: tools.tabId })}>
            {t('Désactiver', 'Disable')}
          </Button>
        </div>
      )}

      {mode === 'console' ? (
        <NetworkConsole lines={lines} tools={tools} />
      ) : mode === 'compose' ? (
        <NetworkComposer draft={draft} setDraft={setDraft} tools={tools} tabId={draftTab || tools.tabId} />
      ) : (
        <NetworkRequestView
          itemsCount={items.length}
          shown={shown}
          selectedRequestId={selectedRequestId}
          detail={detail}
          onSelectRequest={id => {
            selectRequest(id);
            send({ type: 'network.detail', id });
          }}
          onCloseDetail={() => {
            setDetail(null);
            selectRequest('');
          }}
          onEditDetail={nextDetail => {
            const safeHeaders = Object.fromEntries(
              Object.entries(nextDetail.requestHeaders).filter(
                ([key, value]) =>
                  !/(cookie|authorization|token|secret|api[-_]?key|host|content-length|connection|sec-)/i.test(key) &&
                  !value.includes('[masqué]'),
              ),
            );
            setDraft({
              ...emptyNetworkDraft(),
              Url: nextDetail.url,
              Method: nextDetail.method,
              Headers: safeHeaders,
              Body: nextDetail.postData.includes('[masqué]') ? '' : nextDetail.postData,
            });
            setDraftTab(nextDetail.tabId);
            setMode('compose');
          }}
        />
      )}
    </Card>
  );
}
