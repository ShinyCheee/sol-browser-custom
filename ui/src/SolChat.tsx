import { Activity, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PromptInput } from '@/components/agents/prompt-input';
import { EyeTracker } from '@/components/bencho/EyeTracker';
import { onMessage, send } from './bridge';
import { t, useLang } from './i18n';
import { aiError } from './solAiMessages';
import type { AgentState } from './SolAiTrace';
import SolChatAttachments, { AttachmentActions, readAttachment, type ChatAttachment } from './SolChatAttachments';
import { SolChatMessages } from './SolChatMessages';
import type { VoiceState } from './solVoiceState';
import './chat.css';

const SolVoice = lazy(() => import('./SolVoice'));

type ChatState = {
  chat: true;
  ready: boolean;
  signingIn?: boolean;
  account: string;
  busy: boolean;
  error: string | null;
  messages: { from: 'user' | 'assistant'; text: string }[];
  agent?: AgentState;
  focus?: string;
  voice?: VoiceState;
  autoApproveActions?: boolean;
  attachments?: ChatAttachment[];
  attaching?: boolean;
  attachmentError?: string | null;
};

export default function SolChat() {
  useLang();
  const [state, setState] = useState<ChatState>({
    chat: true,
    ready: false,
    account: '',
    busy: false,
    error: null,
    messages: [],
  });
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const off = onMessage(data => {
      const visibility = data as { event?: string; open?: boolean };
      if (visibility.event === 'chat.visibility') {
        setVisible(visibility.open === true);
        return;
      }
      const next = data as ChatState;
      if (next?.chat) setState(next);
      else if (next?.voice) {
        setState(current =>
          current.voice?.open === next.voice!.open &&
          current.voice?.readAloud === next.voice!.readAloud &&
          current.voice?.error === next.voice!.error
            ? current
            : { ...current, voice: next.voice },
        );
      }
    });
    send({ type: 'chat.ready' });
    return off;
  }, []);

  const attach = (files: Iterable<File>) => {
    for (const file of files) readAttachment(file);
  };

  const pickSuggestion = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  };

  const action = state.agent?.steps.slice().reverse().find(step => step.status === 'active')?.label;

  const voiceOnly =
    state.ready &&
    state.voice?.open &&
    state.voice.readAloud &&
    !state.voice.error &&
    (!state.error || state.error === 'cancelled') &&
    !state.agent?.approval;

  if (voiceOnly) {
    return (
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <div className="sol-chat sol-chat-voice-only">
          <header className="sol-chat-head sol-voice-head">
            <strong>Sol AI</strong>
            <span className="sol-chat-plan" />
            <button className="pill-action" onClick={() => send({ type: 'voice.close' })}>
              {t('Discussion écrite', 'Written chat')}
            </button>
            <button className="pill-action" aria-label={t('Fermer', 'Close')} title={t('Fermer', 'Close')} onClick={() => send({ type: 'chat.toggle' })}>
              ×
            </button>
          </header>
          <Suspense fallback={null}>
            <SolVoice state={state.voice!} busy={state.busy} approval={false} action={action} />
          </Suspense>
        </div>
      </Activity>
    );
  }

  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <div
        className="sol-chat"
        data-eyt-frame
        onPaste={e => {
          if (state.ready && e.clipboardData.files.length) {
            e.preventDefault();
            attach(e.clipboardData.files);
          }
        }}
        onDragOver={e => {
          if (state.ready && e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={e => {
          e.preventDefault();
          if (state.ready) attach(e.dataTransfer.files);
        }}
      >
        <header className="sol-chat-head">
          {state.voice?.open && (
            <div className="sol-voice-inline">
              <Suspense fallback={null}>
                <SolVoice state={state.voice} busy={state.busy} approval={!!state.agent?.approval} action={action} />
              </Suspense>
            </div>
          )}
          {!!state.messages.length && <EyeTracker className="eyt-inline" size={24} eyeScale={1.5} />}
          <strong>Sol AI</strong>
          <span className="sol-chat-plan">{state.ready ? t('Forfait ChatGPT', 'ChatGPT plan') : ''}</span>
          <button className="pill-action" disabled={state.busy || !state.messages.length} onClick={() => send({ type: 'chat.clear' })}>
            {t('Nouvelle discussion', 'New chat')}
          </button>
          <button className="pill-action" aria-label={t('Fermer', 'Close')} title={t('Fermer', 'Close')} onClick={() => send({ type: 'chat.toggle' })}>
            ×
          </button>
        </header>

        <SolChatMessages
          messages={state.messages}
          busy={state.busy}
          ready={state.ready}
          focus={state.focus}
          agent={state.agent}
          error={state.error}
          voice={state.voice}
          onPickSuggestion={pickSuggestion}
        />

        {state.ready && state.autoApproveActions && (
          <p className="sol-chat-permission" role="status">
            {t('Actions toujours autorisées · modifiable dans Paramètres → Sol', 'Actions always allowed · change in Settings → Sol')}
          </p>
        )}
        {state.ready && (
          <SolChatAttachments
            files={state.attachments ?? []}
            busy={state.busy}
            attaching={state.attaching}
            error={state.attachmentError}
            onSend={!draft.trim() ? () => send({ type: 'chat.send', input: '' }) : undefined}
          />
        )}
        {state.ready ? (
          <PromptInput
            className="sol-chat-input"
            textareaRef={inputRef}
            value={draft}
            onValueChange={setDraft}
            minRows={1}
            maxRows={6}
            maxLength={20000}
            placeholder={t('Votre question…', 'Your question…')}
            aria-label={t('Question pour Sol AI', 'Question for Sol AI')}
            disabled={state.attaching}
            leadingAction={<AttachmentActions disabled={state.busy || !!state.attaching} />}
            loading={state.busy}
            onStop={() => send({ type: 'chat.cancel' })}
            onSubmit={value => {
              if (!value.trim() || state.busy || state.attaching) return;
              send({ type: 'chat.send', input: value });
              setDraft('');
            }}
          />
        ) : (
          <div className="sol-chat-connect">
            <p>
              {state.error
                ? aiError(state.error)
                : t('Connectez votre compte ChatGPT pour discuter avec Sol AI.', 'Connect your ChatGPT account to chat with Sol AI.')}
            </p>
            {state.signingIn ? (
              <>
                <p role="status">{t('Terminez la connexion dans le navigateur…', 'Finish signing in through the browser…')}</p>
                <button className="pill-action" onClick={() => send({ type: 'ai.connect.cancel' })}>
                  {t('Annuler', 'Cancel')}
                </button>
              </>
            ) : (
              <button className="pill-action primary" onClick={() => send({ type: 'ai.connect' })}>
                {t('Continuer avec ChatGPT', 'Continue with ChatGPT')}
              </button>
            )}
          </div>
        )}
      </div>
    </Activity>
  );
}
