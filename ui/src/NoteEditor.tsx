import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { send } from './bridge';
import { t } from './i18n';
import NoteAttachments from './NoteAttachments';
import NoteAudio, { attachNoteBlob } from './NoteAudio';
import { NoteEditorDetails } from './NoteEditorDetails';
import { NoteEditorMeta, NoteEditorToolbar, type NoteEditorMode } from './NoteEditorHeader';
import NoteMarkdown from './NoteMarkdown';
import { dirtyNote, references, titleOf, type Note, type NotesContent } from './notesModel';
import { readNotesPref, writeNotesPref } from './notesStorage';
import NoteToolbar, { insertNote } from './NoteToolbar';
import RichNoteEditor from './RichNoteEditor';

export default function NoteEditor({
  data,
  change,
  meta,
  edit,
  close,
  focus,
  setFocus,
  flush,
  openFilters,
}: {
  data: NotesContent;
  change: (field: 'title' | 'text', value: string) => void;
  meta: (value: Partial<Pick<Note, 'kind' | 'tags' | 'due'>>) => void;
  edit: (id: string) => void;
  close: () => void;
  focus: boolean;
  setFocus: (value: boolean) => void;
  flush: () => void;
  openFilters: () => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState(false);
  const [find, setFind] = useState('');
  const [attachError, setAttachError] = useState('');

  const note = data.draft;
  const dirty = dirtyNote(data);
  const backlinks = data.items.filter(
    n => n.id !== note.id && !n.deleted && references(n, data.items).some(ref => ref.id === note.id),
  );

  const [mode, setMode] = useState<NoteEditorMode>(() => {
    const saved = readNotesPref('sol.notes.editor');
    return saved === 'source' || saved === 'ir' ? saved : 'wysiwyg';
  });

  useEffect(() => {
    setAttachError('');
  }, [note.id]);

  useEffect(() => {
    if (!picker) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !pickerRef.current?.contains(target) && !target.closest('[data-note-link-toggle]')) {
        setPicker(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPicker(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [picker]);

  const act = (query: string) => {
    flush();
    send({ type: 'notes.action', input: JSON.stringify([note.id]), query });
  };

  const linkableNotes = data.items.filter(
    n => !n.deleted && n.id !== note.id && titleOf(n).toLocaleLowerCase().includes(find.toLocaleLowerCase()),
  );
  const activeError = data.error || attachError;

  return (
    <section
      className="notes-document"
      aria-label={t('Éditeur de note', 'Note editor')}
      onDragOver={e => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={e => {
        if (!e.defaultPrevented && e.dataTransfer.files.length) {
          e.preventDefault();
          for (const file of e.dataTransfer.files) attachNoteBlob(file, file.name, note.id, setAttachError);
        }
      }}
      onPaste={e => {
        if (!e.defaultPrevented && e.clipboardData.files.length) {
          e.preventDefault();
          for (const file of e.clipboardData.files) attachNoteBlob(file, file.name, note.id, setAttachError);
        }
      }}
    >
      <NoteEditorToolbar
        note={note}
        dirty={dirty}
        privateMode={data.privateMode}
        preview={preview}
        setPreview={setPreview}
        focus={focus}
        setFocus={setFocus}
        flush={flush}
        close={close}
        openFilters={openFilters}
        act={act}
      />

      <div className="notes-paper">
        {activeError && <p role="alert" className="notes-error">{activeError}</p>}

        <NoteEditorMeta
          note={note}
          mode={mode}
          onModeChange={next => {
            setMode(next);
            writeNotesPref('sol.notes.editor', next, data.privateMode);
          }}
          onTitleChange={value => change('title', value)}
          meta={meta}
          act={act}
        />

        {!preview &&
          (mode === 'source' ? (
            <NoteToolbar editor={editor} change={text => change('text', text)} reference={() => setPicker(v => !v)} />
          ) : (
            <div className="note-format">
              <Button
                variant="ghost"
                size="sm"
                whileHover={undefined}
                pressScale={0.98}
                className="pill-action"
                data-note-link-toggle="true"
                onClick={() => {
                  setMode('source');
                  setPicker(v => !v);
                }}
              >
                {t('Lier une note', 'Link a note')}
              </Button>
              <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} className="pill-action" onClick={() => send({ type: 'notes.attach' })}>
                {t('Joindre un fichier', 'Attach a file')}
              </Button>
            </div>
          ))}

        {picker && (
          <Card ref={pickerRef} size="compact" className="sol-surface-card note-reference-picker">
            <input
              type="search"
              autoFocus
              aria-label={t('Chercher une note à lier', 'Find a note to link')}
              placeholder={t('Rechercher une note…', 'Find a note…')}
              value={find}
              onChange={e => setFind(e.target.value)}
            />
            {linkableNotes.map(n => (
              <Button
                variant="ghost"
                size="sm"
                whileHover={undefined}
                pressScale={0.98}
                key={n.id}
                onClick={() => {
                  insertNote(editor.current, text => change('text', text), '[[', ']]', n.id, true);
                  setPicker(false);
                }}
              >
                {titleOf(n)}
              </Button>
            ))}
          </Card>
        )}

        {preview ? (
          <NoteMarkdown note={note} all={data.items} change={text => change('text', text)} edit={edit} />
        ) : mode !== 'source' ? (
          <RichNoteEditor value={note.text} mode={mode} noteId={note.id} change={text => change('text', text)} save={flush} onAttachError={setAttachError} />
        ) : (
          <textarea
            ref={editor}
            className="notes-writing"
            aria-label={t('Contenu', 'Content')}
            placeholder={t(
              'Écrivez votre idée… Markdown, #tags et [[liens entre notes]].',
              'Capture an idea… Markdown, #tags and [[note links]].',
            )}
            maxLength={50000}
            value={note.text}
            onChange={e => change('text', e.target.value)}
            onKeyDown={e => {
              const lower = e.key.toLowerCase();
              if (e.ctrlKey && (lower === 'b' || lower === 'i')) {
                e.preventDefault();
                const wrap = lower === 'b' ? '**' : '_';
                insertNote(editor.current, text => change('text', text), wrap, wrap, t('texte', 'text'));
              }
              if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                flush();
              }
            }}
          />
        )}

        <NoteAttachments files={data.attachments ?? []} />
        <NoteAudio id={note.id} />

        {note.url && (
          <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} className="pill-action notes-source-link" title={note.url} onClick={() => send({ type: 'notes.link', url: note.url })}>
            {t('Ouvrir la source', 'Open source')} ↗
          </Button>
        )}

        {backlinks.length > 0 && (
          <div className="note-backlinks">
            <h3>{t('Liens entrants', 'Backlinks')}</h3>
            {backlinks.map(n => (
              <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} key={n.id} className="pill-action" onClick={() => edit(n.id)}>
                {titleOf(n)}
              </Button>
            ))}
          </div>
        )}

        {note.id && <NoteEditorDetails note={note} flush={flush} />}
      </div>
    </section>
  );
}
