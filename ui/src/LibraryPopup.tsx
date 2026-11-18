import { useEffect, useRef, useState } from 'react';
import { send } from './bridge';
import DeleteSavedSite from './DeleteSavedSite';
import { t } from './i18n';
import { Icon } from './Icons';
import Row from './PopupRow';
import type { Content, Item } from './PopupTypes';

export default function LibraryPopup({
  content,
  opening,
}: {
  content: Extract<Content, { popup: 'library' }>;
  opening: number;
}) {
  const [libTab, setLibTab] = useState<'bookmarks' | 'history'>(
    content.tab ?? (content.bookmarks.length ? 'bookmarks' : 'history'),
  );
  const [libraryQuery, setLibraryQuery] = useState(content.query ?? '');
  const libraryTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(libraryTimer.current), []);

  const open = (item: Item) => send({ type: 'tab.open', url: item.url });
  const items = libTab === 'bookmarks' ? content.bookmarks : content.history;

  return (
    <div key={opening} className="popup arriving library-popup">
      <div className="popup-segment" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={libTab === 'bookmarks'}
          className={`popup-seg-btn${libTab === 'bookmarks' ? ' active' : ''}`}
          onMouseDown={e => {
            e.preventDefault();
            setLibTab('bookmarks');
          }}
          onClick={() => setLibTab('bookmarks')}
        >
          <Icon d="M8 2.4l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z" size={13} />
          <span>{t('Favoris', 'Bookmarks')}</span>
          <span className="popup-seg-count">{content.bookmarks.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={libTab === 'history'}
          className={`popup-seg-btn${libTab === 'history' ? ' active' : ''}`}
          onMouseDown={e => {
            e.preventDefault();
            setLibTab('history');
          }}
          onClick={() => setLibTab('history')}
        >
          <Icon d="M8 3.5v4.5l3 1.8M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" size={13} />
          <span>{t('Historique', 'History')}</span>
          <span className="popup-seg-count">{content.total}</span>
        </button>
      </div>

      <input
        className="library-search"
        type="search"
        aria-label={t('Rechercher dans les favoris et l’historique', 'Search bookmarks and history')}
        placeholder={t('Rechercher un titre ou une adresse…', 'Search a title or address…')}
        value={libraryQuery}
        onChange={e => {
          const query = e.target.value;
          setLibraryQuery(query);
          window.clearTimeout(libraryTimer.current);
          libraryTimer.current = window.setTimeout(() => send({ type: 'library.search', query, index: 0 }), 150);
        }}
      />

      <div className="popup-list">
        {items.length === 0 ? (
          <div className="empty-pill">
            {libraryQuery
              ? t('Aucun résultat.', 'No results.')
              : libTab === 'bookmarks'
                ? t("Aucun favori enregistré pour l'instant.", 'No bookmarks yet.')
                : t('Aucune page visitée récemment.', 'No recently visited pages.')}
          </div>
        ) : (
          items.map((item, idx) => (
            <div className="library-entry" key={`${item.url}-${idx}`}>
              <Row
                item={{ ...item, kind: libTab === 'bookmarks' ? 'site' : 'history' }}
                onPick={() => open(item)}
              />
              <DeleteSavedSite
                collection={libTab}
                url={item.url}
                title={item.title}
                onDelete={() => {
                  window.clearTimeout(libraryTimer.current);
                  send({
                    type: 'library.remove',
                    url: item.url,
                    input: libTab,
                    query: libraryQuery,
                    index: content.page,
                  });
                }}
              />
            </div>
          ))
        )}
      </div>

      {libTab === 'history' && content.total > content.pageSize && (
        <div className="library-pages">
          <button
            type="button"
            className="pill-action"
            aria-label={t('Page précédente', 'Previous page')}
            disabled={content.page === 0}
            onClick={() => send({ type: 'library.search', query: libraryQuery, index: content.page - 1 })}
          >
            <Icon d="M10 4L6 8l4 4" size={14} />
          </button>
          <span aria-live="polite">
            {content.page * content.pageSize + 1}–{Math.min((content.page + 1) * content.pageSize, content.total)} / {content.total}
          </span>
          <button
            type="button"
            className="pill-action"
            aria-label={t('Page suivante', 'Next page')}
            disabled={(content.page + 1) * content.pageSize >= content.total}
            onClick={() => send({ type: 'library.search', query: libraryQuery, index: content.page + 1 })}
          >
            <Icon d="M6 4l4 4-4 4" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
