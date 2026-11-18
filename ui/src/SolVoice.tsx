import { useEffect, useState } from 'react';
import { VoiceOrb } from '@/components/agents/voice-orb';
import { onMessage, send } from './bridge';
import { voiceAppearance } from './solVoiceAppearance';
import { type VoiceState, voiceError, voiceLabel } from './solVoiceState';
import './voice.css';

export type { VoiceState } from './solVoiceState';

export default function SolVoice({
  state: snapshot,
  busy,
  approval,
  action,
}: {
  state: VoiceState;
  busy: boolean;
  approval: boolean;
  action?: string;
}) {
  const [state, setState] = useState(snapshot);
  const [orbFailed, setOrbFailed] = useState(false);

  useEffect(() => setState(snapshot), [snapshot]);
  useEffect(
    () =>
      onMessage(data => {
        if ((data as { voice?: VoiceState })?.voice) setState((data as { voice: VoiceState }).voice);
      }),
    [],
  );

  const label = state.error ? voiceError(state.error) : action || voiceLabel(state, busy, approval);
  const appearance = voiceAppearance(state, busy, action);
  const command =
    state.mode === 'listening'
      ? 'voice.finish'
      : busy || state.mode === 'speaking' || state.mode === 'transcribing'
        ? 'voice.interrupt'
        : 'voice.listen';

  return (
    <section className="sol-voice" data-voice-mode={state.mode} data-voice-stage={appearance.stage}>
      <button className="sol-voice-target" title={label} aria-label={label} onClick={() => send({ type: command })}>
        <span className="voice-phase-ring" data-processing={appearance.processing} aria-hidden="true" />
        {orbFailed ? (
          <div className="sol-voice-orb voice-orb-fallback" aria-hidden="true" />
        ) : (
          <VoiceOrb
            activity={appearance.activity}
            speed={appearance.speed}
            colors={appearance.colors}
            active={state.open && state.mode !== 'error' && state.mode !== 'paused'}
            onError={() => setOrbFailed(true)}
            className="sol-voice-orb"
          />
        )}
      </button>
    </section>
  );
}
