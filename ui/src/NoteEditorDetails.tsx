import { useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t } from './i18n';
import NoteFold from './NoteFold';
import { createdOf, type Note } from './notesModel';

export function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function NoteEditorDetails({
  note,
  flush,
}: {
  note: Note;
  flush: () => void;
}) {
  const [comment, setComment] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const historyItems = note.history.map((h, i) => ({ h, i })).reverse();

  return (
    <div className="note-details">
      <NoteFold title={<>{t('Historique des versions', 'Version history')} · {note.history.length}</>}>
        {historyItems.map(({ h, i }) => (
          <div key={i} className="note-history-item">
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              onClick={() => setSelectedVersion(selectedVersion === i ? null : i)}
            >
              {new Date(h.updated).toLocaleString()} · {h.title || h.text.slice(0, 35)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              className="pill-action"
              onClick={() => {
                flush();
                send({ type: 'notes.version', id: note.id, index: i });
                setSelectedVersion(null);
              }}
            >
              {t('Restaurer', 'Restore')}
            </Button>
            {selectedVersion === i && <pre>{h.text}</pre>}
          </div>
        ))}
        {!note.history.length && (
          <p>{t('Les prochaines modifications seront conservées ici.', 'Future changes will be kept here.')}</p>
        )}
      </NoteFold>

      <NoteFold title={<>{t('Annotations', 'Annotations')} · {note.comments.length}</>}>
        {note.comments.map(c => (
          <div className="note-comment" key={c.id}>
            <time>{new Date(c.created).toLocaleString()}</time>
            <p>{c.text}</p>
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              className="notes-tool"
              aria-label={t('Supprimer l’annotation', 'Delete annotation')}
              onClick={() => send({ type: 'notes.comment', id: note.id, input: '', query: c.id })}
            >
              ×
            </Button>
          </div>
        ))}
        <textarea
          aria-label={t('Nouvelle annotation', 'New annotation')}
          value={comment}
          maxLength={5000}
          onChange={e => setComment(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          whileHover={undefined}
          pressScale={0.98}
          className="pill-action"
          disabled={!comment.trim()}
          onClick={() => {
            send({ type: 'notes.comment', id: note.id, input: comment });
            setComment('');
          }}
        >
          {t('Ajouter', 'Add')}
        </Button>
      </NoteFold>

      <NoteFold title={<>{t('Dates de la note', 'Note dates')}</>}>
        <label>
          {t('Création', 'Created')}
          <input
            type="datetime-local"
            aria-label={t('Date de création', 'Creation date')}
            value={formatLocalDateTime(createdOf(note))}
            onChange={e => {
              if (e.target.value) {
                flush();
                send({
                  type: 'notes.dates',
                  id: note.id,
                  title: new Date(e.target.value).toISOString(),
                  query: note.updated,
                });
              }
            }}
          />
        </label>
        <label>
          {t('Modification', 'Modified')}
          <input
            type="datetime-local"
            aria-label={t('Date de modification', 'Modification date')}
            value={formatLocalDateTime(note.updated)}
            onChange={e => {
              if (e.target.value) {
                flush();
                send({
                  type: 'notes.dates',
                  id: note.id,
                  title: createdOf(note),
                  query: new Date(e.target.value).toISOString(),
                });
              }
            }}
          />
        </label>
      </NoteFold>
    </div>
  );
}
