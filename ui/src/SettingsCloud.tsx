import { useEffect, useState, type FormEvent } from 'react';
import { Cloud, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/motion/button/base';
import { Card } from '@/components/motion/card';
import { Input } from '@/components/motion/input';
import { Switch } from '@/components/motion/switch';
import { send } from './bridge';
import { cloudErrorText, type CloudState } from './cloudErrors';
import { t } from './i18n';
import SolTabs from './SolTabs';
import './settings-cloud.css';

export type { CloudState } from './cloudErrors';

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} ${t('Ko', 'KB')}`
    : `${(bytes / 1024 / 1024).toFixed(1)} ${t('Mo', 'MB')}`;

export default function SettingsCloud({ cloud, hidden }: { cloud: CloudState; hidden: boolean }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!hidden) send({ type: 'cloud.refresh' });
  }, [hidden]);

  useEffect(() => {
    if (cloud.email) setPassword('');
  }, [cloud.email]);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirm]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (trimmedEmail && password && !cloud.busy) {
      send({ type: 'cloud.sign', id: mode, query: trimmedEmail, input: password });
    }
  };

  return (
    <Card size="compact" className="sol-extension-card sol-cloud" hidden={hidden} aria-busy={cloud.busy}>
      <div className="sol-cloud-head">
        <span className="row-badge" aria-hidden>
          <Cloud size={16} strokeWidth={1.5} />
        </span>
        <span className="setting-text">
          <span className="row-title">{t('Sauvegarde en ligne', 'Online backup')}</span>
          <span className="row-sub">
            {cloud.email ?? t('Retrouvez votre profil Sol sur un autre PC', 'Get your Sol profile back on another PC')}
          </span>
        </span>
        {cloud.email && (
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action"
            disabled={cloud.busy}
            onClick={() => send({ type: 'cloud.signout' })}
          >
            {t('Se déconnecter', 'Sign out')}
          </Button>
        )}
      </div>

      {cloud.email ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action primary sol-cloud-main"
            disabled={cloud.busy}
            onClick={() => send({ type: 'cloud.backup' })}
          >
            {cloud.busy ? t('En cours…', 'Working…') : t('Sauvegarder maintenant', 'Back up now')}
          </Button>
          <p className="row-hint">
            {t(
              'Met à jour la sauvegarde de ce PC avec la même clé, protégée par Windows.',
              'Updates this PC’s backup with the same key, protected by Windows.',
            )}
          </p>
          <div className="sol-cloud-auto">
            <span className="setting-text">
              <span className="row-title">{t('Sauvegarde automatique', 'Automatic backup')}</span>
              <span className="row-sub">
                {cloud.auto
                  ? cloud.last
                    ? t(`Toutes les 24 h · dernière le ${cloud.last}`, `Every 24 h · last on ${cloud.last}`)
                    : t('Toutes les 24 h', 'Every 24 h')
                  : t('Désactivée', 'Off')}
              </span>
            </span>
            <Switch
              checked={!!cloud.auto}
              ariaLabel={t('Sauvegarde automatique', 'Automatic backup')}
              onCheckedChange={on => send({ type: 'cloud.auto', index: on ? 1 : 0 })}
            />
          </div>
          {!cloud.backups.length && !cloud.busy && (
            <p className="row-hint">{t('Aucune sauvegarde pour l’instant', 'No backup yet')}</p>
          )}
          {!!cloud.backups.length && (
            <ul className="sol-cloud-list" aria-label={t('Sauvegardes', 'Backups')}>
              {cloud.backups.map(b => (
                <li key={b.id}>
                  <span className="setting-text">
                    <span className="row-title">{b.date}</span>
                    <span className="row-sub">
                      {b.device} · {size(b.bytes)}
                    </span>
                  </span>
                  {confirm === b.id ? (
                    <span className="row-actions">
                      <Button variant="ghost" size="sm" pressScale={0.97} className="pill-action" onClick={() => setConfirm(null)}>
                        {t('Garder', 'Keep')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        pressScale={0.97}
                        className="pill-action sol-remove-extension"
                        disabled={cloud.busy}
                        onClick={() => {
                          setConfirm(null);
                          send({ type: 'cloud.delete', id: b.id });
                        }}
                      >
                        {t('Supprimer définitivement', 'Delete for good')}
                      </Button>
                    </span>
                  ) : (
                    <span className="row-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        pressScale={0.97}
                        className="pill-action"
                        disabled={cloud.busy}
                        aria-label={t(`Restaurer la sauvegarde du ${b.date}`, `Restore the ${b.date} backup`)}
                        onClick={() => send({ type: 'cloud.restore', id: b.id })}
                      >
                        {t('Restaurer', 'Restore')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        pressScale={0.97}
                        className="pill-action"
                        disabled={cloud.busy}
                        aria-label={t(`Supprimer la sauvegarde du ${b.date}`, `Delete the ${b.date} backup`)}
                        onClick={() => setConfirm(b.id)}
                      >
                        {t('Supprimer', 'Delete')}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form className="sol-cloud-form" onSubmit={submit}>
          <SolTabs
            className="sol-cloud-tabs"
            label={t('Compte', 'Account')}
            value={mode}
            change={v => setMode(v as 'in' | 'up')}
            items={[
              { value: 'in', label: t('Se connecter', 'Sign in'), ariaLabel: t('Se connecter', 'Sign in') },
              { value: 'up', label: t('Créer un compte', 'Create account'), ariaLabel: t('Créer un compte', 'Create account') },
            ]}
          />
          <Input
            className="sol-popup-input"
            classNames={{ field: 'sol-popup-input-field' }}
            label={t('Adresse e-mail', 'Email')}
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={setEmail}
          />
          <Input
            className="sol-popup-input"
            classNames={{ field: 'sol-popup-input-field' }}
            label={t('Mot de passe du compte', 'Account password')}
            type="password"
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={setPassword}
          />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            pressScale={0.97}
            className="pill-action primary sol-cloud-main"
            disabled={cloud.busy || !email.trim() || !password}
          >
            {cloud.busy
              ? t('En cours…', 'Working…')
              : mode === 'up'
                ? t('Créer le compte', 'Create the account')
                : t('Se connecter', 'Sign in')}
          </Button>
        </form>
      )}

      {cloud.error && (
        <p className="row-hint sol-cloud-error" role="alert">
          {cloudErrorText(cloud.error, true)}
        </p>
      )}
      <p className="row-hint sol-cloud-note">
        <LockKeyhole size={14} strokeWidth={1.5} aria-hidden />
        <span>
          {t(
            'Favoris, historique, notes et mots de passe sont chiffrés sur ce PC avec une clé que vous seul connaissez. Sans elle, personne ne peut les lire ni les retrouver.',
            'Bookmarks, history, notes and passwords are encrypted on this PC with a key only you know. Without it, nobody can read or recover them.',
          )}
        </span>
      </p>
    </Card>
  );
}
