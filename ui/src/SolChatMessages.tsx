import { Copy, NotebookPen } from 'lucide-react';
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageScroller,
  MessageTyping,
} from '@/components/agents/message';
import { CornerActions } from '@/components/bencho/CornerActions';
import { EyeTracker } from '@/components/bencho/EyeTracker';
import { send } from './bridge';
import { t } from './i18n';
import { aiError } from './solAiMessages';
import SolAiTrace, { type AgentState } from './SolAiTrace';
import SolMarkdown from './SolMarkdown';
import { voiceError, type VoiceState } from './solVoiceState';

const suggestions = (focus?: string) =>
  focus === 'developer'
    ? [
        t('Ouvre l’inspecteur réseau de cet onglet', 'Open the network inspector for this tab'),
        t('Explique cette erreur et propose une correction : ', 'Explain this error and suggest a fix: '),
        t(
          'Quels appareils puis-je simuler pour tester le responsive ?',
          'Which devices can I simulate to test responsive layouts?',
        ),
      ]
    : focus === 'notes'
      ? [
          t('Résume mes notes récentes', 'Summarize my recent notes'),
          t('Cherche dans mes notes : ', 'Search my notes for: '),
          t('Crée une note avec les points clés de cette page', 'Create a note with the key points of this page'),
        ]
      : [
          t('Prépare un espace de travail avec ', 'Prepare a workspace with '),
          t('Aide-moi à remplir ce formulaire', 'Help me fill this form'),
          t('Résume cette page', 'Summarize this page'),
        ];

export function SolChatMessages({
  messages,
  busy,
  ready,
  focus,
  agent,
  error,
  voice,
  onPickSuggestion,
}: {
  messages: { from: 'user' | 'assistant'; text: string }[];
  busy: boolean;
  ready: boolean;
  focus?: string;
  agent?: AgentState;
  error: string | null;
  voice?: VoiceState;
  onPickSuggestion: (text: string) => void;
}) {
  return (
    <MessageScroller className="sol-chat-log" label={t('Discussion', 'Conversation')} busy={busy}>
      {!messages.length && (
        <div className="sol-chat-empty">
          <EyeTracker className="eyt-inline sol-chat-mascot" size={72} />
          <p>
            {focus === 'developer'
              ? t(
                  'Demandez un diagnostic, une correction de code, une simulation réseau ou un test responsive. Pour l’analyse demandée, les erreurs et détails utiles sont envoyés à ChatGPT avec masquage des secrets connus.',
                  'Ask for a diagnosis, code fix, network simulation or responsive test. Requested analysis sends relevant errors and details to ChatGPT with known secrets masked.',
                )
              : focus === 'notes'
                ? t('Sol AI peut chercher, résumer et créer vos notes.', 'Sol AI can search, summarize and create your notes.')
                : t(
                    'Demandez à Sol AI de parcourir un site, remplir un formulaire, organiser vos onglets ou préparer un espace de travail avec vos notes.',
                    'Ask Sol AI to browse a site, fill a form, organize your tabs or prepare a workspace with your notes.',
                  )}
          </p>
          {ready && (
            <div className="sol-chat-suggestions">
              {suggestions(focus).map(s => (
                <button key={s} className="pill-action" onClick={() => onPickSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {messages.map((m, i) => (
        <Message key={i} from={m.from} animateIn={i === messages.length - 1}>
          <MessageContent>
            {m.from === 'assistant' && !m.text && busy && i === messages.length - 1 ? (
              <MessageTyping label={t('Sol AI répond', 'Sol AI is answering')} />
            ) : m.from === 'assistant' && m.text && !(busy && i === messages.length - 1) ? (
              <CornerActions
                layout="inline"
                actions={[
                  { id: 'copy', label: t('Copier la réponse', 'Copy the answer'), Icon: Copy, run: () => send({ type: 'chat.copy', id: String(i) }) },
                  { id: 'note', label: t('En faire une note', 'Make it a note'), Icon: NotebookPen, run: () => send({ type: 'chat.note', id: String(i) }) },
                ]}
              >
                <MessageBubble variant="ghost">
                  <MessageBubbleContent>
                    <SolMarkdown text={m.text} />
                  </MessageBubbleContent>
                </MessageBubble>
              </CornerActions>
            ) : (
              <MessageBubble variant={m.from === 'user' ? 'solid' : 'ghost'}>
                <MessageBubbleContent>{m.from === 'user' ? m.text : <SolMarkdown text={m.text} />}</MessageBubbleContent>
              </MessageBubble>
            )}
          </MessageContent>
        </Message>
      ))}

      <SolAiTrace agent={agent ?? null} busy={busy} />
      {error && error !== 'cancelled' && (
        <p role="alert" className="sol-chat-error">
          {aiError(error)}
        </p>
      )}
      {voice?.error && (
        <p role="alert" className="sol-chat-error">
          {voiceError(voice.error)}
        </p>
      )}
    </MessageScroller>
  );
}
