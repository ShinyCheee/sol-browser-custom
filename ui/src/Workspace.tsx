import { Activity, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASE_DRAWER } from '@/lib/ease';
import App from './App';
import { interfaceScale, onMessage, send, type HostEvent } from './bridge';
import { sidebarTheme } from './interfaceTheme';
import Sidebar from './Sidebar';

// beUI animated-sidebar, MIT: desktop offcanvas spring and panel transition.
const SIDEBAR_MORPH_TRANSITION = { type: 'spring', stiffness: 380, damping: 35, mass: 0.75 } as const;
const PANEL_TRANSITION = { duration: 0.36, ease: EASE_DRAWER };

export default function Workspace() {
  const [sidebar, setSidebar] = useState<{ open: boolean; width: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [scale, setScale] = useState(interfaceScale);
  const reduce = useReducedMotion();
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = onMessage(data => {
      const event = data as HostEvent;
      if (event.event === 'sidebar') {
        setSidebar(current => {
          const nextOpen = event.open ?? current?.open ?? true;
          if (current?.open && !nextOpen) setClosing(true);
          if (nextOpen) setClosing(false);
          return { open: nextOpen, width: event.width ?? current?.width ?? 296 };
        });
      }
    });
    const rescale = () => setScale(interfaceScale());
    window.addEventListener('ui-scale', rescale);
    send({ type: 'ui.ready' });
    return () => {
      off();
      window.removeEventListener('ui-scale', rescale);
    };
  }, []);

  const ready = sidebar !== null;
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element) return;
    let frame = 0;
    const publish = () => {
      frame = 0;
      const { x, y, width, height } = element.getBoundingClientRect();
      send({ type: 'ui.layout', x, y, width, height });
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(publish);
    });
    observer.observe(element);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', publish);
    };
  }, [ready]);

  if (!sidebar) return null;
  const width = sidebar.width / scale;
  const sidebarVisible = sidebar.open || (!reduce && closing);

  return (
    <div className="workspace" style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <motion.aside
        ref={sidebarTheme}
        data-surface-theme="light"
        data-slot="sidebar"
        data-state={sidebar.open ? 'expanded' : 'collapsed'}
        className="workspace-sidebar"
        initial={false}
        animate={{ width: sidebar.open ? width : 0 }}
        transition={reduce ? { duration: 0 } : SIDEBAR_MORPH_TRANSITION}
        onAnimationComplete={() => {
          if (!sidebar.open) setClosing(false);
        }}
        inert={!sidebar.open}
        aria-hidden={!sidebar.open}
      >
        <motion.div
          className="workspace-sidebar-content"
          initial={false}
          animate={{ opacity: sidebar.open ? 1 : 0, x: sidebar.open ? '0%' : '-100%' }}
          transition={reduce ? { duration: 0 } : PANEL_TRANSITION}
        >
          <Activity mode={sidebarVisible ? 'visible' : 'hidden'}>
            <Sidebar />
          </Activity>
        </motion.div>
      </motion.aside>
      <div className="workspace-right" data-slot="sidebar-inset">
        <App sidebarOpen={sidebar.open} />
        <div ref={slot} className="workspace-page" aria-hidden="true" />
      </div>
    </div>
  );
}
