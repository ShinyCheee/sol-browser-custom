import { Button } from '@/components/motion/button/base';
import { RangeSlider } from '@/components/motion/range-slider';
import { fontLabels, send } from './bridge';
import { t } from './i18n';
import type { Content } from './PopupTypes';
import { TintSettings, WallpaperSettings } from './SettingsFields';
import SolSelect from './SolSelect';

type SettingsContent = Extract<Content, { popup: 'settings' }>;

export function SettingsAppearance({
  content,
  hidden,
}: {
  content: SettingsContent;
  hidden: boolean;
}) {
  return (
    <>
      <div className="theme-row settings-scale" hidden={hidden}>
        <div className="settings-scale-heading">
          <span className="row-title">{t('Taille de l’interface', 'Interface size')}</span>
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action"
            aria-label={t('Réinitialiser la taille de l’interface à 100 %', 'Reset interface size to 100%')}
            onClick={() => send({ type: 'settings.set', id: 'uiScale', index: 0 })}
          >
            {Math.round(content.uiScale * 100)} %
          </Button>
        </div>
        <span className="row-sub">
          {t('Barres, boutons et menus. Le zoom des sites reste indépendant.', 'Bars, buttons and menus. Website zoom stays independent.')}
        </span>
        <RangeSlider
          aria-label={t('Taille de l’interface', 'Interface size')}
          min={80}
          max={100}
          step={5}
          value={Math.round(content.uiScale * 100)}
          formatValueText={value => `${value} %`}
          onValueChange={value => send({ type: 'settings.set', id: 'uiScale', index: [1, 0.9, 0.8, 0.95, 0.85].indexOf(value / 100) })}
        />
      </div>

      <div className="theme-row" hidden={hidden}>
        <span className="row-title">{t('Thème', 'Theme')}</span>
        <div className="popup-segment" role="radiogroup" aria-label={t('Thème', 'Theme')}>
          {[t('Par défaut', 'Default'), t('Clair', 'Light'), t('Sombre', 'Dark'), t('Système', 'System')].map((label, index) => (
            <Button
              variant="ghost"
              size="sm"
              pressScale={0.97}
              key={label}
              role="radio"
              aria-checked={content.theme === index}
              className={`popup-seg-btn${content.theme === index ? ' active' : ''}`}
              title={
                index === 0
                  ? t("L'interface suit la page visitée", 'The interface follows the visited page')
                  : index === 3
                    ? t('Suit le réglage clair ou sombre de Windows', 'Follows the Windows light or dark setting')
                    : undefined
              }
              onClick={() => send({ type: 'settings.set', id: 'theme', index })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="theme-row" hidden={hidden}>
        <span className="row-title">{t('Police', 'Font')}</span>
        <SolSelect
          id="font"
          label={t('Police', 'Font')}
          value={content.font}
          options={fontLabels(t('Défaut', 'Default'), t('Système', 'System'))}
          onChange={index => send({ type: 'settings.set', id: 'font', index })}
        />
      </div>

      {!hidden && <TintSettings items={content.tint} />}
      {!hidden && content.wallpaperOn && (
        <WallpaperSettings
          custom={content.wallpaperCustom}
          photo={content.wallpaper}
          daily={content.wallpaperDaily}
          photos={content.wallpapers}
        />
      )}
    </>
  );
}
