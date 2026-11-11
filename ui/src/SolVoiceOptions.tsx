import { Switch } from '@/components/motion/switch';
import SolSelect from './SolSelect';
import { send } from './bridge';
import { t } from './i18n';
import type { VoiceState } from './solVoiceState';

export default function SolVoiceOptions({ state }: { state: VoiceState }) {
  const option = (id: string, index: number) => send({ type: 'voice.options', id, index });
  const devices = [{ id: -1, name: t('Microphone par défaut', 'Default microphone') }, ...(state.devices ?? [])];
  return <div className="voice-options">
    <Switch className="sol-switch voice-read-aloud" checked={state.readAloud} onCheckedChange={value => option('readAloud', value ? 1 : 0)} label={t('Réponses à voix haute', 'Spoken responses')} />
    <SolSelect id="voice-device" label={t('Microphone', 'Microphone')} value={Math.max(0, devices.findIndex(d => d.id === state.device))} options={devices.map(d => d.name)} onChange={index => option('device', devices[index].id)} />
  </div>;
}
