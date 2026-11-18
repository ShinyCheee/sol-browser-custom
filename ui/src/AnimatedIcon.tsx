import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArchiveIcon } from '@/components/ui/archive';
import { ArrowLeftIcon } from '@/components/ui/arrow-left';
import { ArrowRightIcon } from '@/components/ui/arrow-right';
import { AttachFileIcon } from '@/components/ui/attach-file';
import { BookTextIcon } from '@/components/ui/book-text';
import { BriefcaseBusinessIcon } from '@/components/ui/briefcase-business';
import { ChartNoAxesColumnIncreasingIcon } from '@/components/ui/chart-no-axes-column-increasing';
import { CheckIcon } from '@/components/ui/check';
import { ChevronsDownUpIcon } from '@/components/ui/chevrons-down-up';
import { ChevronsUpDownIcon } from '@/components/ui/chevrons-up-down';
import { CopyIcon } from '@/components/ui/copy';
import { DeleteIcon } from '@/components/ui/delete';
import { DownloadIcon } from '@/components/ui/download';
import { FileTextIcon } from '@/components/ui/file-text';
import { FingerprintIcon } from '@/components/ui/fingerprint';
import { FolderMinusIcon } from '@/components/ui/folder-minus';
import { FolderOpenIcon } from '@/components/ui/folder-open';
import { FolderPlusIcon } from '@/components/ui/folder-plus';
import { FrameIcon } from '@/components/ui/frame';
import { HardDriveDownloadIcon } from '@/components/ui/hard-drive-download';
import { HistoryIcon } from '@/components/ui/history';
import { LayersIcon } from '@/components/ui/layers';
import { LayoutPanelTopIcon } from '@/components/ui/layout-panel-top';
import { MoonIcon } from '@/components/ui/moon';
import { PanelLeftOpenIcon } from '@/components/ui/panel-left-open';
import { PauseIcon } from '@/components/ui/pause';
import { PlayIcon } from '@/components/ui/play';
import { PlusIcon } from '@/components/ui/plus';
import { RedoIcon } from '@/components/ui/redo';
import { RefreshCWIcon } from '@/components/ui/refresh-cw';
import { SearchIcon } from '@/components/ui/search';
import { SettingsIcon } from '@/components/ui/settings';
import { SquarePenIcon } from '@/components/ui/square-pen';
import { TerminalIcon } from '@/components/ui/terminal';
import { UndoIcon } from '@/components/ui/undo';
import { UserIcon } from '@/components/ui/user';
import { UserPlusIcon } from '@/components/ui/user-plus';
import { XIcon } from '@/components/ui/x';

const icons = {
  user: UserIcon,
  userAdd: UserPlusIcon,
  private: FingerprintIcon,
  delete: DeleteIcon,
  download: DownloadIcon,
  settings: SettingsIcon,
  notes: BookTextIcon,
  history: HistoryIcon,
  search: SearchIcon,
  reload: RefreshCWIcon,
  sidebar: PanelLeftOpenIcon,
  copy: CopyIcon,
  back: ArrowLeftIcon,
  forward: ArrowRightIcon,
  close: XIcon,
  archive: ArchiveIcon,
  plus: PlusIcon,
  check: CheckIcon,
  attach: AttachFileIcon,
  save: HardDriveDownloadIcon,
  group: LayersIcon,
  groupAdd: FolderPlusIcon,
  ungroup: FolderMinusIcon,
  tab: LayoutPanelTopIcon,
  edit: SquarePenIcon,
  session: BriefcaseBusinessIcon,
  select: FrameIcon,
  undo: UndoIcon,
  redo: RedoIcon,
  sleep: MoonIcon,
  expand: ChevronsUpDownIcon,
  collapse: ChevronsDownUpIcon,
  tools: TerminalIcon,
  ai: FileTextIcon,
  network: ChartNoAxesColumnIncreasingIcon,
  pause: PauseIcon,
  play: PlayIcon,
  file: FileTextIcon,
  folder: FolderOpenIcon,
};

export type IconName = keyof typeof icons;
type Handle = { startAnimation: () => void; stopAnimation: () => void };

const stopCallbacks = new Set<() => void>();
let sharedMediaQuery: MediaQueryList | null = null;

function ensureSharedListeners() {
  if (sharedMediaQuery || typeof window === 'undefined') return sharedMediaQuery;
  sharedMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  sharedMediaQuery.addEventListener('change', () => {
    if (sharedMediaQuery?.matches) stopCallbacks.forEach(stop => stop());
  });
  window.addEventListener('blur', () => {
    stopCallbacks.forEach(stop => stop());
  });
  return sharedMediaQuery;
}

export default function AnimatedIcon({
  name,
  size = 16,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const api = useRef<Handle>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const preference = ensureSharedListeners();
    const owner = el.closest<HTMLElement>('button,[role="button"],[role="tab"],summary,a') ?? el;
    let reset = 0;

    const stop = () => {
      clearTimeout(reset);
      api.current?.stopAnimation();
      el.dataset.animating = 'false';
    };
    const start = () => {
      if (reduce || preference?.matches || owner.matches(':disabled,[aria-disabled="true"]')) return;
      clearTimeout(reset);
      api.current?.startAnimation();
      el.dataset.animating = 'true';
    };
    const pulse = () => {
      start();
      reset = window.setTimeout(stop, 600);
    };

    stopCallbacks.add(stop);
    owner.addEventListener('mouseenter', start);
    owner.addEventListener('mouseleave', stop);
    owner.addEventListener('focusin', start);
    owner.addEventListener('focusout', stop);
    owner.addEventListener('pointerdown', pulse);

    return () => {
      stop();
      stopCallbacks.delete(stop);
      owner.removeEventListener('mouseenter', start);
      owner.removeEventListener('mouseleave', stop);
      owner.removeEventListener('focusin', start);
      owner.removeEventListener('focusout', stop);
      owner.removeEventListener('pointerdown', pulse);
    };
  }, [name, reduce]);

  const Component = icons[name];
  return (
    <span
      ref={root}
      aria-hidden="true"
      data-icon={name}
      className={`sol-animated-icon ${className}`}
      style={{ width: size, height: size }}
    >
      <Component ref={api} size={size} />
    </span>
  );
}
