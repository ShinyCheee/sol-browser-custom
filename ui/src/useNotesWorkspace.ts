import { useEffect, useState } from 'react';

export function useNotesMenusAndBreakpoints() {
  const [compact, setCompact] = useState(() => matchMedia('(max-width:800px)').matches);
  const [medium, setMedium] = useState(() => matchMedia('(max-width:1100px)').matches);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      document.querySelectorAll<HTMLDetailsElement>('details.notes-menu[open]').forEach(menu => {
        if (!target || !menu.contains(target)) menu.removeAttribute('open');
      });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const openMenus = [...document.querySelectorAll<HTMLDetailsElement>('details.notes-menu[open]')];
      if (openMenus.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        openMenus.forEach(menu => menu.removeAttribute('open'));
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const small = matchMedia('(max-width:800px)');
    const middle = matchMedia('(max-width:1100px)');
    const update = () => {
      setCompact(small.matches);
      setMedium(middle.matches);
    };
    small.addEventListener('change', update);
    middle.addEventListener('change', update);
    return () => {
      small.removeEventListener('change', update);
      middle.removeEventListener('change', update);
    };
  }, []);

  return { compact, medium };
}
