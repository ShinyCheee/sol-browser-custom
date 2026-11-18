import { useLayoutEffect, type KeyboardEvent, type ReactNode } from 'react';
import { SortableList, SortableListGroup, SortableListItem, useSortableList } from '@/components/motion/sortable-list';
import { send } from './bridge';
import { t } from './i18n';
import { sidebarSortCommands, type SidebarOrder } from './sidebarSortOrder';

export type SidebarBlock = SidebarOrder & { label: string; node: ReactNode };

let pendingFocus: { blockId: string; targetId: string; group: boolean } | null = null;

export function SidebarSort({ blocks }: { blocks: SidebarBlock[] }) {
  useLayoutEffect(() => {
    if (!pendingFocus || !blocks.some(b => b.id === pendingFocus!.blockId)) return;
    const { blockId, targetId, group } = pendingFocus;
    const block = document.querySelector<HTMLElement>(
      `[data-kind="${group ? 'group' : 'tab'}"][data-id="${CSS.escape(blockId)}"]`,
    );
    const target = group
      ? block?.querySelector<HTMLElement>('.tab-group-header')
      : document.querySelector<HTMLElement>(`[role="tab"][data-id="${CSS.escape(targetId)}"]`) ??
        (block?.matches('[role="tab"]') ? block : block?.querySelector<HTMLElement>('[role="tab"]'));
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus = null;
    }
  }, [blocks]);

  return (
    <SortableList
      items={blocks}
      getItemLabel={b => b.label}
      label={t('Rangement des onglets', 'Tab ordering')}
      showUndo={false}
      className="sol-sidebar-sort"
      instructionsText={t(
        'Glissez pour ranger. Ctrl+Maj+flèches haut et bas déplacent l’onglet ou le groupe.',
        'Drag to reorder. Ctrl+Shift+Up and Down move the tab or group.',
      )}
      onItemsChange={next => {
        sidebarSortCommands(blocks, next).forEach(send);
      }}
    >
      <SortableListGroup role="presentation" className="sol-sidebar-sort-list">
        {blocks.map(block => (
          <SortableListItem
            key={block.id}
            id={block.id}
            externalDrag
            role="presentation"
            className="sol-sidebar-sort-item"
            data-sort-block={block.id}
          >
            <SortKeys id={block.id}>{block.node}</SortKeys>
          </SortableListItem>
        ))}
      </SortableListGroup>
    </SortableList>
  );
}

export function useSidebarSortKey() {
  const { moveItem } = useSortableList();
  return (e: KeyboardEvent<HTMLElement>, blockId: string) => {
    if (!e.ctrlKey || !e.shiftKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return false;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const group = target.matches('.tab-group-header');
    pendingFocus = { blockId, targetId: target.dataset.id ?? blockId, group };
    moveItem(blockId, e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : e.key === 'ArrowUp' ? -1 : 1);
    return true;
  };
}

function SortKeys({ id, children }: { id: string; children: ReactNode }) {
  const key = useSidebarSortKey();
  return (
    <div
      className="sol-sort-content"
      onKeyDownCapture={e => {
        const target = e.target as HTMLElement;
        if (
          target.closest<HTMLElement>('[data-sort-block]')?.dataset.sortBlock === id &&
          target.matches('[role="tab"],.tab-group-header')
        ) {
          key(e, id);
        }
      }}
    >
      {children}
    </div>
  );
}
