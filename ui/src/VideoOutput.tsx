import {useLayoutEffect,useRef} from 'react';
import {Button} from '@/components/motion/button/base';
import {RadioGroup,RadioGroupItem} from '@/components/motion/radio';
import {t} from './i18n';

export type VideoOutputFormat = 'video'|'flac'|'wav'|'mp3';
export const outputLabel=(format:VideoOutputFormat)=>format==='mp3'?'MP3 · 320 kb/s':format.toUpperCase();
const formats:VideoOutputFormat[]=['flac','wav','mp3'];

export function VideoOutput({value,onChange,audioAvailable=true}:{value:VideoOutputFormat;onChange:(value:VideoOutputFormat)=>void;audioAvailable?:boolean}) {
  const audio=value!=='video';
  const root=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    root.current?.querySelector('[role="radiogroup"]')?.setAttribute('aria-label',t('Format audio','Audio format'));
    root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]').forEach((button,index)=>{
      button.tabIndex=formats[index]===value?0:-1;
    });
  },[value]);
  return <>
    <div className="video-output-modes" role="group" aria-label={t('Type de téléchargement','Download type')}>
      <Button variant={audio?'secondary':'primary'} size="md" aria-pressed={!audio} onClick={()=>onChange('video')}>{t('Vidéo','Video')}</Button>
      <Button variant={audio?'primary':'secondary'} size="md" aria-pressed={audio} disabled={!audioAvailable} onClick={()=>{if(!audio)onChange('flac');}}>{t('Audio','Audio')}</Button>
    </div>
    {!audioAvailable&&<p className="video-help">{t('La conversion audio nécessite Windows 64 bits.','Audio conversion requires 64-bit Windows.')}</p>}
    {audio&&<>
      <h3 className="video-batch-quality">{t('Choisir le format audio','Choose audio format')}</h3>
      <div ref={root} onKeyDown={event=>{
        const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:['ArrowLeft','ArrowUp'].includes(event.key)?-1:0;
        if(!direction&&!['Home','End'].includes(event.key))return;
        event.preventDefault();
        const index=event.key==='Home'?0:event.key==='End'?formats.length-1:(formats.indexOf(value)+direction+formats.length)%formats.length;
        onChange(formats[index]);root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
      }}>
        <RadioGroup value={value} onValueChange={next=>onChange(next as VideoOutputFormat)} className="video-qualities">
          {formats.map(format=><RadioGroupItem key={format} value={format} label={outputLabel(format)}
            description={format==='mp3'?t('Débit maximal · avec perte','Maximum bitrate · lossy'):format==='flac'?t('Sans perte · compressé','Lossless · compressed'):t('Sans perte · non compressé','Lossless · uncompressed')}
            className={`video-quality-item ${format===value?'is-selected':''}`}/>)}
        </RadioGroup>
      </div>
      <p className="video-help">{t('Meilleure piste audio disponible. FLAC et WAV évitent une nouvelle compression avec perte, sans restaurer la qualité déjà perdue à la source.',
        'Best available audio track. FLAC and WAV avoid another lossy compression, without restoring quality already lost at the source.')}</p>
    </>}
  </>;
}
