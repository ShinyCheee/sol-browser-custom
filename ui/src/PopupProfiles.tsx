import { useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg';
import { send } from './bridge';
import { t } from './i18n';
import { Icon } from './Icons';
import type { Profile } from './PopupTypes';

export { SessionPicker } from './SessionPicker';

export function ProfileList({ items }: { items: Profile[] }) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div
      className="popup arriving profiles-popup"
      onKeyDown={e => {
        if (e.key === 'Escape' && confirming) {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(null);
        }
      }}
    >
      <div className="popup-header">
        <Icon name="user" size={18} />
        <span className="popup-header-title">{t('Profils', 'Profiles')}</span>
      </div>
      <SharedLayoutBg className="popup-list sol-account-list" inset={0} pillClassName="sol-account-hover">
        {items.map(p => (
          <Card size="compact" selected={p.current} key={p.id} className={`sol-profile-card profile-row${p.current ? ' current' : ''}`}>
            <Button
              variant="ghost"
              size="sm"
              pressScale={0.98}
              whileHover={undefined}
              className="profile-pick"
              disabled={p.current}
              aria-current={p.current ? 'true' : undefined}
              title={p.current ? t('Profil de cette fenêtre', "This window's profile") : t(`Passer au profil ${p.name}`, `Switch to profile ${p.name}`)}
              onClick={() => send({ type: 'profile.switch', id: p.id })}
            >
              <span className="row-badge profile-avatar" aria-hidden>
                {p.name[0]?.toUpperCase()}
              </span>
              <span className="row-title">{p.name}</span>
              {p.current && <span className="row-pill">{t('Actif', 'Active')}</span>}
            </Button>
            {p.renamable && (
              <Button
                variant="ghost"
                size="sm"
                pressScale={0.98}
                whileHover={undefined}
                className="profile-edit"
                aria-label={t(`Renommer le profil ${p.name}`, `Rename profile ${p.name}`)}
                title={t('Renommer', 'Rename')}
                onClick={() => send({ type: 'profile.edit', id: p.id })}
              >
                <Icon d="M10.5 3.5l2 2-6.5 6.5-2.5.5.5-2.5z" size={12} />
              </Button>
            )}
            {p.deletable &&
              (confirming === p.id ? (
                <>
                  <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" onClick={() => setConfirming(null)}>
                    {t('Annuler', 'Cancel')}
                  </Button>
                  <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action danger" onClick={() => send({ type: 'profile.delete', id: p.id })}>
                    {t('Supprimer', 'Delete')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  pressScale={0.98}
                  whileHover={undefined}
                  className="profile-delete"
                  aria-label={t(`Supprimer le profil ${p.name}`, `Delete profile ${p.name}`)}
                  title={t('Supprimer ce profil et ses données', 'Delete this profile and its data')}
                  onClick={() => setConfirming(p.id)}
                >
                  <Icon name="delete" size={14} />
                </Button>
              ))}
          </Card>
        ))}
      </SharedLayoutBg>
      <hr />
      <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="row" onClick={() => send({ type: 'profile.new' })}>
        <span className="row-badge" aria-hidden>
          <Icon name="userAdd" size={16} />
        </span>
        <span className="row-title">{t('Nouveau profil', 'New profile')}</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        pressScale={0.98}
        whileHover={undefined}
        className="row"
        title={t(
          'Ni historique ni session ; cookies, cache et connexions sont effacés à la fermeture du dernier onglet privé. Sans les connexions des autres profils.',
          'No history or session; cookies, cache and sign-ins are erased when the last private tab closes. Without the other profiles’ sign-ins.',
        )}
        onClick={() => send({ type: 'window.private' })}
      >
        <span className="row-badge" aria-hidden>
          <Icon name="private" size={16} />
        </span>
        <span className="row-title">{t('Nouvel onglet privé', 'New private tab')}</span>
        <span className="row-pill">{t('Ctrl+Maj+N', 'Ctrl+Shift+N')}</span>
      </Button>
    </div>
  );
}
