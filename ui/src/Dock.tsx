import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { Card } from '@/components/motion/card';
import { NotificationStack } from '@/components/motion/notification-stack';
import { Button } from '@/components/motion/button/base';
import { interfaceScale, onMessage, send } from './bridge';
import { Icon } from './Icons';
import DockUpdate, { type Update } from './DockUpdate';
import { DownloadCard, pendingDownload, type Download } from './Downloads';
import { t, useLang } from './i18n';

export default function Dock() {
  const [items, setItems] = useState<Download[]>([]);
  const [update, setUpdate] = useState<Update | null>(null);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useLang();

  useLayoutEffect(() => {
    const off = onMessage(data => {
      const content = data as { items?: Download[]; update?: Update | null };
      if (content.items === undefined && content.update === undefined) return;
      setItems(content.items ?? []);
      setUpdate(content.update ?? null);
      if (!content.items?.length) setExpanded(false);
    });
    const blur = () => setExpanded(false);
    window.addEventListener('blur', blur);
    send({ type: 'dock.ready' });
    return () => {
      off();
      window.removeEventListener('blur', blur);
    };
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || (!items.length && !update)) return;
    const report = () => {
      const scale = interfaceScale();
      const list = el.querySelector<HTMLElement>('.sol-download-stack-list');
      let height = el.offsetHeight;
      if (expanded && list) {
        const controls = el.offsetHeight - list.offsetHeight;
        list.style.maxHeight = `${Math.max(0, Math.min(310, innerHeight / scale - controls))}px`;
        height = controls + Math.min(310, list.scrollHeight);
      } else if (list) {
        list.style.maxHeight = '';
      }
      send({ type: 'dock.size', width: (expanded || update ? 320 : 252) * scale, height: height * scale });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener('ui-scale', report);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('ui-scale', report);
      window.removeEventListener('resize', report);
    };
  }, [items.length, !!update, expanded]);

  if (!items.length && !update) return null;

  const label = downloadSummary(items);

  return (
    <Card ref={root} size="compact" className={`sol-surface-card dock download-stack-dock${expanded ? ' expanded' : ' compact'}`}>
      {update && <DockUpdate update={update} />}
      {!!items.length && expanded && (
        <div className="dock-stack-heading">
          <span className="popup-header-title">{label}</span>
        </div>
      )}
      {!!items.length && (
        <NotificationStack
          expanded={expanded}
          onExpandedChange={setExpanded}
          maxVisible={0}
          ariaLabel={t('Téléchargements', 'Downloads')}
          className="sol-download-stack dock-downloads"
          collapsedLabel={
            <span className="dock-download-summary">
              <span aria-live="polite">{label}</span>
              <ChevronUp size={14} aria-hidden="true" />
            </span>
          }
          expandedLabel={t('Réduire', 'Collapse')}
          footerAction={
            <Button variant="ghost" size="icon" className="dock-hide-downloads"
              aria-label={t('Masquer le compteur flottant', 'Hide the floating counter')}
              title={t('Masquer le compteur flottant', 'Hide the floating counter')}
              onClick={() => send({ type: 'settings.set', id: 'floatingDownloads', index: 0 })}>
              <Icon name="close" size={14} />
            </Button>
          }
          classNames={{
            stack: 'sol-download-stack-list',
            card: 'sol-download-stack-card',
            controls: 'sol-download-stack-controls',
            footer: 'sol-download-stack-footer',
            count: 'sol-download-count',
          }}
          items={items.map(d => ({ id: d.id, title: d.name, content: <DownloadCard d={d} /> }))}
        />
      )}
    </Card>
  );
}

function downloadSummary(items: Download[]) {
  const done = items.filter(d => d.state === 'Completed').length;
  const active = items.filter(d => pendingDownload(d) && !d.paused && d.state === 'InProgress').length;
  const paused = items.filter(d => pendingDownload(d) && d.paused).length;
  const canceled = items.filter(d => d.canceled).length;
  const plural = (count: number) => count === 1 ? '' : 's';
  if (done === items.length) return t(`${done} téléchargement${plural(done)} terminé${plural(done)}`, `${done} download${plural(done)} completed`);
  if (done > 0) return t(`${done} sur ${items.length} terminé${plural(done)}`, `${done} of ${items.length} completed`);
  if (active > 0) return t(`${active} téléchargement${plural(active)} en cours`, `${active} download${plural(active)} in progress`);
  if (paused > 0) return t(`${paused} téléchargement${plural(paused)} en pause`, `${paused} download${plural(paused)} paused`);
  if (canceled === items.length) return t(`${canceled} téléchargement${plural(canceled)} annulé${plural(canceled)}`, `${canceled} download${plural(canceled)} canceled`);
  const failed = items.length - canceled;
  return t(`${failed} téléchargement${plural(failed)} interrompu${plural(failed)}`, `${failed} download${plural(failed)} interrupted`);
}
