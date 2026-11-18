import { useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { Input } from '@/components/motion/input';
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg';
import { send } from './bridge';
import { t } from './i18n';
import { Icon } from './Icons';
import type { Content } from './PopupTypes';

export function SessionPicker({ content }: { content: Extract<Content, { popup: 'sessions' }> }) {
  const [confirm, setConfirm] = useState('');
  const [edit, setEdit] = useState('');
  const [name, setName] = useState('');
  const busy = !!content.deleting;

  return (
    <div
      className="popup arriving sessions-popup"
      role="dialog"
      aria-labelledby="session-picker-title"
      onKeyDown={e => {
        if (e.key === 'Escape' && (edit || confirm)) {
          e.preventDefault();
          e.stopPropagation();
          setEdit('');
          setConfirm('');
        }
      }}
    >
      <div className="popup-header">
        <span className="session-picker-heading">
          <Icon name="session" size={17} />
          <span id="session-picker-title" className="popup-header-title">
            {t('Session de cet onglet', 'Tab session')}
          </span>
        </span>
        <Button variant="ghost" size="icon" pressScale={0.98} whileHover={undefined} className="session-picker-close" aria-label={t('Fermer', 'Close')} onClick={() => send({ type: 'popup.close' })}>
          <Icon name="close" size={14} />
        </Button>
      </div>
      <p className="row-hint">
        {content.site
          ? t(
              `Les sessions de ${content.site} n’existent que sur ce site. Ailleurs, les onglets restent sur la session actuelle. Changer de session recharge cet onglet.`,
              `${content.site} sessions only exist on this site. Elsewhere, tabs stay on the current session. Switching sessions reloads this tab.`,
            )
          : t('Ouvrez un site pour lui créer une session.', 'Open a site to create a session for it.')}
      </p>
      <SharedLayoutBg className="popup-list sol-account-list" inset={0} pillClassName="sol-account-hover">
        {[{ id: '', name: t('Session actuelle', 'Current session'), count: 0 }, ...content.items].map(item => (
          <div key={item.id} className={`session-entry${content.current === item.id ? ' current' : ''}`}>
            <div className="profile-row">
              <Button
                variant="ghost"
                size="sm"
                pressScale={0.98}
                whileHover={undefined}
                className="row"
                disabled={busy}
                aria-pressed={content.current === item.id}
                onClick={() => send({ type: 'session.set', id: content.id, query: item.id })}
              >
                <span className="row-badge session-avatar" aria-hidden>
                  <Icon name="session" size={15} />
                </span>
                <span className="row-title">{item.name}</span>
                {'legacy' in item && item.legacy && <span className="row-sub">{t('Ancienne', 'Older')}</span>}
                {(content.current === item.id || item.count > 0) && (
                  <span className="row-pill session-current">
                    {content.current === item.id ? (
                      <>
                        <Icon name="check" size={12} />
                        {t('Actuelle', 'Current')}
                      </>
                    ) : (
                      t(`${item.count} onglet(s)`, `${item.count} tab(s)`)
                    )}
                  </span>
                )}
              </Button>
              {item.id && (
                <>
                  {item.count > 0 && content.current !== item.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      pressScale={0.98}
                      whileHover={undefined}
                      className="profile-edit"
                      disabled={busy}
                      title={t('Ramener les onglets de cette session sur la session principale', 'Return this session’s tabs to the main session')}
                      aria-label={t(`Libérer ${item.name}`, `Release ${item.name}`)}
                      onClick={() => send({ type: 'session.detach', id: item.id })}
                    >
                      <Icon name="close" size={12} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    pressScale={0.98}
                    whileHover={undefined}
                    className="profile-edit"
                    disabled={busy}
                    aria-label={t(`Renommer ${item.name}`, `Rename ${item.name}`)}
                    onClick={() => {
                      setEdit(item.id);
                      setName(item.name);
                      setConfirm('');
                    }}
                  >
                    <Icon name="edit" size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    pressScale={0.98}
                    whileHover={undefined}
                    className="profile-delete"
                    disabled={busy || item.count > 0}
                    title={
                      item.count
                        ? t('Fermez les onglets de cette session pour la supprimer.', 'Close this session’s tabs to delete it.')
                        : t('Supprimer cette session et ses données', 'Delete this session and its data')
                    }
                    aria-label={t(`Supprimer ${item.name}`, `Delete ${item.name}`)}
                    onClick={() => {
                      setConfirm(item.id);
                      setEdit('');
                    }}
                  >
                    <Icon name="delete" size={14} />
                  </Button>
                </>
              )}
            </div>
            {edit === item.id && item.id && (
              <form
                className="session-edit"
                onSubmit={e => {
                  e.preventDefault();
                  const trimmed = name.trim();
                  if (trimmed) send({ type: 'session.rename', id: item.id, title: trimmed });
                }}
              >
                <Input className="sol-popup-input" classNames={{ field: 'sol-popup-input-field' }} autoFocus aria-label={t('Nom de la session', 'Session name')} value={name} maxLength={30} onChange={setName} />
                <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="submit" className="pill-action" disabled={!name.trim()}>
                  {t('Renommer', 'Rename')}
                </Button>
                <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="button" className="pill-action" onClick={() => setEdit('')}>
                  {t('Annuler', 'Cancel')}
                </Button>
              </form>
            )}
            {confirm === item.id && item.id && (
              <div className="session-confirm">
                <p className="row-hint">
                  {t('Supprimer définitivement les cookies, connexions, stockage et extensions de cette session ?', 'Permanently delete this session’s cookies, sign-ins, storage and extensions?')}
                </p>
                <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action danger" disabled={busy} onClick={() => send({ type: 'session.delete', id: item.id })}>
                  {busy ? t('Suppression…', 'Deleting…') : t('Supprimer', 'Delete')}
                </Button>
                <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" disabled={busy} onClick={() => setConfirm('')}>
                  {t('Annuler', 'Cancel')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </SharedLayoutBg>
      <Button
        variant="ghost"
        size="sm"
        pressScale={0.98}
        whileHover={undefined}
        className="row session-create"
        disabled={busy || !content.site || content.items.length >= 30}
        onClick={() => send({ type: 'session.new', id: content.id })}
      >
        <span className="row-badge" aria-hidden>
          <Icon name="plus" size={16} />
        </span>
        <span className="row-title">{t('Nouvelle session…', 'New session…')}</span>
      </Button>
      <p className="row-hint sessions-footer">
        {t(
          'Historique, favoris et notes restent partagés dans ce profil Sol. Les sessions d’une fenêtre privée sont effacées à sa fermeture.',
          'History, bookmarks and notes stay shared in this Sol profile. Private-window sessions are erased when the last private tab closes.',
        )}
      </p>
    </div>
  );
}
