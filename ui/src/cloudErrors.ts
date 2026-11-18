import { t } from './i18n';

export type CloudState = {
  email: string | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  auto?: boolean;
  last?: string | null;
  backups: { id: string; device: string; bytes: number; date: string }[];
};

export function cloudErrorText(code: string, keepsExisting = false): string {
  const messages: Record<string, string> = {
    credentials: t('Adresse ou mot de passe incorrect', 'Wrong email or password'),
    exists: t('Un compte existe déjà avec cette adresse', 'An account already exists for this email'),
    weak: t('Le mot de passe doit contenir au moins 8 caractères', 'The password needs at least 8 characters'),
    network: t('Connexion au service impossible', 'Could not reach the service'),
    'signed-out': t('Votre session a expiré, reconnectez-vous', 'Your session expired, sign in again'),
    'too-large': t('La sauvegarde dépasse 256 Mo', 'The backup exceeds 256 MB'),
    'key-rule': t(
      'Au moins 12 caractères, différente du mot de passe du compte',
      'At least 12 characters, different from the account password',
    ),
    'backup-size': t(
      'Le profil dépasse la taille autorisée. La sauvegarde existante est conservée.',
      'The profile exceeds the size limit. The existing backup is kept.',
    ),
    'backup-invalid': t(
      'Les données n’ont pas pu être archivées. La sauvegarde existante est conservée.',
      'The data could not be archived. The existing backup is kept.',
    ),
    key: keepsExisting
      ? t(
          'Cette clé n’ouvre pas la sauvegarde existante. Celle-ci est conservée.',
          'This key cannot open the existing backup. That backup is kept.',
        )
      : t('Cette clé n’ouvre pas la sauvegarde', 'This key does not open the backup'),
  };
  return messages[code] ?? t('Le service a refusé la demande, réessayez', 'The service rejected the request, try again');
}
