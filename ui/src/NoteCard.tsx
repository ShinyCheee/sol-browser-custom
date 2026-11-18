import { Archive, ArchiveRestore, CopyPlus, MessageCircleQuestion, Pin, PinOff } from 'lucide-react';
import { CornerActions } from '@/components/bencho/CornerActions';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { Checkbox } from '@/components/motion/checkbox';
import { formatDomain, send } from './bridge';
import { t } from './i18n';
import { titleOf, type Note, type NoteView } from './notesModel';
import NoteSymbol from './NoteSymbol';

export function NoteCardItem({
  note,
  view,
  showEditor,
  draftId,
  selecting,
  selected,
  aiEnabled,
  onSelectChange,
  onStartSelect,
  onChoose,
  onAction,
  onRequestPurge,
  onMove,
}: {
  note: Note;
  view: NoteView;
  showEditor: boolean;
  draftId: string;
  selecting: boolean;
  selected: boolean;
  aiEnabled: boolean;
  onSelectChange: (checked: boolean) => void;
  onStartSelect: () => void;
  onChoose: () => void;
  onAction: (action: string, ids: string[]) => void;
  onRequestPurge: () => void;
  onMove: (from: string, to: string) => void;
}) {
  const isSelectedCard = showEditor && draftId === note.id;
  const fanOn = !showEditor && !selecting && view !== 'trash';
  const overdue = note.due && new Date(note.due).getTime() < Date.now() && !note.reviewed;

  const card = (
    <Card
      interactive
      selected={isSelectedCard}
      role="article"
      size="compact"
      className={`note-card${isSelectedCard ? ' selected' : ''}`}
      key={note.id}
      draggable={!selecting && view !== 'trash'}
      onDragStart={e => e.dataTransfer.setData('application/sol-note', note.id)}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        onMove(e.dataTransfer.getData('application/sol-note'), note.id);
      }}
      onContextMenu={e => {
        e.preventDefault();
        onStartSelect();
      }}
    >
      {selecting && (
        <Checkbox
          className="sol-checkbox note-card-check"
          aria-label={t(`Sélectionner ${titleOf(note)}`, `Select ${titleOf(note)}`)}
          checked={selected}
          onCheckedChange={onSelectChange}
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        whileHover={undefined}
        pressScale={0.98}
        className="notes-preview"
        aria-label={titleOf(note)}
        onClick={() => {
          if (view === 'trash') onSelectChange(true);
          else if (selecting) onSelectChange(!selected);
          else onChoose();
        }}
      >
        <div className="note-card-top">
          <span>
            <NoteSymbol view={note.kind} />
          </span>
          {note.pinned && <span title={t('Épinglé', 'Pinned')}>⌖</span>}
          <time>{new Date(note.updated).toLocaleDateString()}</time>
        </div>
        <strong>{titleOf(note)}</strong>
        <span className="note-card-excerpt">{note.text.replace(/[#*`\[\]]/g, '').slice(0, 280)}</span>
        <div className="note-card-tags">
          {note.tags.map(tagName => (
            <small key={tagName}>#{tagName}</small>
          ))}
        </div>
        <div className="note-card-bottom">
          {note.url && <small>{formatDomain(note.url)}</small>}
          {note.files.length > 0 && <small>↧ {note.files.length}</small>}
          {note.kind === 'task' && (
            <small className={overdue ? 'overdue' : ''}>
              {note.reviewed ? t('Terminée', 'Done') : note.due ? new Date(note.due).toLocaleString() : t('À faire', 'To do')}
            </small>
          )}
        </div>
      </Button>
      {view === 'trash' && (
        <div className="note-trash-actions">
          <Button variant="ghost" size="sm" className="pill-action" onClick={() => onAction('restore', [note.id])}>
            {t('Restaurer', 'Restore')}
          </Button>
          <Button variant="ghost" size="sm" className="pill-action" onClick={onRequestPurge}>
            {t('Supprimer', 'Delete')}
          </Button>
        </div>
      )}
    </Card>
  );

  if (!fanOn) return card;

  return (
    <CornerActions
      corner={18}
      actions={[
        {
          id: 'pin',
          label: note.pinned ? t('Désépingler', 'Unpin') : t('Épingler', 'Pin'),
          Icon: note.pinned ? PinOff : Pin,
          run: () => onAction(note.pinned ? 'unpin' : 'pin', [note.id]),
        },
        {
          id: 'duplicate',
          label: t('Dupliquer', 'Duplicate'),
          Icon: CopyPlus,
          run: () => onAction('duplicate', [note.id]),
        },
        {
          id: 'archive',
          label: note.archived ? t('Désarchiver', 'Unarchive') : t('Archiver', 'Archive'),
          Icon: note.archived ? ArchiveRestore : Archive,
          run: () => onAction(note.archived ? 'unarchive' : 'archive', [note.id]),
        },
        ...(aiEnabled
          ? [
              {
                id: 'ai',
                label: t('Résumer avec Sol AI', 'Summarize with Sol AI'),
                Icon: MessageCircleQuestion,
                run: () =>
                  send({
                    type: 'chat.ask',
                    id: 'notes',
                    input: t(
                      `Résume ma note « ${titleOf(note)} » (identifiant ${note.id}).`,
                      `Summarize my note “${titleOf(note)}” (id ${note.id}).`,
                    ),
                  }),
              },
            ]
          : []),
      ]}
    >
      {card}
    </CornerActions>
  );
}
