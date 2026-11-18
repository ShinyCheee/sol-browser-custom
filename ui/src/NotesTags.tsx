import { useEffect, useState, type MouseEvent } from 'react';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { Input } from '@/components/motion/input';
import { send } from './bridge';
import { t } from './i18n';
import type { Note } from './notesModel';
import { readNotesPref, writeNotesPref } from './notesStorage';
import SolModal from './SolModal';

type TagLook = { icon: string; collapsed: boolean; order: number };

function loadTagLooks(): Record<string, TagLook> {
  try {
    const raw = readNotesPref('sol.notes.tags');
    const value = JSON.parse(raw || '{}');
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, v]) => v && typeof v === 'object' && 'icon' in v && typeof v.icon === 'string' && v.icon.length <= 8,
      ),
    ) as Record<string, TagLook>;
  } catch {
    return {};
  }
}

export default function NotesTags({
  items,
  selected,
  privateMode = false,
  choose,
  rename,
  flush,
}: {
  items: Note[];
  selected: string;
  privateMode?: boolean;
  choose: (tag: string) => void;
  rename: (tag: string) => void;
  flush: () => void;
}) {
  const [looks, setLooks] = useState<Record<string, TagLook>>(loadTagLooks);
  const [iconTag, setIconTag] = useState<string | null>(null);
  const [icon, setIcon] = useState('');

  useEffect(() => {
    writeNotesPref('sol.notes.tags', JSON.stringify(looks), privateMode);
  }, [looks, privateMode]);

  const tags = [
    ...new Set(
      items
        .filter(n => !n.deleted)
        .flatMap(n => n.tags.flatMap(name => name.split('/').map((_, i) => name.split('/').slice(0, i + 1).join('/')))),
    ),
  ].sort((a, b) => (looks[a]?.order ?? 1000) - (looks[b]?.order ?? 1000) || a.localeCompare(b));

  const update = (name: string, patch: Partial<TagLook>) =>
    setLooks(old => ({
      ...old,
      [name]: { ...(old[name] ?? { icon: '', collapsed: false, order: 1000 }), ...patch },
    }));

  const reorder = (tag: string, delta: number) => {
    const index = tags.indexOf(tag);
    const next = tags[index + delta];
    if (!next) return;
    setLooks(old =>
      Object.fromEntries(
        tags.map((name, i) => [
          name,
          {
            ...(old[name] ?? { icon: '', collapsed: false }),
            order: name === tag ? index + delta : name === next ? index : i,
          },
        ]),
      ),
    );
  };

  const closeMenu = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.closest('details')?.removeAttribute('open');
  };

  const visibleTags = tags.filter(
    name => !name.split('/').slice(0, -1).some((_, i) => looks[name.split('/').slice(0, i + 1).join('/')]?.collapsed),
  );

  return (
    <div className="notes-tags" spellCheck={false}>
      <h2>Tags</h2>
      {visibleTags.map(name => {
        const children = tags.some(tag => tag.startsWith(`${name}/`));
        const count = items.filter(n => !n.deleted && n.tags.some(tName => tName === name || tName.startsWith(`${name}/`))).length;

        return (
          <div
            className="note-tag-row"
            key={name}
            draggable
            onDragStart={e => e.dataTransfer.setData('application/sol-tag', name)}
            onDragOver={e => {
              if (e.dataTransfer.types.includes('application/sol-tag')) e.preventDefault();
            }}
            onDrop={e => {
              const from = e.dataTransfer.getData('application/sol-tag');
              if (from && from !== name && !name.startsWith(`${from}/`)) {
                e.preventDefault();
                flush();
                send({ type: 'notes.tag', id: from, title: `${name}/${from.split('/').at(-1)}` });
              }
            }}
          >
            {children && (
              <Button
                variant="ghost"
                size="sm"
                whileHover={undefined}
                pressScale={0.98}
                className="notes-tool"
                aria-label={looks[name]?.collapsed ? t('Déplier le tag', 'Expand tag') : t('Replier le tag', 'Collapse tag')}
                aria-expanded={!looks[name]?.collapsed}
                onClick={() => update(name, { collapsed: !looks[name]?.collapsed })}
              >
                {looks[name]?.collapsed ? '›' : '⌄'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              className={selected === name ? 'active' : ''}
              style={{ paddingLeft: 8 + name.split('/').length * 6 }}
              onClick={() => choose(name)}
            >
              <span>{looks[name]?.icon || '#'}</span>
              {name.split('/').at(-1)}
              <small>{count}</small>
            </Button>
            <details className="notes-menu">
              <summary aria-label={t('Actions du tag', 'Tag actions')}>⋯</summary>
              <Card size="compact" className="sol-surface-card sol-inline-menu">
                <Button
                  variant="ghost"
                  size="sm"
                  whileHover={undefined}
                  pressScale={0.98}
                  onClick={e => {
                    closeMenu(e);
                    rename(name);
                  }}
                >
                  {t('Renommer / supprimer', 'Rename / remove')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  whileHover={undefined}
                  pressScale={0.98}
                  onClick={e => {
                    closeMenu(e);
                    setIconTag(name);
                    setIcon(looks[name]?.icon || '');
                  }}
                >
                  {t('Changer l’icône', 'Change icon')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  whileHover={undefined}
                  pressScale={0.98}
                  onClick={e => {
                    closeMenu(e);
                    reorder(name, -1);
                  }}
                >
                  {t('Monter', 'Move up')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  whileHover={undefined}
                  pressScale={0.98}
                  onClick={e => {
                    closeMenu(e);
                    reorder(name, 1);
                  }}
                >
                  {t('Descendre', 'Move down')}
                </Button>
              </Card>
            </details>
          </div>
        );
      })}
      {!tags.length && <p>{t('Ajoutez #un-tag à une note.', 'Add #a-tag to a note.')}</p>}

      <SolModal id={iconTag ? 'tag-icon' : null} title={t('Icône du tag', 'Tag icon')} close={() => setIconTag(null)}>
        <form
          className="note-modal"
          onSubmit={e => {
            e.preventDefault();
            if (iconTag) update(iconTag, { icon });
            setIconTag(null);
          }}
        >
          <h2>{t('Icône du tag', 'Tag icon')}</h2>
          <Input aria-label={t('Emoji ou symbole', 'Emoji or symbol')} placeholder="📚" maxLength={8} value={icon} onChange={setIcon} />
          <div>
            <Button
              variant="ghost"
              size="sm"
              whileHover={undefined}
              pressScale={0.98}
              type="button"
              className="pill-action"
              onClick={() => setIconTag(null)}
            >
              {t('Annuler', 'Cancel')}
            </Button>
            <Button variant="ghost" size="sm" whileHover={undefined} pressScale={0.98} type="submit" className="pill-action">
              {t('Enregistrer', 'Save')}
            </Button>
          </div>
        </form>
      </SolModal>
    </div>
  );
}
