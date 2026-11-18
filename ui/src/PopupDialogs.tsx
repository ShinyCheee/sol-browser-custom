import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t } from './i18n';
import { Icon } from './Icons';
import type { Content } from './PopupTypes';

export function TranslationPopupView({ content, opening }: { content: Extract<Content, { popup: 'translation' }>; opening: number }) {
  return (
    <div key={opening} className="popup arriving translation-popup" aria-label={t('Traduire la page', 'Translate page')}>
      <div className="translation-heading">
        <span className="row-title">{t('Traduire la page', 'Translate page')}</span>
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" aria-label={t('Fermer', 'Close')} onClick={() => send({ type: 'popup.close' })}>
          ×
        </Button>
      </div>
      <div className="popup-segment" role="group" aria-label={t('Langue de traduction', 'Translation language')}>
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="popup-seg-btn" disabled={!content.available} onClick={() => send({ type: 'translation.run', id: content.id, query: content.target })}>
          {content.target === 'fr' ? t('Traduire en français', 'Translate to French') : t('Traduire en anglais', 'Translate to English')}
          <span aria-hidden> ↗</span>
        </Button>
      </div>
      {content.original && (
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" onClick={() => send({ type: 'translation.original', id: content.id })}>
          {t('Voir l’original', 'View original')}
        </Button>
      )}
      <p className="row-hint">
        {content.available
          ? t('Google Traduction affiche la page dans cet onglet. Son adresse est transmise à Google.', 'Google Translate displays the page in this tab. Its address is sent to Google.')
          : t('Cette adresse locale ne peut pas être traduite par Google.', 'This local address cannot be translated by Google.')}
      </p>
    </div>
  );
}

export function SplitLayoutPopupView({ content, opening }: { content: Extract<Content, { popup: 'split-layout' }>; opening: number }) {
  const presets = [
    { ratio: 1 / 3, label: t('Plus de place à droite', 'More room on the right') },
    { ratio: 0.5, label: t('Deux pages égales', 'Equal pages') },
    { ratio: 2 / 3, label: t('Plus de place à gauche', 'More room on the left') },
  ];
  return (
    <div key={opening} className="popup arriving split-layout-popup" role="menu" aria-label={t('Disposition des pages', 'Page layout')}>
      <div className="split-layout-heading">{t('Disposition des pages', 'Page layout')}</div>
      {presets.map(p => (
        <Button
          variant="ghost"
          size="sm"
          pressScale={0.98}
          whileHover={undefined}
          key={p.ratio}
          className="row split-layout-choice"
          role="menuitemradio"
          aria-checked={Math.abs(content.ratio - p.ratio) < 0.01}
          onClick={() => send({ type: 'split.resize', ratio: p.ratio })}
        >
          <span className="split-layout-preview" aria-hidden>
            <span style={{ flex: p.ratio }} />
            <span style={{ flex: 1 - p.ratio }} />
          </span>
          <span className="row-title">{p.label}</span>
          {Math.abs(content.ratio - p.ratio) < 0.01 && <Icon d="M3 8l3 3 7-7" size={13} />}
        </Button>
      ))}
      <div className="split-layout-hint">{t('Glissez le séparateur pour ajuster librement.', 'Drag the divider to adjust freely.')}</div>
    </div>
  );
}

export function SiteResetPopupView({ content }: { content: Extract<Content, { popup: 'site-reset' }> }) {
  return (
    <div className="popup arriving">
      <div className="popup-header">
        <span className="popup-header-title">{t('Vider la session de ce site ?', 'Clear this site’s session?')}</span>
      </div>
      <p className="row-sub extension-note">
        <strong>{content.site}</strong> · {content.session}
      </p>
      <p className="row-sub extension-note">
        {t('Cookies, données locales, cache du site et autorisations seront effacés. Vous serez déconnecté et la page sera rechargée.', 'Cookies, local data, site cache and permissions will be cleared. You will be signed out and the page will reload.')}
      </p>
      <p className="row-sub extension-note">
        {t('Les cookies partagés avec d’autres sous-domaines seront aussi supprimés, ainsi que le cache HTTP de cette session. Les autres sessions, vos mots de passe, favoris et historique sont conservés.', 'Cookies shared with other subdomains and this session’s HTTP cache will also be cleared. Other sessions, your passwords, bookmarks and history are kept.')}
      </p>
      <div className="extension-confirm-actions">
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" onClick={() => send({ type: 'popup.close' })}>
          {t('Annuler', 'Cancel')}
        </Button>
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action danger" onClick={() => send({ type: 'site.reset' })}>
          {t('Vider et recharger', 'Clear and reload')}
        </Button>
      </div>
    </div>
  );
}

export function ExtensionConfirmPopupView({ content }: { content: Extract<Content, { popup: 'extension-confirm' }> }) {
  return (
    <div className="popup arriving">
      <div className="popup-header">
        <span className="popup-header-title extension-title">
          {content.icon && <img src={content.icon} alt="" />}
          {content.update ? t(`Mettre à jour « ${content.name} » ?`, `Update “${content.name}”?`) : t(`Ajouter « ${content.name} » ?`, `Add “${content.name}”?`)}
        </span>
      </div>
      <p className="row-sub extension-note">
        {t(`Version ${content.version}, paquet signé du Chrome Web Store.`, `Version ${content.version}, signed Chrome Web Store package.`)}{' '}
        {content.access.length > 0 ? t('Elle pourra :', 'It can:') : t('Elle ne demande aucun accès particulier.', 'It asks for no special access.')}
      </p>
      {content.access.length > 0 && (
        <ul className="extension-access">
          {content.access.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="extension-confirm-actions">
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" onClick={() => send({ type: 'popup.close' })}>
          {t('Annuler', 'Cancel')}
        </Button>
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action primary" onClick={() => send({ type: 'extension.confirm', id: content.id })}>
          {content.update ? t('Mettre à jour', 'Update') : t('Ajouter l’extension', 'Add extension')}
        </Button>
      </div>
    </div>
  );
}

export function PermissionPopupView({ content, opening }: { content: Extract<Content, { popup: 'permission' }>; opening: number }) {
  return (
    <div key={opening} className="popup arriving" role="alertdialog" aria-label={t("Demande d'accès", 'Permission request')}>
      <div className="name-form">
        <span className="name-form-title">
          {content.site} {t('souhaite', 'wants to')} {content.what}
        </span>
        <p className="row-sub">
          {content.secure
            ? t('Votre réponse sera retenue pour ce site.', 'Your answer will be remembered for this site.')
            : t("Attention : la connexion à ce site n'est pas chiffrée. Votre réponse sera retenue pour ce site.", 'Warning: the connection to this site is not encrypted. Your answer will be remembered for this site.')}
        </p>
        <div className="name-form-actions">
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action" autoFocus onClick={() => send({ type: 'permission.answer', index: 0 })}>
            {t('Refuser', 'Deny')}
          </Button>
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="pill-action primary" onClick={() => send({ type: 'permission.answer', index: 1 })}>
            {t('Autoriser', 'Allow')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NoticePopupView({ content }: { content: Extract<Content, { popup: 'notice' }> }) {
  return (
    <div className="popup arriving">
      <div className="name-form">
        <span className="name-form-title">{content.title}</span>
        <p className="row-sub">{content.hint}</p>
        <div className="name-form-actions">
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} autoFocus className="pill-action primary" onClick={() => send({ type: 'popup.close' })}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
