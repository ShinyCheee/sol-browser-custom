import { useEffect, type PointerEvent } from 'react';
import { send, type Command } from './bridge';
import { t } from './i18n';

type Drop = { el: HTMLElement; style: string; commands: Command[]; label: string };
type Drag = {
  el: HTMLElement;
  visual: HTMLElement;
  capture: Element;
  pointer: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  origin?: DOMRect;
  ghost?: HTMLElement;
  drop?: Drop;
};

let drag: Drag | null = null;
const AUTOSCROLL_EDGE = 36;

const slots = (kind: string) => [...document.querySelectorAll<HTMLElement>(`.sidebar-card [data-kind="${kind}"]`)];
const position = (el: HTMLElement, last = false) => Number(last ? el.dataset.last : el.dataset.first);
const visualRow = (el: HTMLElement) =>
  el.classList.contains('sidebar-split-group') || el.classList.contains('pinned-pill') || el.dataset.kind === 'group'
    ? el
    : el.closest<HTMLElement>('.sidebar-tab') ?? el;

export function startSlotDrag(el: HTMLElement | null, event: PointerEvent) {
  if (!el || event.button !== 0 || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
  const capture = event.currentTarget;
  drag = {
    el,
    visual: visualRow(el),
    capture,
    pointer: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
  };
  capture.setPointerCapture(event.pointerId);
}

function targetAt(d: Drag): Drop | undefined {
  const hit = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>('.sidebar-card');
  if (!hit || !d.el.isConnected) return;
  const kind = d.el.dataset.kind!;
  const id = d.el.dataset.id!;
  const secondId = d.el.dataset.secondId;
  const from = position(d.el);
  const last = position(d.el, true);
  const element = document.elementFromPoint(d.x, d.y) as HTMLElement | null;

  if (kind === 'shortcut') {
    const target = element?.closest<HTMLElement>('[data-kind="shortcut"]');
    if (!target || target === d.el) return;
    return {
      el: target,
      style: 'drop-into',
      commands: [{ type: 'shortcut.move', id, index: position(target) }],
      label: t('Ranger l’accès rapide', 'Reorder shortcut'),
    };
  }

  const pinZone = element?.closest<HTMLElement>('[data-pin-zone]');
  if (pinZone && kind === 'tab' && !secondId) {
    const target = element?.closest<HTMLElement>('[data-kind="tab"]');
    const commands: Command[] = d.el.dataset.pinned ? [] : [{ type: 'tab.pin', id, index: 1 }];
    if (target && target !== d.el) commands.push({ type: 'tab.move', id, index: position(target) });
    if (!commands.length) return;
    return { el: target ?? pinZone, style: 'drop-into', commands, label: t('Épingler et ranger l’onglet', 'Pin and reorder tab') };
  }

  const header = element?.closest<HTMLElement>('.tab-group-heading');
  if (header && kind === 'tab') {
    const group = header.parentElement!;
    if (d.el.closest('[data-kind="group"]') === group) return;
    const ids = secondId ? [id, secondId] : [id];
    const commands: Command[] = [];
    if (d.el.dataset.pinned) ids.forEach(tabId => commands.push({ type: 'tab.pin', id: tabId, index: 0 }));
    ids.forEach(tabId => commands.push({ type: 'group.add', id: tabId, query: group.dataset.id }));
    return { el: header, style: 'drop-into', commands, label: t('Ajouter au groupe', 'Add to group') };
  }

  const end = element?.closest<HTMLElement>('.sidebar-new-tab');
  if (end && kind === 'tab') {
    const endIndex = Number(hit.querySelector<HTMLElement>('.sidebar-scroll')?.dataset.tabCount) - 1;
    const ids = secondId ? [id, secondId] : [id];
    const commands: Command[] = [];
    if (d.el.dataset.pinned) ids.forEach(tabId => commands.push({ type: 'tab.pin', id: tabId, index: 0 }));
    ids.forEach(tabId => {
      commands.push({ type: 'tab.move', id: tabId, index: endIndex }, { type: 'group.remove', id: tabId });
    });
    return { el: end, style: 'drop-into', commands, label: t('Ranger hors des groupes', 'Move outside groups') };
  }

  const candidates =
    kind === 'group'
      ? [...hit.querySelectorAll<HTMLElement>('.sidebar-tabs [data-kind]')].filter(el => !el.closest('.tab-group-tabs'))
      : slots('tab').filter(el => !el.dataset.pinned && !d.el.contains(el));
  if (kind === 'tab') candidates.push(...hit.querySelectorAll<HTMLElement>('.tab-group-block.collapsed'));
  const valid = candidates.filter(el => el !== d.el && !d.el.contains(el) && !el.contains(d.el));

  if (!valid.length && kind === 'tab' && d.el.dataset.pinned) {
    return {
      el: hit.querySelector<HTMLElement>('.sidebar-tabs')!,
      style: 'drop-into',
      commands: [{ type: 'tab.pin', id, index: 0 }],
      label: t('Détacher l’onglet', 'Unpin tab'),
    };
  }

  const distance = (el: HTMLElement) => {
    const r = visualRow(el).getBoundingClientRect();
    return Math.abs(d.y - (r.top + r.bottom) / 2);
  };
  const target = valid.sort((a, b) => distance(a) - distance(b))[0];
  if (!target) return;

  const targetVisual = visualRow(target);
  const rect = targetVisual.getBoundingClientRect();
  const after = d.y > (rect.top + rect.bottom) / 2;
  let index = after ? position(target, true) + 1 : position(target);
  const commands: Command[] = [];

  if (kind === 'group') {
    if (index >= from && index <= last + 1) return;
    commands.push({ type: 'group.move', id, index });
  } else if (secondId) {
    if (index >= from && index <= last + 1) return;
    if (index > last + 1) {
      const dest = index - 1;
      commands.push({ type: 'tab.move', id, index: dest }, { type: 'tab.move', id: secondId, index: dest });
    } else {
      commands.push({ type: 'tab.move', id, index }, { type: 'tab.move', id: secondId, index: index + 1 });
    }
  } else if (d.el.dataset.pinned) {
    commands.push({ type: 'tab.pin', id, index: 0 });
    index = Math.max(slots('tab').filter(el => el.dataset.pinned).length - 1, index - 1);
    commands.push({ type: 'tab.move', id, index });
  } else {
    if (index > from) index--;
    if (index === from) return;
    commands.push({ type: 'tab.move', id, index });
  }

  const label =
    kind === 'group'
      ? t('Déplacer le groupe', 'Move group')
      : d.el.dataset.pinned
        ? t('Détacher et déplacer l’onglet', 'Unpin and move tab')
        : t('Déplacer l’onglet', 'Move tab');
  return { el: targetVisual, style: after ? 'drop-after' : 'drop-before', commands, label };
}

export function useSidebarDrag() {
  useEffect(() => {
    let frame = 0;
    let suppressClick = false;
    let reset = 0;
    const hint = () => document.querySelector<HTMLElement>('.sidebar-drag-hint');
    const clearDrop = () => {
      if (drag?.drop) drag.drop.el.classList.remove(drag.drop.style);
      if (hint()) hint()!.textContent = '';
    };
    const stop = (commit = false) => {
      cancelAnimationFrame(frame);
      clearDrop();
      if (drag?.ghost) {
        suppressClick = true;
        window.clearTimeout(reset);
        if (commit) drag.drop?.commands.forEach(send);
      }
      drag?.ghost?.remove();
      drag?.visual.classList.remove('drag-source');
      if (drag?.capture.hasPointerCapture(drag.pointer)) drag.capture.releasePointerCapture(drag.pointer);
      document.documentElement.classList.remove('sidebar-dragging');
      drag = null;
    };
    const update = () => {
      if (!drag?.ghost) return;
      const d = drag;
      const origin = d.origin!;
      const card = document.querySelector('.sidebar-card')!.getBoundingClientRect();
      const left = origin.left + (d.el.classList.contains('pinned-pill') ? d.x - d.startX : 0);
      d.ghost!.style.left = `${Math.max(card.left, Math.min(left, card.right - origin.width))}px`;
      d.ghost!.style.top = `${origin.top + d.y - d.startY}px`;
      clearDrop();
      d.drop = targetAt(d);
      if (d.drop) {
        d.drop.el.classList.add(d.drop.style);
        if (hint()) hint()!.textContent = `${d.drop.label} · ${t('Échap pour annuler', 'Esc to cancel')}`;
      }
      const list = document.querySelector<HTMLElement>('.sidebar-scroll, .tabs-scroll');
      if (list) {
        const box = list.getBoundingClientRect();
        if (d.y >= box.top - 24 && d.y < box.top + AUTOSCROLL_EDGE) {
          const ratio = Math.min(1, (box.top + AUTOSCROLL_EDGE - d.y) / AUTOSCROLL_EDGE);
          list.scrollTop -= Math.max(2, ratio * 12);
        } else if (d.y <= box.bottom + 24 && d.y > box.bottom - AUTOSCROLL_EDGE) {
          const ratio = Math.min(1, (d.y - (box.bottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
          list.scrollTop += Math.max(2, ratio * 12);
        }
      }
      frame = requestAnimationFrame(update);
    };
    const move = (event: globalThis.PointerEvent) => {
      if (!drag) return;
      if (!(event.buttons & 1)) return stop();
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.ghost || Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
      const source = drag.el.dataset.kind === 'group' ? drag.el.querySelector<HTMLElement>('.tab-group-heading')! : drag.visual;
      const box = source.getBoundingClientRect();
      const style = getComputedStyle(source);
      drag.origin = box;
      const scale = Number(getComputedStyle(document.body).zoom) || 1;
      const ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.add('sidebar-drag-ghost');
      ghost.removeAttribute('id');
      const background =
        style.backgroundColor === 'rgba(0, 0, 0, 0)'
          ? getComputedStyle(document.querySelector('.sidebar-card')!).backgroundColor
          : style.backgroundColor;
      Object.assign(ghost.style, {
        width: `${box.width / scale}px`,
        height: `${box.height / scale}px`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        background,
        color: style.color,
        font: style.font,
      });
      ghost.style.setProperty('--group', style.getPropertyValue('--group'));
      ghost.removeAttribute('data-kind');
      ghost.querySelectorAll('[data-kind]').forEach(el => el.removeAttribute('data-kind'));
      document.documentElement.appendChild(ghost);
      drag.ghost = ghost;
      drag.visual.classList.add('drag-source');
      document.documentElement.classList.add('sidebar-dragging');
      event.preventDefault();
      update();
    };
    const click = (event: globalThis.MouseEvent) => {
      if (suppressClick && event.detail) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }
    };
    const up = () => {
      stop(true);
      if (suppressClick) reset = window.setTimeout(() => { suppressClick = false; }, 80);
    };
    const down = () => { suppressClick = false; };
    const cancel = () => stop();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    document.addEventListener('click', click, true);
    return () => {
      stop();
      window.clearTimeout(reset);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      document.removeEventListener('click', click, true);
    };
  }, []);
}
