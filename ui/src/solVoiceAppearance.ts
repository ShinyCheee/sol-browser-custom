import type { VoiceState } from './solVoiceState';

type Palette = readonly [string, string, string];
const palettes: Record<string, Palette> = {
  listening: ['#299eb5', '#c2f4ed', '#124b68'],
  transcribing: ['#bd8035', '#fff0bd', '#815022'],
  checking: ['#bd8035', '#fff0bd', '#815022'],
  thinking: ['#8b6dcc', '#eadbff', '#42386f'],
  acting: ['#4c83c4', '#dbedff', '#273d7e'],
  speaking: ['#4eaa8c', '#d8f3ba', '#215750'],
  paused: ['#768188', '#d7dfe3', '#3f484e'],
  error: ['#cc625d', '#ffddd0', '#702f44'],
};
export function voiceAppearance(state: VoiceState, busy: boolean, action?: string) {
  const stage = state.error ? 'error' : state.mode === 'thinking' || busy && state.mode === 'idle'
    ? action ? 'acting' : 'thinking' : state.mode;
  const processing = ['checking', 'installing', 'transcribing', 'thinking', 'acting'].includes(stage);
  return { stage, processing, colors: palettes[stage] ?? palettes.paused,
    activity: stage === 'listening' || stage === 'speaking' ? state.level : processing ? .24 : 0,
    speed: processing ? 1.8 : stage === 'listening' ? .65 : 1,
  };
}
