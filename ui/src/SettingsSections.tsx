import { useEffect, useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t } from './i18n';
import type { Content } from './PopupTypes';
import SettingsCloud from './SettingsCloud';
import { SiteData } from './SettingsFields';
import SettingToggle from './SettingToggle';
import SolAiAccount from './SolAiAccount';
import { AI_ENABLED } from './features';

type SettingsContent = Extract<Content, { popup: 'settings' }>;

export function SettingsPopupList({
  content,
  settingsSection,
  opening,
}: {
  content: SettingsContent;
  settingsSection: string;
  opening: number;
}) {
  const [confirmPermissions, setConfirmPermissions] = useState(false);

  useEffect(() => {
    setConfirmPermissions(false);
  }, [settingsSection, content.permissions]);

  useEffect(() => {
    if (!confirmPermissions) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConfirmPermissions(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmPermissions]);

  const sectionFor = (key: string) =>
    ['startWallpaper', 'scrollbars', 'blur'].includes(key)
      ? 'appearance'
      : ['onlineSuggestions', 'passwords'].includes(key)
        ? 'privacy'
        : 'general';

  return (
    <div className="popup-list">
      {content.items
        .filter(s => sectionFor(s.key) === settingsSection)
        .map(s => (
          <SettingToggle key={s.key} setting={s} />
        ))}

      <div className="setting-row static" hidden={settingsSection !== 'data'}>
        <span className="setting-text">
          <span className="row-title">{t('Importer d’un autre navigateur', 'Import from another browser')}</span>
          <span className="row-sub">
            {t(
              'Favoris, historique et mots de passe de Chrome, Edge, Brave, Comet… ou mots de passe d’un fichier CSV exporté.',
              'Bookmarks, history and passwords from Chrome, Edge, Brave, Comet… or passwords from an exported CSV file.',
            )}
          </span>
        </span>
        <span className="row-actions">
          <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => send({ type: 'welcome.open' })}>
            {t('Importer', 'Import')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action"
            onClick={() => send({ type: 'import.csv', id: 'settings' })}
          >
            {t('Fichier CSV', 'CSV file')}
          </Button>
        </span>
      </div>

      <div className="setting-row static" hidden={settingsSection !== 'general'}>
        <span className="setting-text">
          <span className="row-title">{t('Extensions', 'Extensions')}</span>
          <span className="row-sub">
            {t(
              'Ajouter celles de vos autres navigateurs (Mots de passe iCloud, par exemple) ou un dossier d’extension.',
              'Add the ones from your other browsers (iCloud Passwords, for example) or an extension folder.',
            )}
          </span>
        </span>
        <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => send({ type: 'extensions.open' })}>
          {t('Gérer', 'Manage')}
        </Button>
      </div>

      {AI_ENABLED && settingsSection === 'about' && <SolAiAccount ai={content.ai} />}

      <div className="setting-row static" hidden={settingsSection !== 'about'}>
        <span className="setting-text">
          <span className="row-title">Sol {content.version}</span>
          <span className="row-sub">
            {!content.update
              ? content.check === 'checking'
                ? t('Recherche d’une mise à jour…', 'Checking for updates…')
                : content.check === 'current'
                  ? t('Sol est à jour.', 'Sol is up to date.')
                  : content.check === 'failed'
                    ? t(
                        'La vérification a échoué. Vérifiez votre connexion et réessayez.',
                        'The check failed. Check your connection and try again.',
                      )
                    : content.check === 'portable'
                      ? t(
                          'Cette copie n’est pas installée : elle ne se met pas à jour toute seule.',
                          'This copy is not installed: it does not update itself.',
                        )
                      : content.check === 'store'
                        ? t('Les mises à jour sont gérées par le Microsoft Store.', 'Updates are managed by the Microsoft Store.')
                        : t('Les mises à jour se téléchargent automatiquement.', 'Updates are downloaded automatically.')
              : content.update.ready
                ? t(
                    `La version ${content.update.version} est prête. Redémarrez Sol pour l’installer.`,
                    `Version ${content.update.version} is ready. Restart Sol to install it.`,
                  )
                : t(
                    `Téléchargement de la version ${content.update.version} : ${content.update.percent} %`,
                    `Downloading version ${content.update.version}: ${content.update.percent}%`,
                  )}
          </span>
        </span>
        {content.update?.ready && (
          <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action primary" onClick={() => send({ type: 'update.restart' })}>
            {t('Redémarrer', 'Restart')}
          </Button>
        )}
        {!content.update && content.check !== 'portable' && content.check !== 'store' && (
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action"
            disabled={content.check === 'checking'}
            onClick={() => send({ type: 'update.check' })}
          >
            {t('Vérifier', 'Check')}
          </Button>
        )}
      </div>

      <div className="setting-row static" hidden={settingsSection !== 'data'}>
        <span className="setting-text">
          <span className="row-title">{t('Sauvegarde', 'Backup')}</span>
          <span className="row-sub">
            {t(
              'Réglages, onglets, favoris, historique, notes et mots de passe dans un fichier chiffré par une clé que vous choisissez.',
              'Settings, tabs, bookmarks, history, notes and passwords in a file encrypted with a key you choose.',
            )}
          </span>
        </span>
        <span className="row-actions">
          <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => send({ type: 'backup.export' })}>
            {t('Exporter', 'Export')}
          </Button>
          <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => send({ type: 'backup.import' })}>
            {t('Restaurer', 'Restore')}
          </Button>
        </span>
      </div>

      {content.cloud && <SettingsCloud cloud={content.cloud} hidden={settingsSection !== 'data'} />}

      <div className="setting-row static" hidden={settingsSection !== 'privacy'}>
        <span className="setting-text">
          <span className="row-title">{t('Accès accordés aux sites', 'Site permissions')}</span>
          <span className="row-sub">
            {content.permissions === 0
              ? t('Aucune réponse retenue : chaque site demandera.', 'No saved answer: every site will ask.')
              : t(
                  `${content.permissions} réponse${content.permissions > 1 ? 's' : ''} retenue${content.permissions > 1 ? 's' : ''} (micro, caméra, position, notifications…)`,
                  `${content.permissions} saved answer${content.permissions > 1 ? 's' : ''} (microphone, camera, location, notifications…)`,
                )}
          </span>
        </span>
        <span className="row-actions">
          {confirmPermissions && (
            <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => setConfirmPermissions(false)}>
              {t('Annuler', 'Cancel')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action"
            disabled={content.permissions === 0}
            onClick={() => {
              if (!confirmPermissions) {
                setConfirmPermissions(true);
                return;
              }
              setConfirmPermissions(false);
              send({ type: 'permissions.clear' });
            }}
          >
            {confirmPermissions ? t('Confirmer', 'Confirm') : t('Tout oublier', 'Forget all')}
          </Button>
        </span>
      </div>

      {settingsSection === 'privacy' && <SiteData status={content.siteData} key={opening} />}
      {settingsSection === 'privacy' && content.sites.length > 0 && (
        <div className="setting-sub">
          {content.sites.map(site => (
            <div key={site.origin} className="setting-row static">
              <span className="setting-text" title={site.origin}>
                <span className="row-title">{site.host}</span>
                <span className="row-sub">{site.summary}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                pressScale={0.97}
                className="pill-action"
                aria-label={t(`Oublier les réponses données à ${site.host}`, `Forget the answers given to ${site.host}`)}
                onClick={() => send({ type: 'permissions.forget', id: site.origin })}
              >
                {t('Oublier', 'Forget')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
