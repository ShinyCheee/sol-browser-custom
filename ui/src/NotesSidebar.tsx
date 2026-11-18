import { EyeTracker } from '@/components/bencho/EyeTracker';
import { Button } from '@/components/motion/button/base';
import { Input } from '@/components/motion/input';
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg';
import { send } from './bridge';
import { t } from './i18n';
import { Icon } from './Icons';
import NotesControls from './NotesControls';
import { inView, type NoteView, type NotesContent } from './notesModel';
import NotesTags from './NotesTags';
import NoteSymbol from './NoteSymbol';
import SolModal from './SolModal';

export function NotesSidebar({
  data,
  view,
  tag,
  views,
  filteredIds,
  onNavigate,
  onSelectTag,
  onChooseNew,
  onRenameTag,
  flush,
}: {
  data: NotesContent;
  view: NoteView;
  tag: string;
  views: [NoteView, string][];
  filteredIds: string[];
  onNavigate: (next: NoteView) => void;
  onSelectTag: (tagName: string) => void;
  onChooseNew: () => void;
  onRenameTag: (tagName: string) => void;
  flush: () => void;
}) {
  return (
    <aside className="notes-browser" aria-label={t('Organisation des notes', 'Note organization')}>
      <header className="notes-browser-heading">
        <h1>Notes</h1>
        {data.aiEnabled && (
          <Button
            variant="ghost"
            size="sm"
            whileHover={undefined}
            pressScale={0.98}
            className="pill-action notes-ai"
            title={t(
              'Demander à Sol AI de chercher, résumer ou créer des notes',
              'Ask Sol AI to search, summarize or create notes',
            )}
            onClick={() => send({ type: 'chat.toggle', id: 'notes' })}
          >
            <EyeTracker className="eyt-inline" size={16} eyeScale={1.8} idle />
            Sol AI
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          whileHover={undefined}
          pressScale={0.98}
          className="notes-tool"
          aria-label={t('Nouvelle note', 'New note')}
          title={t('Nouvelle note', 'New note')}
          onClick={onChooseNew}
        >
          <Icon d="M10 3l3 3M4 10l6-7 3 3-6 7-4 1zM11 12v2H2V5h3" />
        </Button>
      </header>
      {data.privateMode && <p className="notes-private">{t('Privé · mémoire uniquement', 'Private · memory only')}</p>}
      <nav className="notes-navigation">
        <SharedLayoutBg inset={0} className="notes-nav-motion" pillClassName="notes-nav-hover">
          {views.map(([key, label]) => (
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              key={key}
              aria-current={view === key && !tag ? 'page' : undefined}
              className={view === key && !tag ? 'active' : ''}
              onClick={() => onNavigate(key)}
            >
              <span aria-hidden>
                <NoteSymbol view={key} />
              </span>
              <span>{label}</span>
              {key !== 'stats' && <small>{data.items.filter(n => inView(n, key)).length}</small>}
            </Button>
          ))}
        </SharedLayoutBg>
      </nav>
      <NotesTags
        items={data.items}
        selected={tag}
        privateMode={data.privateMode}
        choose={onSelectTag}
        rename={onRenameTag}
        flush={flush}
      />
      <NotesControls days={data.archiveDays ?? 0} ids={filteredIds} flush={flush} />
    </aside>
  );
}

export function TagRenameModal({
  tagEdit,
  tagName,
  setTagName,
  onClose,
  flush,
}: {
  tagEdit: string | null;
  tagName: string;
  setTagName: (value: string) => void;
  onClose: () => void;
  flush: () => void;
}) {
  return (
    <SolModal id={tagEdit === null ? null : 'tag-rename'} title={t('Modifier le tag', 'Edit tag')} close={onClose}>
      <form
        className="note-modal"
        onSubmit={e => {
          e.preventDefault();
          flush();
          send({ type: 'notes.tag', id: tagEdit ?? '', title: tagName.replace(/^#/, '') });
          onClose();
        }}
      >
        <h2>{t('Modifier le tag', 'Edit tag')}</h2>
        <Input aria-label={t('Nom du tag', 'Tag name')} value={tagName} maxLength={64} onChange={setTagName} />
        <div>
          <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} type="button" className="pill-action" onClick={onClose}>
            {t('Annuler', 'Cancel')}
          </Button>
          <Button variant="ghost" size="sm" className="pill-action" type="submit">
            {tagName ? t('Enregistrer', 'Save') : t('Supprimer le tag', 'Delete tag')}
          </Button>
        </div>
      </form>
    </SolModal>
  );
}
