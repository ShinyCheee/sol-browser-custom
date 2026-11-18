import { Button } from '@/components/motion/button/base';
import { Input } from '@/components/motion/input';
import { t } from './i18n';
import { Icon } from './Icons';
import NoteActions from './NoteActions';
import { formatLocalDateTime } from './NoteEditorDetails';
import type { Note } from './notesModel';
import SolTabs from './SolTabs';

export type NoteEditorMode = 'source' | 'wysiwyg' | 'ir';

export function NoteEditorToolbar({
  note,
  dirty,
  privateMode,
  preview,
  setPreview,
  focus,
  setFocus,
  flush,
  close,
  openFilters,
  act,
}: {
  note: Note;
  dirty: boolean;
  privateMode: boolean;
  preview: boolean;
  setPreview: (next: boolean) => void;
  focus: boolean;
  setFocus: (next: boolean) => void;
  flush: () => void;
  close: () => void;
  openFilters: () => void;
  act: (query: string) => void;
}) {
  return (
    <header className="notes-document-toolbar">
      <Button
        variant="ghost"
        size="sm"
        whileHover={undefined}
        pressScale={0.98}
        className="notes-tool"
        title={t('Revenir aux notes', 'Back to notes')}
        aria-label={t('Revenir aux notes', 'Back to notes')}
        onClick={() => {
          flush();
          close();
        }}
      >
        <Icon d="M10 3L5 8l5 5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="notes-tool notes-filter-toggle"
        aria-label={t('Organisation des notes', 'Note organization')}
        aria-haspopup="dialog"
        onClick={openFilters}
      >
        <Icon name="sidebar" d="" />
      </Button>
      <span className="note-save-status" aria-live="polite">
        {dirty
          ? t('Enregistrement…', 'Saving…')
          : privateMode
            ? t('Note privée', 'Private note')
            : t('Enregistré', 'Saved')}
      </span>
      <div className="notes-toolbar-actions">
        <Button
          variant="ghost"
          size="sm"
          whileHover={undefined}
          pressScale={0.98}
          className="pill-action"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? t('Modifier', 'Edit') : t('Aperçu', 'Preview')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          whileHover={undefined}
          pressScale={0.98}
          className="pill-action"
          disabled={!note.text.trim() && !note.files.length}
          onClick={flush}
        >
          {t('Enregistrer', 'Save')}
        </Button>
        <NoteActions {...{ note, focus, setFocus, flush, act }} />
      </div>
    </header>
  );
}

export function NoteEditorMeta({
  note,
  mode,
  onModeChange,
  onTitleChange,
  meta,
  act,
}: {
  note: Note;
  mode: NoteEditorMode;
  onModeChange: (next: NoteEditorMode) => void;
  onTitleChange: (value: string) => void;
  meta: (value: Partial<Pick<Note, 'kind' | 'tags' | 'due'>>) => void;
  act: (query: string) => void;
}) {
  return (
    <>
      <div className="note-mode-controls">
        <SolTabs
          className="note-editor-modes"
          value={mode}
          change={next => onModeChange(next as NoteEditorMode)}
          label={t('Mode de rédaction', 'Editor mode')}
          items={[
            { value: 'wysiwyg', label: t('Texte riche', 'Rich text') },
            { value: 'ir', label: t('Rendu instantané', 'Instant rendering') },
            { value: 'source', label: 'Markdown' },
          ]}
        />
        <SolTabs
          className="note-kind"
          value={note.kind}
          change={next => meta({ kind: next as Note['kind'] })}
          label={t('Type de note', 'Note type')}
          items={[
            { value: 'idea', label: t('Idée', 'Idea') },
            { value: 'note', label: t('Note', 'Note') },
            { value: 'task', label: t('Tâche', 'Task') },
          ]}
        />
      </div>

      <Input
        className="note-title-control"
        classNames={{ field: 'note-title-field', input: 'notes-title' }}
        aria-label={t('Titre', 'Title')}
        placeholder={t('Titre de la note', 'Note title')}
        maxLength={120}
        value={note.title}
        onChange={onTitleChange}
      />

      <div className="note-metadata">
        <label>
          Tags
          <input
            key={note.id + note.tags.join(',')}
            defaultValue={note.tags.join(', ')}
            aria-label="Tags"
            placeholder={t('#projet, #idées', '#project, #ideas')}
            onBlur={e =>
              meta({
                tags: [
                  ...new Set(
                    e.target.value
                      .split(/[,\s]+/)
                      .map(s => s.replace(/^#/, ''))
                      .filter(Boolean),
                  ),
                ].slice(0, 40),
              })
            }
          />
        </label>
        {note.kind === 'task' && (
          <>
            <label>
              {t('Échéance', 'Due date')}
              <input
                type="datetime-local"
                aria-label={t('Échéance', 'Due date')}
                value={note.due ? formatLocalDateTime(note.due) : ''}
                onChange={e => meta({ due: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </label>
            {note.id && (
              <Button
                variant="ghost"
                size="sm"
                whileHover={undefined}
                pressScale={0.98}
                className="pill-action"
                aria-pressed={note.reviewed}
                onClick={() => act(note.reviewed ? 'unreview' : 'review')}
              >
                {note.reviewed ? t('Terminée', 'Done') : t('Marquer terminée', 'Mark done')}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}
