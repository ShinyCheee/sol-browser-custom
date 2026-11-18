import { useEffect, useRef, useState } from 'react';
import { send } from './bridge';
import { t } from './i18n';

const MAX_NOTE_BLOB_BYTES = 20 * 1024 * 1024;

export function attachNoteBlob(
  blob: Blob,
  name: string,
  id: string,
  onError?: (message: string) => void,
): boolean {
  if (blob.size > MAX_NOTE_BLOB_BYTES) {
    onError?.(t('Ce fichier dépasse la limite de 20 Mo.', 'This file exceeds the 20 MB limit.'));
    return false;
  }
  const reader = new FileReader();
  reader.onload = () => {
    onError?.('');
    const result = String(reader.result);
    send({ type: 'notes.attach', id, title: name, input: result.slice(result.indexOf(',') + 1) });
  };
  reader.onerror = () => {
    onError?.(t('Impossible de lire la pièce jointe.', 'Could not read the attachment.'));
  };
  reader.readAsDataURL(blob);
  return true;
}

export default function NoteAudio({ id }: { id: string }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const currentId = useRef(id);
  currentId.current = id;

  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    },
    [],
  );

  const start = async () => {
    setPreparing(true);
    try {
      cancelled.current = false;
      setError('');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled.current) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = media;
      const next = new MediaRecorder(media);
      recorder.current = next;
      chunks.current = [];
      next.ondataavailable = e => {
        if (e.data.size) chunks.current.push(e.data);
        if (chunks.current.reduce((sum, part) => sum + part.size, 0) > MAX_NOTE_BLOB_BYTES) {
          cancelled.current = true;
          if (next.state !== 'inactive') next.stop();
          setError(t('Enregistrement trop volumineux.', 'Recording is too large.'));
        }
      };
      next.onstop = () => {
        media.getTracks().forEach(track => track.stop());
        setRecording(false);
        if (!cancelled.current) {
          const blob = new Blob(chunks.current, { type: next.mimeType });
          if (blob.size) {
            attachNoteBlob(blob, `Note-${Date.now()}.webm`, currentId.current, setError);
          } else {
            setError(
              t('Enregistrement vide. Réessayez avec le microphone actif.', 'Empty recording. Try again with an active microphone.'),
            );
          }
        }
      };
      next.start(1000);
      setRecording(true);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      setError(t('Microphone indisponible ou autorisation refusée.', 'Microphone unavailable or permission denied.'));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="note-audio">
      <button
        className="pill-action"
        disabled={preparing}
        onClick={() => (recording ? recorder.current?.stop() : start())}
      >
        {recording
          ? t('Terminer l’enregistrement', 'Finish recording')
          : preparing
            ? t('Accès au microphone…', 'Accessing microphone…')
            : t('Note vocale', 'Voice note')}
      </button>
      {recording && (
        <button
          className="pill-action"
          onClick={() => {
            cancelled.current = true;
            recorder.current?.stop();
          }}
        >
          {t('Annuler', 'Cancel')}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
