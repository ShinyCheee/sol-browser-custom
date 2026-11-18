import { Button } from '@/components/motion/button/base';
import { RangeSlider } from '@/components/motion/range-slider';
import { send } from './bridge';
import FanSettings from './FanSettings';
import { t, useLang } from './i18n';
import { Icon } from './Icons';
import type { Content } from './PopupTypes';
import { SettingsAppearance } from './SettingsAppearance';
import { HomeField } from './SettingsFields';
import { SettingsPopupList } from './SettingsSections';
import SolSelect from './SolSelect';
import SolTabs from './SolTabs';
import './settings-scale.css';

function formatSpellingLanguage(code: string, lang: 'fr' | 'en'): string {
  try {
    const label = new Intl.DisplayNames([lang], { type: 'language' }).of(code);
    if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    // Fallback to raw BCP-47 code when Intl.DisplayNames rejects an uncommon tag
  }
  return code;
}

export default function SettingsPopup({
  content,
  settingsSection,
  setSettingsSection,
  opening,
}: {
  content: Extract<Content, { popup: 'settings' }>;
  settingsSection: string;
  setSettingsSection: (section: string) => void;
  opening: number;
}) {
  const lang = useLang();
  const sections = [
    ['general', t('Général', 'General')],
    ['appearance', t('Apparence', 'Appearance')],
    ['privacy', t('Sécurité', 'Security')],
    ['data', t('Données', 'Data')],
    ['about', 'Sol'],
  ].map(([value, label]) => ({ value, label }));

  return (
    <div key={opening} className="popup settings-popup arriving">
      <div className="popup-header">
        <span className="popup-header-title">{t('Paramètres', 'Settings')}</span>
        <Button variant="ghost" size="sm" pressScale={0.97} className="settings-close" aria-label={t('Fermer', 'Close')} onClick={() => send({ type: 'popup.close' })}>
          <Icon d="M4 4l8 8M12 4l-8 8" size={14} />
        </Button>
      </div>

      <p className="settings-intro">{t('Les modifications sont enregistrées automatiquement.', 'Changes are saved automatically.')}</p>
      <SolTabs className="settings-nav" value={settingsSection} change={setSettingsSection} label={t('Sections des paramètres', 'Settings sections')} items={sections} />

      <div className="theme-row shortcuts-settings" hidden={settingsSection !== 'general'}>
        <div className="shortcuts-heading">
          <span className="row-title">{t('Commandes et raccourcis', 'Commands and shortcuts')}</span>
          <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => send({ type: 'palette.open' })}>
            {t('Ouvrir les commandes', 'Open commands')}
          </Button>
        </div>
        <p className="row-hint">{t('Accédez aux actions de Sol depuis le clavier. La palette s’ouvre avec Ctrl+Maj+P.', 'Access Sol actions from the keyboard. Open the palette with Ctrl+Shift+P.')}</p>
        <details>
          <summary>{t('Voir les raccourcis clavier', 'View keyboard shortcuts')}</summary>
          <div className="shortcuts-list">
            {content.shortcuts.map(s => (
              <div key={s.action} className="shortcut-setting">
                <span>{s.title}</span>
                <kbd>{s.keys}</kbd>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="theme-row" hidden={settingsSection !== 'general'}>
        <span className="row-title">{t('Qualité vidéo par défaut', 'Default video quality')}</span>
        <SolSelect
          id="video-quality"
          label={t('Qualité vidéo par défaut', 'Default video quality')}
          value={[0, 480, 720, 1080, 1440, 2160, 4320].indexOf(content.videoQuality)}
          options={[t('Meilleure disponible', 'Best available'), '480p', '720p', '1080p', '1440p', '4K · 2160p', '8K · 4320p']}
          onChange={index => send({ type: 'settings.set', id: 'videoQuality', index: [0, 480, 720, 1080, 1440, 2160, 4320][index] })}
        />
        <p className="row-hint">
          {t(
            'Si elle manque : meilleure qualité inférieure, sinon la plus basse disponible. Vous pouvez changer ce choix avant de télécharger.',
            'If unavailable: best lower quality, otherwise the lowest available. You can change this before downloading.',
          )}
        </p>
      </div>

      <div className="theme-row settings-scale" hidden={settingsSection !== 'general'}>
        <div className="settings-scale-heading">
          <span className="row-title">{t('Zoom des pages', 'Page zoom')}</span>
          <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" aria-label={t('Revenir à 100 %', 'Reset to 100%')} title={t('Revenir à 100 %', 'Reset to 100%')} onClick={() => send({ type: 'zoom.reset' })}>
            {content.zoom} %
          </Button>
        </div>
        <span className="setting-text">
          <span className="row-sub">{t('Conservé pour toutes les pages de ce profil. Ctrl +, Ctrl − ou Ctrl avec la molette.', 'Saved for all pages in this profile. Ctrl +, Ctrl − or Ctrl with the mouse wheel.')}</span>
        </span>
        <RangeSlider aria-label={t('Zoom des pages', 'Page zoom')} min={50} max={200} step={5} value={content.zoom} formatValueText={value => `${value} %`} onValueChange={value => send({ type: 'zoom.set', index: value })} />
      </div>

      <div className="theme-row" hidden={settingsSection !== 'general'}>
        <span className="row-title">{t('Langue', 'Language')}</span>
        <div className="popup-segment" role="radiogroup" aria-label={t('Langue', 'Language')}>
          {[t('Système', 'System'), 'Français', 'English'].map((label, index) => (
            <Button
              variant="ghost"
              size="sm"
              pressScale={0.97}
              key={label}
              role="radio"
              aria-checked={content.language === index}
              className={`popup-seg-btn${content.language === index ? ' active' : ''}`}
              title={index === 0 ? t('Suit la langue de Windows ; en anglais si elle est absente', 'Follows the Windows language; English if it is not available') : undefined}
              onClick={() => send({ type: 'settings.set', id: 'language', index })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="theme-row" hidden={settingsSection !== 'general'}>
        <span className="row-title">{t('Orthographe', 'Spelling')}</span>
        <div className="popup-segment" role="radiogroup" aria-label={t('Orthographe', 'Spelling')}>
          {[t('Désactivée', 'Off'), 'Français', 'English', t('Les deux', 'Both')].map((label, index) => (
            <Button variant="ghost" size="sm" pressScale={0.97} key={label} role="radio" aria-checked={content.spelling === index} className={`popup-seg-btn${content.spelling === index ? ' active' : ''}`} onClick={() => send({ type: 'settings.set', id: 'spelling', index })}>
              {label}
            </Button>
          ))}
        </div>
        <div className="popup-segment" role="radiogroup" aria-label={t('Grammaire en ligne', 'Online grammar')}>
          {[t('Locale seulement', 'Local only'), t('Grammaire en ligne', 'Online grammar')].map((label, index) => (
            <Button variant="ghost" size="sm" pressScale={0.97} key={label} role="radio" aria-checked={content.spellingOnline === (index === 1)} className={`popup-seg-btn${content.spellingOnline === (index === 1) ? ' active' : ''}`} onClick={() => send({ type: 'settings.set', id: 'spellingOnline', index })}>
              {label}
            </Button>
          ))}
        </div>
        {content.spellingOnline && (
          <p className="row-hint">
            {t(
              'Le texte saisi est envoyé à LanguageTool (service gratuit) pour vérifier la grammaire. Jamais en navigation privée, sur les pages de connexion ni dans les champs de mot de passe, de paiement ou d’identifiant.',
              'Typed text is sent to LanguageTool (free service) to check grammar. Never in private browsing, on sign-in pages or in password, payment or username fields.',
            )}
          </p>
        )}
        <p className="row-hint">
          {t('Correction locale · dictionnaires Windows : ', 'Local correction · Windows dictionaries: ')}
          {content.spellingLanguages.map(code => formatSpellingLanguage(code, lang)).join(', ') || t('aucun installé', 'none installed')}
        </p>
        {['fr', 'en'].some(prefix => !content.spellingLanguages.some(l => l.startsWith(prefix))) && (
          <p className="row-hint">
            {t('Une langue absente ne peut pas être corrigée. Ajoutez son option de saisie dans Windows, puis redémarrez Sol.', 'A missing language cannot be checked. Add its typing feature in Windows, then restart Sol.')}
          </p>
        )}
        <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => send({ type: 'spelling.languages' })}>
          {t('Dictionnaires Windows', 'Windows dictionaries')} ↗
        </Button>
      </div>

      <div className="theme-row" hidden={settingsSection !== 'general'}>
        <span className="row-title">{t('Moteur de recherche', 'Search engine')}</span>
        <SolSelect id="engine" label={t('Moteur de recherche', 'Search engine')} value={content.engine} options={content.engines} onChange={index => send({ type: 'settings.set', id: 'engine', index })} />
      </div>

      {settingsSection === 'general' && <FanSettings enabled={content.fanEnabled} trigger={content.fanTrigger} />}
      {settingsSection === 'general' && <HomeField key={content.home} home={content.home} />}

      <SettingsAppearance content={content} hidden={settingsSection !== 'appearance'} />
      <SettingsPopupList content={content} settingsSection={settingsSection} opening={opening} />
    </div>
  );
}
