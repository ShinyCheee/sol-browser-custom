import { useEffect } from 'react';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import { t } from './i18n';
import SolVoiceOptions from './SolVoiceOptions';
import { type VoiceState, voiceError } from './solVoiceState';
import './voice.css';

export default function SolVoiceSettings({ state }: { state?: VoiceState }) {
  useEffect(() => {
    send({ type: 'voice.configure' });
  }, []);

  if (!state) return null;
  const installing = state.mode === 'installing';
  const checking = state.mode === 'checking';

  return (
    <div className="theme-row voice-settings">
      <span className="row-title">{t('Voix de Sol AI', 'Sol AI voice')}</span>
      <p className="row-hint">
        {t(
          'Ctrl+M pour démarrer ou arrêter. Posez une question ou donnez des consignes naturellement, dans la même discussion.',
          'Ctrl+M to start or stop. Ask questions or give instructions naturally in the same conversation.',
        )}
      </p>
      <p className="row-hint">
        {t(
          'Bleu : écoute · Ambre : transcription · Violet : réflexion · Vert : réponse. Une pause envoie votre demande ; cliquer sur l’orbe permet d’envoyer plus tôt ou d’interrompre.',
          'Blue: listening · Amber: transcription · Purple: thinking · Green: speaking. A pause sends your request; click the orb to send sooner or interrupt.',
        )}
      </p>
      {!state.supported ? (
        <p className="row-hint">
          {t('Un moteur compatible Windows x64 est nécessaire.', 'A compatible Windows x64 engine is required.')}
        </p>
      ) : !state.ready ? (
        <>
          <p className="row-hint">
            {t('Parakeet Ultra : 706 Mo. Modèle et voix :', 'Parakeet Ultra: 706 MB. Model and voice:')}{' '}
            {state.downloadMiB} {t('Mo', 'MB')}.
          </p>
          {installing ? (
            <>
              <progress
                className="voice-progress"
                max={1}
                value={state.progress}
                aria-label={t('Installation de la voix', 'Voice installation')}
              />
              <Button size="sm" variant="ghost" className="pill-action" onClick={() => send({ type: 'voice.cancelInstall' })}>
                {t('Annuler', 'Cancel')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="pill-action voice-install"
              disabled={checking}
              onClick={() => send({ type: 'voice.install' })}
            >
              {checking ? t('Vérification…', 'Checking…') : t('Installer la voix', 'Install voice')}
            </Button>
          )}
        </>
      ) : (
        <SolVoiceOptions state={state} />
      )}
      {state.error && (
        <p className="row-hint" role="alert">
          {voiceError(state.error)}
        </p>
      )}
      {state.error === 'microphone' && (
        <Button size="sm" variant="ghost" className="pill-action" onClick={() => send({ type: 'voice.settings' })}>
          {t('Accès au micro Windows', 'Windows microphone access')}
        </Button>
      )}
      <p className="row-hint">
        {t(
          'Audio local · Texte envoyé à ChatGPT · Voix de synthèse',
          'Local audio · Text sent to ChatGPT · Synthetic voice',
        )}
      </p>
    </div>
  );
}
