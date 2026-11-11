import { t } from './i18n';

export type VoiceState = {
  available?: boolean; supported: boolean; open: boolean; ready: boolean; provider: 'parakeet';
  mode: 'idle' | 'checking' | 'installing' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'approval' | 'paused' | 'error';
  level: number; text: string; error: string | null; conversation: boolean; readAloud: boolean;
  device: number; devices: { id: number; name: string }[]; progress: number; downloadMiB: number; seconds?: number;
};
export function voiceError(code: string) {
  switch (code) {
    case 'microphone': return t('Microphone indisponible. Vérifiez le périphérique et l’accès au micro dans Windows.', 'Microphone unavailable. Check your device and Windows microphone access.');
    case 'voice-busy': return t('Une autre fenêtre Sol utilise la voix. Arrêtez-la pour parler ici.', 'Another Sol window is using voice. Stop it to speak here.');
    case 'voice-timeout': return t('Écoute mise en pause après un silence. Reprenez quand vous êtes prêt.', 'Listening paused after silence. Resume when you are ready.');
    case 'no-speech': return t('Aucune parole détectée. Réessayez près du micro.', 'No speech detected. Try again closer to your microphone.');
    case 'voice-slow': return t('La transcription prend trop de temps sur cet appareil. Réessayez une phrase plus courte ou utilisez le chat.', 'Transcription is taking too long on this device. Try a shorter phrase or use the chat.');
    case 'model-missing': return t('Installez le modèle vocal avant de parler.', 'Install the voice model before speaking.');
    case 'model-invalid': return t('Le fichier reçu est incomplet ou endommagé. Réessayez le téléchargement.', 'The downloaded file is incomplete or damaged. Try downloading again.');
    case 'model-download': return t('Téléchargement impossible. Vérifiez la connexion et l’espace disque, ou réessayez après l’installation dans une autre fenêtre.', 'Download failed. Check your connection and disk space, or retry after installation in another window.');
    case 'speech': return t('Lecture vocale indisponible. La réponse reste dans la discussion. Vous pouvez réessayer.', 'Speech playback unavailable. The answer remains in the conversation. You can try again.');
    default: return t('La transcription locale a échoué. Réessayez votre consigne.', 'Local transcription failed. Try your instruction again.');
  }
}
export function voiceLabel(state: VoiceState, busy: boolean, approval: boolean) {
  if (state.mode === 'checking') return t('Vérification du modèle…', 'Checking model…');
  if (state.mode === 'installing') return t('Installation de la voix…', 'Installing voice…');
  if (!state.ready) return t('Parlez à Sol AI', 'Speak to Sol AI');
  if (state.mode === 'listening') return t('Je vous écoute…', 'Listening…');
  if (state.mode === 'transcribing') return t('Transcription sur cet appareil…', 'Transcribing on this device…');
  if (state.mode === 'speaking') return t('Sol AI vous répond', 'Sol AI is speaking');
  if (state.mode === 'thinking') return t('Sol AI traite votre demande…', 'Sol AI is processing your request…');
  if (approval) return t('Votre accord est nécessaire', 'Your approval is needed');
  if (busy) return t('Sol AI agit…', 'Sol AI is working…');
  if (state.mode === 'paused') return t('Écoute en pause', 'Listening paused');
  return t('À vous de parler', 'Your turn to speak');
}
