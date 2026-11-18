import type { CSSProperties } from 'react';
import { send, type State } from './bridge';
import { t } from './i18n';
import { Icon } from './Icons';
import { SidebarAiGroups } from './SidebarAiGroups';
import { sidebarMenu } from './sidebarActions';
import { SidebarSort, type SidebarBlock } from './SidebarSort';
import { SidebarTabRow } from './SidebarTabRow';
import { startSlotDrag } from './useSidebarDrag';
import './private-tabs.css';

export function SidebarTabs({
  state,
  icons,
}: {
  state: State;
  icons: Record<string, string | null | undefined>;
}) {
  const { tabs, split, activeId, shortcuts } = state;
  const selected = new Set(state.selectedTabIds ?? []);
  const visibleTabs = tabs.filter(tab => !shortcuts.some(s => s.tabId === tab.id));
  const focusableId = visibleTabs.some(tab => tab.id === activeId)
    ? activeId
    : tabs.find(tab => !tab.pinned)?.id;

  const rows = (from: number, to: number) => {
    const items: SidebarBlock[] = [];
    for (let i = from; i <= to; i++) {
      const tab = tabs[i];
      const next = i < to ? tabs[i + 1] : undefined;
      if (next && tab.id === split.primaryId && next.id === split.secondaryId) {
        items.push({
          id: tab.id,
          secondId: next.id,
          kind: 'tab',
          first: i,
          last: i + 1,
          label: `${tab.title} · ${next.title}`,
          node: (
            <div
              key={tab.id}
              className={`sidebar-split-group${split.visible ? ' active' : ''}`}
              data-kind="tab"
              data-id={tab.id}
              data-second-id={next.id}
              data-first={i}
              data-last={i + 1}
            >
              <SidebarTabRow tab={tab} index={i} icon={icons[tab.id]} active={tab.id === activeId} focusable={tab.id === focusableId} selected={selected.has(tab.id)} paired />
              <SidebarTabRow tab={next} index={i + 1} icon={icons[next.id]} active={next.id === activeId} focusable={next.id === focusableId} selected={selected.has(next.id)} paired />
            </div>
          ),
        });
        i++;
      } else {
        items.push({
          id: tab.id,
          kind: 'tab',
          first: i,
          last: i,
          label: tab.title,
          node: (
            <SidebarTabRow
              key={tab.id}
              tab={tab}
              index={i}
              icon={icons[tab.id]}
              active={tab.id === activeId}
              focusable={tab.id === focusableId}
              selected={selected.has(tab.id)}
            />
          ),
        });
      }
    }
    return items;
  };

  const items: SidebarBlock[] = [];
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].pinned) continue;
    let end = i;
    const group = state.groups.find(g => g.id === tabs[i].groupId);
    if (!group) {
      if (tabs[i].id === split.primaryId && tabs[i + 1]?.id === split.secondaryId) end++;
      items.push(...rows(i, end));
    } else {
      while (tabs[end + 1]?.groupId === group.id) end++;
      const members = rows(i, end);
      const expanded = !group.collapsed;
      const active = tabs.slice(i, end + 1).some(tab => tab.id === activeId);
      items.push({
        id: group.id,
        kind: 'group',
        first: i,
        last: end,
        label: group.name,
        node: (
          <div
            key={group.id}
            className={`tab-group-block${expanded ? '' : ' collapsed'}${active ? ' has-active' : ''}`}
            data-kind="group"
            data-id={group.id}
            data-first={i}
            data-last={end}
            style={{ '--group': group.color } as CSSProperties}
          >
            <div className="tab-group-heading" onContextMenuCapture={e => sidebarMenu('group.menu', group.id, e)}>
              <button
                type="button"
                className="tab-group-header"
                aria-expanded={expanded}
                title={
                  expanded
                    ? t('Cliquer pour replier · Glisser pour déplacer le groupe', 'Click to collapse · Drag to move group')
                    : t('Cliquer pour déplier · Glisser pour déplacer le groupe', 'Click to expand · Drag to move group')
                }
                onPointerDown={e => startSlotDrag(e.currentTarget.parentElement!.parentElement, e)}
                onKeyDown={e => {
                  if (e.key === 'F2') {
                    e.preventDefault();
                    send({ type: 'group.edit', id: group.id });
                  }
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    sidebarMenu('group.menu', group.id, e);
                  }
                }}
                onClick={() => send({ type: 'group.toggle', id: group.id })}
              >
                {group.icon ? <span className="tab-group-icon" aria-hidden>{group.icon}</span> : <span className="tab-group-dot" aria-hidden />}
                <span className="tab-group-name">{group.name}</span>
                <span className="tab-group-count">{end - i + 1}</span>
                <span className="tab-group-chevron" aria-hidden>
                  <Icon d="M6 4l4 4-4 4" size={12} />
                </span>
              </button>
              <button
                type="button"
                className="sidebar-item-action group-add"
                title={t('Nouvel onglet dans ce groupe', 'New tab in this group')}
                aria-label={t('Nouvel onglet dans ce groupe', 'New tab in this group')}
                onClick={() => send({ type: 'group.open', id: group.id })}
              >
                <Icon d="M8 3v10M3 8h10" size={13} />
              </button>
              <button
                type="button"
                className="sidebar-item-action"
                aria-label={t(`Options du groupe ${group.name}`, `Options for group ${group.name}`)}
                title={t('Options du groupe', 'Group options')}
                onClick={e => sidebarMenu('group.menu', group.id, e)}
              >
                <Icon d="M3 8h.01M8 8h.01M13 8h.01" size={15} />
              </button>
            </div>
            {expanded && (
              <div className="tab-group-tabs">
                <SidebarSort blocks={members} />
              </div>
            )}
          </div>
        ),
      });
    }
    i = end;
  }

  return (
    <div
      className="sidebar-tabs"
      role="tablist"
      aria-label={t('Onglets', 'Tabs')}
      aria-orientation="vertical"
      aria-multiselectable="true"
      onKeyDown={e => {
        if (e.key === 'Escape' && selected.size) {
          e.preventDefault();
          send({ type: 'tabs.selection.clear' });
        }
      }}
    >
      {selected.size > 1 && (
        <div className="sidebar-selection" role="group" aria-label={t('Onglets sélectionnés', 'Selected tabs')}>
          <span role="status">{t(`${selected.size} sélectionnés`, `${selected.size} selected`)}</span>
          <button type="button" className="pill-action" onClick={() => send({ type: 'group.new', id: [...selected][0] })}>
            {t('Créer un groupe', 'Create group')}
          </button>
          <button type="button" className="pill-action" aria-label={t('Annuler la sélection', 'Clear selection')} onClick={() => send({ type: 'tabs.selection.clear' })}>
            ×
          </button>
        </div>
      )}
      <SidebarSort blocks={items} />
      <SidebarAiGroups ai={state.aiTabs} />
      <button type="button" className="sidebar-new-tab" title={t('Nouvel onglet · Ctrl+T', 'New tab · Ctrl+T')} onClick={() => send({ type: 'tab.open' })}>
        <Icon d="M8 3.5v9M3.5 8h9" size={14} />
        <span>{t('Nouvel onglet', 'New tab')}</span>
      </button>
    </div>
  );
}
