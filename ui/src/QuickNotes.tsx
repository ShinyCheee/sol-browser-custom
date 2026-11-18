import { useEffect, useRef, useState } from 'react';
import { EyeTracker } from '@/components/bencho/EyeTracker';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t } from './i18n';
import NoteAttachments from './NoteAttachments';
import NoteMarkdown from './NoteMarkdown';
import type { NotesContent } from './notesModel';
import NoteToolbar from './NoteToolbar';
import { useNotes } from './useNotes';

export type { NotesContent } from './notesModel';

export default function QuickNotes({ content }: { content: NotesContent }) {
  const { data, change } = useNotes(content, false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const draft = data?.draft ?? content.draft;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!draft.text.length && confirmDiscard) setConfirmDiscard(false);
  }, [draft.text.length, confirmDiscard]);

  useEffect(() => {
    if (!confirmDiscard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConfirmDiscard(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmDiscard]);

  const activeError = data ? data.error : content.error;

  return (
    <>
      <div className="notes-heading">
        <strong>{t('Notes rapides', 'Quick notes')}</strong>
        {content.aiEnabled && (
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.98}
            whileHover={undefined}
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
          pressScale={0.98}
          whileHover={undefined}
          className="pill-action"
          onClick={() => send({ type: 'popup.close' })}
          aria-label={t('Fermer', 'Close')}
        >
          ×
        </Button>
      </div>
      <p className="row-hint">
        {content.privateMode
          ? t('Privé : conservées en mémoire jusqu’à la fermeture.', 'Private: kept in memory until this window closes.')
          : t(
              'Vos notes dans ce profil. Le brouillon reste disponible dans cette fenêtre.',
              'Notes for this profile. Your draft stays available in this window.',
            )}
      </p>
      <input
        className="library-search"
        aria-label={t('Titre de la note', 'Note title')}
        placeholder={t('Titre facultatif', 'Optional title')}
        maxLength={120}
        value={draft.title}
        onChange={e => change('title', e.target.value)}
      />
      {!preview && <NoteToolbar editor={editor} change={text => change('text', text)} reference={() => send({ type: 'notes.manage' })} />}
      {preview ? (
        <NoteMarkdown
          note={draft}
          all={data?.items ?? content.items}
          edit={id => {
            send({ type: 'notes.edit', id });
            send({ type: 'notes.manage' });
          }}
        />
      ) : (
        <textarea
          ref={editor}
          className="notes-text"
          autoFocus
          aria-label={t('Contenu de la note', 'Note content')}
          placeholder={t('Une idée, un passage à conserver…', 'An idea, a passage to keep…')}
          maxLength={50000}
          value={draft.text}
          onChange={e => change('text', e.target.value)}
        />
      )}
      <NoteAttachments files={data?.attachments ?? content.attachments ?? []} />
      {draft.url && (
        <span className="notes-source" title={draft.url}>
          {draft.url}
        </span>
      )}
      <div className="notes-actions">
        <Button
          variant="ghost"
          size="sm"
          pressScale={0.98}
          whileHover={undefined}
          className="pill-action"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? t('Modifier', 'Edit') : t('Aperçu', 'Preview')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          pressScale={0.98}
          whileHover={undefined}
          className="pill-action"
          disabled={!draft.text.trim() && !draft.files.length}
          onClick={() => send({ type: 'notes.save' })}
        >
          {t('Enregistrer', 'Save')}
        </Button>
        {draft.text.length > 0 && (
          <>
            {confirmDiscard && (
              <Button
                variant="ghost"
                size="sm"
                pressScale={0.98}
                whileHover={undefined}
                className="pill-action"
                onClick={() => setConfirmDiscard(false)}
              >
                {t('Annuler', 'Cancel')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              pressScale={0.98}
              whileHover={undefined}
              className="pill-action"
              onClick={() => {
                if (confirmDiscard) {
                  setConfirmDiscard(false);
                  send({ type: 'notes.discard' });
                } else {
                  setConfirmDiscard(true);
                }
              }}
            >
              {confirmDiscard ? t('Confirmer l’abandon', 'Confirm discard') : t('Abandonner', 'Discard')}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          pressScale={0.98}
          whileHover={undefined}
          className="pill-action"
          onClick={() => send({ type: 'notes.manage' })}
        >
          {t('Ouvrir les notes', 'Open notes')}
        </Button>
      </div>
      {activeError && (
        <p role="alert" className="row-hint">
          {activeError}
        </p>
      )}
    </>
  );
}
