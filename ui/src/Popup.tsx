import { useLayoutEffect, useRef, useState } from 'react';
import { Card } from '@/components/motion/card';
import { MorphingModal } from '@/components/motion/morphing-modal';
import { interfaceScale, onMessage, send } from './bridge';
import { useLang } from './i18n';
import type { Content } from './PopupTypes';
import PopupViews from './PopupViews';

export default function Popup() {
  const [content, setContent] = useState<Content | null>(null);
  const [selected, setSelected] = useState(-1);
  const [settingsSection, setSettingsSection] = useState('general');
  const root = useRef<HTMLDivElement>(null);
  const fresh = useRef(false);
  const current = useRef<Content | null>(null);
  useLang();
  const [opening, setOpening] = useState(0);

  useLayoutEffect(() => {
    let leaving = 0;
    const off = onMessage(data => {
      const select = (data as { select?: unknown }).select;
      if (typeof select === 'number') return setSelected(select);
      if ((data as { fresh?: boolean }).fresh) {
        window.clearTimeout(leaving);
        fresh.current = true;
        return;
      }
      const isFresh = fresh.current;
      if (isFresh) setOpening(n => n + 1);
      fresh.current = false;
      const next = data as Content;
      current.current = next;
      setSelected(-1);
      if (next.popup === 'settings' && next.section && isFresh) setSettingsSection(next.section);
      setContent(next);
    });
    const close = () => send({ type: 'popup.close' });
    const focused = () => window.clearTimeout(leaving);
    const blurred = () => {
      window.clearTimeout(leaving);
      leaving = window.setTimeout(
        () =>
          current.current?.popup !== 'ai-action' &&
          current.current?.popup !== 'videos' &&
          !document.hasFocus() &&
          close(),
        150,
      );
    };
    window.addEventListener('blur', blurred);
    window.addEventListener('focus', focused);
    const key = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && e.key === 'Escape') close();
    };
    window.addEventListener('keydown', key);
    send({ type: 'ui.ready' });
    return () => {
      off();
      window.clearTimeout(leaving);
      window.removeEventListener('blur', blurred);
      window.removeEventListener('focus', focused);
      window.removeEventListener('keydown', key);
    };
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!content || !el) return;
    const report = () => send({ type: 'popup.size', height: el.offsetHeight * interfaceScale() });
    window.addEventListener('ui-scale', report);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.removeEventListener('ui-scale', report);
    };
  }, [content, settingsSection]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!content || !el) return;
    if (content.popup === 'suggestions' || content.popup === 'menu' || content.popup === 'palette') return;
    const frame = requestAnimationFrame(() => {
      const surface = root.current;
      if (!surface || surface.contains(document.activeElement)) return;
      const candidates = surface.querySelectorAll<HTMLElement>(
        '[autofocus]:not([disabled]), .library-search:not([disabled]), [role="tab"][aria-selected="true"]:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]',
      );
      const target = Array.from(candidates).find(node => node.checkVisibility?.() !== false);
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [opening, content?.popup]);

  return content ? (
    <MorphingModal
      embedded
      viewId={`${content.popup}:${opening}`}
      onClose={() => send({ type: 'popup.close' })}
      className="beui-native-panel"
    >
      <Card ref={root} size="compact" className="sol-surface-card sol-popup-card">
        <PopupViews
          content={content}
          opening={opening}
          selected={selected}
          settingsSection={settingsSection}
          setSettingsSection={setSettingsSection}
        />
      </Card>
    </MorphingModal>
  ) : null;
}
