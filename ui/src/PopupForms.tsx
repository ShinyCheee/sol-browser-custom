import { useState } from 'react';
import { Button } from '@/components/motion/button/base';
import { Checkbox } from '@/components/motion/checkbox';
import { Input } from '@/components/motion/input';
import { send } from './bridge';
import { t } from './i18n';
import type { Content } from './PopupTypes';

export function NameForm({ ask }: { ask: Extract<Content, { popup: 'prompt' }> }) {
  const [name, setName] = useState(ask.value);
  return (
    <div className="popup arriving">
      <form
        className="name-form"
        onSubmit={e => {
          e.preventDefault();
          if (name.trim()) {
            send({ type: ask.command, id: ask.id ?? undefined, title: ask.secret ? name : name.trim() });
          }
        }}
      >
        <label htmlFor="name-input" className="name-form-title">
          {ask.title}
        </label>
        {ask.hint && <p className="row-sub">{ask.hint}</p>}
        <Input
          className="sol-popup-input"
          classNames={{ field: 'sol-popup-input-field' }}
          id="name-input"
          type={ask.secret ? 'password' : 'text'}
          autoFocus
          maxLength={ask.secret ? 128 : 40}
          placeholder={ask.placeholder}
          spellCheck={false}
          value={name}
          onChange={setName}
          onFocus={e => e.target.select()}
        />
        <div className="name-form-actions">
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="button" className="pill-action" onClick={() => send({ type: 'popup.close' })}>
            {t('Annuler', 'Cancel')}
          </Button>
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="submit" className="pill-action primary" disabled={!name.trim()}>
            {ask.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Modification d'un raccourci de la carte latérale : son nom (vide = celui du site) et son adresse.
export function ShortcutForm({ ask }: { ask: Extract<Content, { popup: 'shortcut-edit' }> }) {
  const [name, setName] = useState(ask.name);
  const [url, setUrl] = useState(ask.url);
  return (
    <div className="popup arriving">
      <form
        className="name-form"
        onSubmit={e => {
          e.preventDefault();
          if (url.trim()) send({ type: 'shortcut.update', id: ask.id, title: name.trim(), input: url.trim() });
        }}
      >
        <span className="name-form-title">{t('Modifier le raccourci', 'Edit shortcut')}</span>
        <label htmlFor="name-input" className="row-sub">
          {t('Nom (vide : celui du site)', "Name (empty: the site's own)")}
        </label>
        <Input
          className="sol-popup-input"
          classNames={{ field: 'sol-popup-input-field' }}
          id="name-input"
          autoFocus
          maxLength={24}
          spellCheck={false}
          value={name}
          onChange={setName}
          onFocus={e => e.target.select()}
        />
        <label htmlFor="url-input" className="row-sub">
          {t('Adresse', 'Address')}
        </label>
        <Input
          className="sol-popup-input"
          classNames={{ field: 'sol-popup-input-field' }}
          id="url-input"
          type="text"
          inputMode="url"
          maxLength={2000}
          placeholder="https://…"
          spellCheck={false}
          value={url}
          onChange={setUrl}
        />
        <div className="name-form-actions">
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="button" className="pill-action" onClick={() => send({ type: 'popup.close' })}>
            {t('Annuler', 'Cancel')}
          </Button>
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="submit" className="pill-action primary" disabled={!url.trim()}>
            {t('Enregistrer', 'Save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Choix des écrans de la comparaison : de « min » à « max » appareils, affichés côte à côte.
export function ComparePicker({ ask }: { ask: Extract<Content, { popup: 'compare-pick' }> }) {
  const [chosen, setChosen] = useState(() => ask.devices.filter(d => d.on).map(d => d.name));
  const valid = chosen.length >= ask.min && chosen.length <= ask.max;
  return (
    <div className="popup arriving">
      <form
        className="name-form"
        onSubmit={e => {
          e.preventDefault();
          if (valid) send({ type: 'device.compare', id: ask.id, query: chosen.join('|') });
        }}
      >
        <span className="name-form-title">{t('Écrans à comparer', 'Screens to compare')}</span>
        <p className="row-sub">
          {t(`De ${ask.min} à ${ask.max} écrans, affichés côte à côte.`, `${ask.min} to ${ask.max} screens, shown side by side.`)}
        </p>
        <div className="popup-list">
          {ask.devices.map(d => {
            const on = chosen.includes(d.name);
            return (
              <div key={d.name} className="setting-row sol-setting">
                <label className="setting-text" htmlFor={`compare-${d.name}`}>
                  <span className="row-title">{d.label}</span>
                  <span className="row-sub">{d.size}</span>
                </label>
                <Checkbox
                  id={`compare-${d.name}`}
                  className="sol-checkbox"
                  aria-label={d.label}
                  checked={on}
                  disabled={!on && chosen.length >= ask.max}
                  onCheckedChange={checked =>
                    setChosen(checked ? [...chosen, d.name] : chosen.filter(n => n !== d.name))
                  }
                />
              </div>
            );
          })}
        </div>
        <div className="name-form-actions">
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="button" className="pill-action" onClick={() => send({ type: 'popup.close' })}>
            {t('Annuler', 'Cancel')}
          </Button>
          <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} type="submit" className="pill-action primary" disabled={!valid}>
            {t('Comparer', 'Compare')}
          </Button>
        </div>
      </form>
    </div>
  );
}
