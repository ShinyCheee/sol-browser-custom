import { useEffect, useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t, useLang } from './i18n';
import { Icon } from './Icons';
import { NoteCardItem } from './NoteCard';
import NoteEditor from './NoteEditor';
import NotesCollectionTools from './NotesCollectionTools';
import { inView, matchesNote, titleOf, type NoteView } from './notesModel';
import { NotesSidebar, TagRenameModal } from './NotesSidebar';
import NotesStats from './NotesStats';
import { readNotesPref, writeNotesPref } from './notesStorage';
import SolModal from './SolModal';
import { useNotes } from './useNotes';
import { useNotesMenusAndBreakpoints } from './useNotesWorkspace';
import './notes.css';
import './notes-responsive.css';

export default function NotesPage() {
  const lang = useLang();
  const { data, change, meta, edit, flush } = useNotes();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<NoteView>('all');
  const [tag, setTag] = useState('');
  const [layout, setLayout] = useState(() => readNotesPref('sol.notes.layout') || 'cards');
  const [sort, setSort] = useState(() => readNotesPref('sol.notes.sort') || 'recent');
  const [showEditor, setShowEditor] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [focus, setFocus] = useState(false);
  const [rail, setRail] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [tagEdit, setTagEdit] = useState<string | null>(null);
  const [tagName, setTagName] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const { compact, medium } = useNotesMenusAndBreakpoints();

  useEffect(() => {
    document.title = t('Notes — Sol', 'Notes — Sol');
  }, [lang]);

  useEffect(() => {
    if (data && !hydrated) {
      setShowEditor(!!(data.draft.id || data.draft.text || data.draft.files.length));
      setHydrated(true);
    }
  }, [data, hydrated]);

  useEffect(() => {
    writeNotesPref('sol.notes.layout', layout, data?.privateMode ?? false);
  }, [layout, data?.privateMode]);

  useEffect(() => {
    writeNotesPref('sol.notes.sort', sort, data?.privateMode ?? false);
  }, [sort, data?.privateMode]);

  if (!data) return null;

  const navigationInModal = compact || (showEditor && (medium || focus));

  const choose = (id: string) => {
    edit(id);
    setEditorKey(key => key + 1);
    setShowEditor(true);
    setFocus(false);
    setRail(false);
  };

  const navigate = (next: NoteView) => {
    flush();
    setView(next);
    setTag('');
    setSelection([]);
    setSelecting(false);
    setConfirmPurge(false);
    setShowEditor(false);
    setRail(false);
  };

  const items = data.items.filter(n => inView(n, view) && matchesNote(n, query, tag));
  if (sort !== 'manual') {
    items.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === 'title'
          ? titleOf(a).localeCompare(titleOf(b))
          : sort === 'oldest'
            ? new Date(a.updated).getTime() - new Date(b.updated).getTime()
            : new Date(b.updated).getTime() - new Date(a.updated).getTime()),
    );
  }

  const views: [NoteView, string][] = [
    ['all', t('Tout', 'All')],
    ['idea', t('Idées', 'Ideas')],
    ['note', t('Notes', 'Notes')],
    ['task', t('Tâches', 'Tasks')],
    ['pinned', t('Épinglés', 'Pinned')],
    ['files', t('Fichiers', 'Files')],
    ['review', t('À revoir', 'Review')],
    ['archive', t('Archives', 'Archive')],
    ['trash', t('Corbeille', 'Trash')],
    ['stats', t('Activité', 'Activity')],
  ];

  const action = (actionQuery: string, ids = selection) => {
    flush();
    send({ type: 'notes.action', query: actionQuery, input: JSON.stringify(ids) });
    setSelection([]);
    setSelecting(false);
    setConfirmPurge(false);
  };

  const move = (from: string, to: string) => {
    if (!from || from === to) return;
    const ids = data.items.map(n => n.id);
    const index = ids.indexOf(from);
    if (index < 0) return;
    ids.splice(index, 1);
    ids.splice(ids.indexOf(to), 0, from);
    send({ type: 'notes.order', input: JSON.stringify(ids) });
    setSort('manual');
  };

  const batchActions: [string, string][] =
    view === 'trash'
      ? [['restore', t('Restaurer', 'Restore')]]
      : [
          ['pin', t('Épingler', 'Pin')],
          ['archive', t('Archiver', 'Archive')],
          ['trash', t('Corbeille', 'Trash')],
          ['kind:idea', t('Idées', 'Ideas')],
          ['kind:note', t('Notes', 'Notes')],
          ['kind:task', t('Tâches', 'Tasks')],
        ];

  const sidebar = (
    <NotesSidebar
      data={data}
      view={view}
      tag={tag}
      views={views}
      filteredIds={items.map(n => n.id)}
      onNavigate={navigate}
      onSelectTag={name => {
        navigate('all');
        setTag(name);
      }}
      onChooseNew={() => choose('')}
      onRenameTag={name => {
        setTagEdit(name);
        setTagName(name);
      }}
      flush={flush}
    />
  );

  return (
    <main className={`notes-workspace${showEditor ? ' has-editor' : ''}${focus ? ' note-focus' : ''}${rail ? ' rail-open' : ''}`}>
      {!navigationInModal && sidebar}
      <SolModal id={navigationInModal && rail ? 'note-navigation' : null} title={t('Organisation des notes', 'Note organization')} close={() => setRail(false)}>
        {sidebar}
      </SolModal>

      <section className="notes-collection">
        <header className="notes-collection-header">
          <div>
            <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} className="notes-tool notes-rail-toggle" aria-haspopup="dialog" aria-expanded={rail} aria-label={t('Afficher les filtres', 'Show filters')} onClick={() => setRail(!rail)}>
              ☷
            </Button>
            <h2>{tag ? `#${tag}` : views.find(v => v[0] === view)?.[1]}</h2>
            <span>{items.length}</span>
          </div>
          <Button variant="ghost" size="sm" className="pill-action" onClick={() => choose('')}>
            {t('Nouvelle note', 'New note')} +
          </Button>
        </header>

        <NotesCollectionTools
          {...{ query, setQuery, layout, setLayout, sort, setSort, selecting }}
          toggleSelection={() => {
            setSelecting(!selecting);
            setSelection([]);
            setConfirmPurge(false);
          }}
        />
        {data.error && <p className="notes-error" role="alert">{data.error}</p>}

        {selecting && (
          <div className="notes-batch">
            <Button variant="ghost" size="sm" className="pill-action" onClick={() => setSelection(items.map(n => n.id))}>
              {t('Tout sélectionner', 'Select all')}
            </Button>
            <span>{selection.length}</span>
            {batchActions.map(([key, label]) => (
              <Button variant="ghost" size="sm" className="pill-action" key={key} disabled={!selection.length} onClick={() => action(key)}>
                {label}
              </Button>
            ))}
            {view === 'trash' && (
              <>
                {confirmPurge && (
                  <Button variant="ghost" size="sm" className="pill-action" onClick={() => setConfirmPurge(false)}>
                    {t('Annuler', 'Cancel')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="pill-action" disabled={!selection.length} onClick={() => (confirmPurge ? action('purge') : setConfirmPurge(true))}>
                  {confirmPurge ? t('Confirmer la suppression définitive', 'Confirm permanent deletion') : t('Supprimer définitivement', 'Delete permanently')}
                </Button>
              </>
            )}
          </div>
        )}

        {view === 'stats' ? (
          <NotesStats items={data.items} />
        ) : (
          <div className={`notes-browser-list note-${showEditor ? 'list' : layout}`}>
            {view === 'review' && items.length > 0 && (
              <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} className="pill-action note-random" onClick={() => choose(items[Math.floor(Math.random() * items.length)].id)}>
                {t('Redécouvrir une note au hasard', 'Rediscover a random note')} ↻
              </Button>
            )}
            {!items.length && (
              <div className="notes-welcome">
                <Icon d="M4 2h8v12H4zM6 5h4M6 8h4" size={32} />
                <h2>{query ? t('Aucun résultat', 'No results') : t('Un espace pour vos idées', 'A space for your ideas')}</h2>
                <p>{t('Notes, tâches et passages enregistrés, ensemble dans Sol.', 'Notes, tasks and saved passages, together in Sol.')}</p>
                {view !== 'trash' && (
                  <Button variant="ghost" size="sm" className="pill-action" onClick={() => choose('')}>
                    {t('Créer une note', 'Create a note')}
                  </Button>
                )}
              </div>
            )}
            {items.map(n => (
              <NoteCardItem
                key={n.id}
                note={n}
                view={view}
                showEditor={showEditor}
                draftId={data.draft.id}
                selecting={selecting}
                selected={selection.includes(n.id)}
                aiEnabled={data.aiEnabled}
                onSelectChange={checked =>
                  setSelection(
                    view === 'trash' && checked && !selecting
                      ? [n.id]
                      : checked
                        ? [...new Set([...selection, n.id])]
                        : selection.filter(id => id !== n.id),
                  )
                }
                onStartSelect={() => {
                  setSelecting(true);
                  setSelection([n.id]);
                }}
                onChoose={() => choose(n.id)}
                onAction={action}
                onRequestPurge={() => {
                  setSelecting(true);
                  setSelection([n.id]);
                  setConfirmPurge(true);
                }}
                onMove={move}
              />
            ))}
          </div>
        )}
      </section>

      {showEditor && view !== 'trash' && (
        <NoteEditor
          key={editorKey}
          data={data}
          change={change}
          meta={meta}
          edit={choose}
          close={() => {
            setShowEditor(false);
            setFocus(false);
          }}
          focus={focus}
          setFocus={setFocus}
          flush={flush}
          openFilters={() => setRail(true)}
        />
      )}

      <TagRenameModal tagEdit={tagEdit} tagName={tagName} setTagName={setTagName} onClose={() => setTagEdit(null)} flush={flush} />
    </main>
  );
}
