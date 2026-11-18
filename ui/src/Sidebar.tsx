import { memo, useEffect, useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { anchorBox, onState, send, type State } from './bridge';
import { t, useLang } from './i18n';
import { Icon } from './Icons';
import { SidebarPinned } from './SidebarPinned';
import { SidebarTabs } from './SidebarTabs';
import { useSidebarDrag } from './useSidebarDrag';
import { WindowControls, useWindowDrag } from './WindowControls';

export { useIconLook } from './useIconLook';

type Icons = Record<string, string | null | undefined>;

const Sidebar = memo(function Sidebar() {
  const [state, setState] = useState<State | null>(null);
  const [icons, setIcons] = useState<Icons>({});
  const [status, setStatus] = useState('');
  useLang();
  const windowDrag = useWindowDrag();

  useEffect(() => {
    const off = onState(
      next => {
        setState(next);
        setIcons(prev => {
          const keep = new Set(next.tabs.map(tab => tab.id));
          let stale = false;
          for (const id of Object.keys(prev)) {
            if (!keep.has(id)) {
              stale = true;
              break;
            }
          }
          if (!stale) return prev;
          const cleaned: Icons = {};
          for (const id of Object.keys(prev)) {
            if (keep.has(id)) cleaned[id] = prev[id];
          }
          return cleaned;
        });
      },
      e => {
        if (e.event === 'favicon' && e.id) setIcons(all => ({ ...all, [e.id!]: e.data }));
        if (e.event === 'status') setStatus(e.text ?? '');
      },
    );
    return off;
  }, []);

  const activeTab = state?.tabs.find(tab => tab.id === state.activeId);
  useSidebarDrag();

  if (!state) return null;
  const { tabs, split, activeId } = state;

  const quickActions = [
    { type: 'window.private', label: t('Nouvel onglet privé', 'New private tab'), path: '' },
    { type: 'notes.manage', label: t('Notes', 'Notes'), path: 'M4 2.5h8v11H4zM6 5h4M6 8h4M6 11h2' },
    {
      type: split.visible ? 'split.close' : 'split.open',
      label: split.visible
        ? t('Fermer la vue scindée', 'Close split view')
        : t('Afficher deux pages côte à côte', 'Show two pages side by side'),
      path: 'M2 3h12v10H2zM8 3v10',
    },
    ...(split.visible
      ? [{ type: 'split.menu', label: t('Disposition des pages', 'Page layout'), path: 'M2 3h12v10H2zM6 3v10M4 6v4M10 6v4' }]
      : []),
    { type: 'history.open', label: t('Historique', 'History'), path: 'M2 7a6 6 0 1 1 1.5 5M2 3v4h4M8 4.5V8l2.5 1.5' },
    { type: 'downloads.open', label: t('Téléchargements', 'Downloads'), path: 'M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10' },
  ];

  return (
    <div className="sidebar-card" aria-label={t('Panneau latéral des onglets', 'Tabs sidebar')}>
      <div className="sidebar-window-bar" {...windowDrag}>
        <WindowControls maximized={state.maximized} />
      </div>
      {activeTab && (
        <Button
          variant="ghost"
          size="sm"
          pressScale={0.98}
          whileHover={undefined}
          className="sidebar-session"
          data-action="session.menu"
          disabled={!!activeTab.privateMode}
          aria-label={t(`Session : ${activeTab.sessionName}`, `Session: ${activeTab.sessionName}`)}
          aria-haspopup="dialog"
          title={activeTab.sessionName}
          data-custom-session={!!activeTab.sessionId}
          onClick={e => {
            const box = anchorBox(e.currentTarget);
            send({ type: 'session.menu', id: activeTab.id, x: box.left, y: box.bottom + 6 });
          }}
        >
          <span className="sidebar-session-symbol">
            <Icon name={activeTab.privateMode ? 'private' : 'session'} size={15} />
          </span>
          <span className="sidebar-session-name">{activeTab.sessionName}</span>
          {!activeTab.privateMode && <Icon d="M5 6.5l3 3 3-3" size={12} />}
        </Button>
      )}
      <SidebarPinned state={state} icons={icons} />
      <div className="sidebar-scroll" data-tab-count={tabs.length}>
        <SidebarTabs state={state} icons={icons} />
      </div>
      <div className="sidebar-drag-hint" aria-live="polite" />

      <div className="sidebar-quick-actions" role="group" aria-label={t('Actions rapides', 'Quick actions')}>
        {quickActions.map(action => {
          const isOn =
            action.type === 'split.close' ||
            (action.type === 'window.private' && state.privateMode) ||
            (action.type === 'notes.manage' && activeTab?.url === 'https://start.sol/index.html#notes');
          return (
            <Button
              variant="ghost"
              size="sm"
              pressScale={0.98}
              whileHover={undefined}
              key={action.type}
              data-action={action.type}
              className={`sidebar-quick-btn${action.type === 'window.private' ? ' private-action' : ''}${action.type === 'split.menu' ? ' split-proportions' : ''}${isOn ? ' on' : ''}`}
              aria-label={action.label}
              title={action.label}
              aria-pressed={action.type === 'split.open' || action.type === 'split.close' ? split.visible : undefined}
              onContextMenu={e => {
                if (action.type !== 'notes.manage') return;
                e.preventDefault();
                const box = anchorBox(e.currentTarget);
                send({ type: 'notes.menu', id: activeId ?? undefined, x: box.right, y: box.top - 6 });
              }}
              onClick={e => {
                const box = anchorBox(e.currentTarget);
                send({ type: action.type, x: box.right, y: box.top - 6 });
              }}
            >
              {action.type === 'window.private' ? <Icon name="private" size={16} /> : <Icon d={action.path} size={16} />}
            </Button>
          );
        })}
      </div>

      {/* Où mène le lien survolé : repère contre l'hameçonnage, à la place de la bulle noire du moteur. */}
      <div className={`sidebar-status${status ? ' shown' : ''}`} aria-live="off" title={status}>
        <Icon d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" size={12} />
        <span>{status.replace(/^https?:\/\/(www\.)?/, '')}</span>
      </div>
    </div>
  );
});

export default Sidebar;
