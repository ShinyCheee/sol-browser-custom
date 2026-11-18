import { useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { Checkbox } from '@/components/motion/checkbox';
import { send } from './bridge';
import { t } from './i18n';

export default function NotesControls({
  days,
  ids,
  flush,
}: {
  days: number;
  ids: string[];
  flush: () => void;
}) {
  const [current, setCurrent] = useState(false);
  const formats: [string, string][] = [
    ['markdown', 'Markdown'],
    ['json', 'JSON'],
    ['csv', 'CSV'],
    ['zip', t('Notes et fichiers', 'Notes and files')],
  ];

  return (
    <footer>
      <Button
        variant="ghost"
        size="sm"
        whileHover={undefined}
        pressScale={0.98}
        className="pill-action"
        onClick={() => {
          flush();
          send({ type: 'notes.import' });
        }}
      >
        {t('Importer', 'Import')}
      </Button>
      <details className="notes-menu">
        <summary>{t('Exporter', 'Export')}</summary>
        <Card size="compact" className="sol-surface-card sol-inline-menu">
          <Checkbox
            className="sol-checkbox note-export-filter"
            label={t('La vue filtrée', 'Filtered view')}
            checked={current}
            onCheckedChange={setCurrent}
          />
          {formats.map(([format, label]) => (
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              key={format}
              onClick={e => {
                flush();
                e.currentTarget.closest('details')?.removeAttribute('open');
                send({ type: 'notes.export', query: format, input: current ? JSON.stringify(ids) : undefined });
              }}
            >
              {label}
            </Button>
          ))}
        </Card>
      </details>
      <details className="note-policy">
        <summary>{t('Archivage automatique', 'Automatic archiving')}</summary>
        <form
          onSubmit={e => {
            e.preventDefault();
            const daysValue = Number(new FormData(e.currentTarget).get('days'));
            e.currentTarget.closest('details')?.removeAttribute('open');
            send({ type: 'notes.archive-policy', index: daysValue });
          }}
        >
          <label>
            {t('Idées non épinglées après', 'Unpinned ideas after')}
            <input key={days} name="days" type="number" min="0" max="3650" defaultValue={days} required />{' '}
            {t('jours (0 : désactivé)', 'days (0: disabled)')}
          </label>
          <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} type="submit" className="pill-action">
            {t('Appliquer', 'Apply')}
          </Button>
        </form>
      </details>
    </footer>
  );
}
