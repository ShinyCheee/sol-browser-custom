import { lazy, Suspense, useEffect, useRef } from 'react';
import { Button } from '@/components/motion/button/base';
import { send } from './bridge';
import CommandPalette from './CommandPalette';
import { DownloadCard } from './Downloads';
import ExtensionsPopup from './ExtensionsPopup';
import GroupEditor from './GroupEditor';
import { t } from './i18n';
import LanPreview from './LanPreview';
import LibraryPopup from './LibraryPopup';
import {
  ExtensionConfirmPopupView,
  NoticePopupView,
  PermissionPopupView,
  SiteResetPopupView,
  SplitLayoutPopupView,
  TranslationPopupView,
} from './PopupDialogs';
import { ComparePicker, NameForm, ShortcutForm } from './PopupForms';
import { ProfileList, SessionPicker } from './PopupProfiles';
import Row from './PopupRow';
import type { Content } from './PopupTypes';
import QuickNotes from './QuickNotes';
import SettingsPopup from './SettingsPopup';
import SolMenu from './SolMenu';
import VideoPicker from './VideoPicker';
import WorkspaceSnapshots from './WorkspaceSnapshots';
import './suggestions-layout.css';

const SolAiAction = lazy(() => import('./SolAiAction'));

function SuggestionsList({ items, selected }: { items: Extract<Content, { popup: 'suggestions' }>['items']; selected: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected < 0) return;
    listRef.current?.querySelectorAll<HTMLElement>('.row')[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <div ref={listRef} className="popup suggestions-popup" role="listbox" aria-label={t('Suggestions', 'Suggestions')}>
      {items.map((item, index) => (
        <Row key={index} item={item} selected={index === selected} onPick={() => send({ type: 'suggest.pick', index })} />
      ))}
    </div>
  );
}

export default function PopupViews({
  content,
  opening,
  selected,
  settingsSection,
  setSettingsSection,
}: {
  content: Content;
  opening: number;
  selected: number;
  settingsSection: string;
  setSettingsSection: (section: string) => void;
}) {
  if (content.popup === 'workspaces') return <WorkspaceSnapshots content={content} />;
  if (content.popup === 'lan-preview') return <LanPreview content={content} />;
  if (content.popup === 'videos') {
    return (
      <div key={opening} className="popup arriving">
        <VideoPicker content={content} />
      </div>
    );
  }
  if (content.popup === 'ai-action') {
    return (
      <div key={opening} className="popup arriving">
        <Suspense fallback={null}>
          <SolAiAction content={content} />
        </Suspense>
      </div>
    );
  }
  if (content.popup === 'palette') {
    return (
      <div key={opening} className="popup arriving palette-popup">
        <CommandPalette items={content.items} listHeight={content.listHeight} />
      </div>
    );
  }
  if (content.popup === 'notes-select') {
    return (
      <div className="popup arriving">
        <div className="popup-header">
          <span className="popup-header-title">{t('Ajouter le passage à…', 'Add passage to…')}</span>
        </div>
        <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="row" onClick={() => send({ type: 'notes.select', id: '' })}>
          {t('Une nouvelle note', 'A new note')}
        </Button>
        <div className="popup-list">
          {content.items.map(n => (
            <Button variant="ghost" size="sm" pressScale={0.98} whileHover={undefined} className="row" key={n.id} onClick={() => send({ type: 'notes.select', id: n.id })}>
              {n.title}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  if (content.popup === 'notes') {
    return (
      <div key={opening} className="popup arriving notes-popup">
        <QuickNotes key={`${opening}-${content.draft.id}-${content.draft.updated}`} content={content} />
      </div>
    );
  }
  if (content.popup === 'translation') return <TranslationPopupView content={content} opening={opening} />;
  if (content.popup === 'suggestions') return <SuggestionsList items={content.items} selected={selected} />;
  if (content.popup === 'split-layout') return <SplitLayoutPopupView content={content} opening={opening} />;
  if (content.popup === 'menu') return <SolMenu key={opening} items={content.items} />;
  if (content.popup === 'downloads') {
    return (
      <div key={opening} className="popup arriving">
        <div className="popup-header">
          <span className="popup-header-title">{t('Téléchargements', 'Downloads')}</span>
          <span className="popup-badge">{content.items.length}</span>
        </div>
        <div className="popup-list">
          {content.items.length === 0 ? (
            <div className="empty-pill">{t('Aucun téléchargement récent.', 'No recent downloads.')}</div>
          ) : (
            content.items.map(d => <DownloadCard key={d.id} d={d} />)
          )}
        </div>
      </div>
    );
  }
  if (content.popup === 'sessions') return <SessionPicker key={opening} content={content} />;
  if (content.popup === 'profiles') return <ProfileList key={opening} items={content.items} />;
  if (content.popup === 'site-reset') return <SiteResetPopupView content={content} />;
  if (content.popup === 'extension-confirm') return <ExtensionConfirmPopupView content={content} />;
  if (content.popup === 'extensions') return <ExtensionsPopup content={content} />;
  if (content.popup === 'group-edit') return <GroupEditor key={opening} group={content} />;
  if (content.popup === 'permission') return <PermissionPopupView content={content} opening={opening} />;
  if (content.popup === 'shortcut-edit') return <ShortcutForm key={opening} ask={content} />;
  if (content.popup === 'compare-pick') return <ComparePicker key={opening} ask={content} />;
  if (content.popup === 'prompt') return <NameForm key={opening} ask={content} />;
  if (content.popup === 'notice') return <NoticePopupView content={content} />;
  if (content.popup === 'settings') {
    return (
      <SettingsPopup
        content={content}
        opening={opening}
        settingsSection={settingsSection}
        setSettingsSection={setSettingsSection}
      />
    );
  }
  if (content.popup === 'library') return <LibraryPopup key={opening} content={content} opening={opening} />;
  return null;
}
