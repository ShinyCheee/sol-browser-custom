import type { KeyboardEvent, MouseEvent } from 'react';
import { anchorBox, send } from './bridge';

export function sidebarMenu(type: string, id: string, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  const box = anchorBox(event.currentTarget);
  const hasPointerCoords =
    'clientX' in event &&
    event.type === 'contextmenu' &&
    (event.clientX !== 0 || event.clientY !== 0);
  send({
    type,
    ...(type === 'shortcut.menu' ? { index: Number(id) } : { id }),
    x: hasPointerCoords ? event.clientX : box.left,
    y: hasPointerCoords ? event.clientY : box.bottom + 4,
  });
}

export function middleClose(event: MouseEvent, id: string | null) {
  if (event.button !== 1) return;
  event.preventDefault();
  event.stopPropagation();
  if (id) send({ type: 'tab.close', id });
}

export function focusTab(event: KeyboardEvent<HTMLElement>) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  if (event.target !== event.currentTarget) return;
  const tabs = [...document.querySelectorAll<HTMLElement>('.sidebar-card [role="tab"]')];
  if (!tabs.length) return;
  const current = tabs.indexOf(event.currentTarget);
  const index =
    event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[index]?.focus();
}
