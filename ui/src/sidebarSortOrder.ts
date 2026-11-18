import type { Command } from './bridge';

export type SidebarOrder = {
  id: string;
  secondId?: string;
  kind: 'tab' | 'group';
  first: number;
  last: number;
};

export function sidebarSortCommands(before: SidebarOrder[], after: SidebarOrder[]): Command[] {
  if (
    before.length !== after.length ||
    new Set(after.map(b => b.id)).size !== before.length ||
    after.some(b => !before.some(a => a.id === b.id))
  ) {
    return [];
  }
  for (let from = 0; from < before.length; from++) {
    const source = before[from];
    const to = after.findIndex(b => b.id === source.id);
    if (to === from) continue;
    const attempt = [...before];
    attempt.splice(from, 1);
    attempt.splice(to, 0, source);
    if (attempt.some((b, i) => b.id !== after[i].id)) continue;
    const target = before[to];
    if (source.kind === 'group') {
      const index = to > from ? target.last + 1 : target.first;
      if (index >= source.first && index <= source.last + 1) return [];
      return [{ type: 'group.move', id: source.id, index }];
    }
    if (source.secondId) {
      return to > from
        ? [
            { type: 'tab.move', id: source.id, index: target.last },
            { type: 'tab.move', id: source.secondId, index: target.last },
          ]
        : [
            { type: 'tab.move', id: source.id, index: target.first },
            { type: 'tab.move', id: source.secondId, index: target.first + 1 },
          ];
    }
    const index = to > from ? target.last : target.first;
    return [{ type: 'tab.move', id: source.id, index }];
  }
  return [];
}

export function sidebarSortOrder(before: SidebarOrder[], after: SidebarOrder[]): Command | null {
  return sidebarSortCommands(before, after)[0] ?? null;
}
