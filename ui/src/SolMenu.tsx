import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/motion/context-menu';
import { send } from './bridge';
import { t } from './i18n';
import { Icon } from './Icons';
import { isClosing, menuIconPath } from './PopupIcons';

export default function SolMenu({ items }: { items: string[] }) {
  return (
    <div className="popup beui-menu-popup">
      <ContextMenu
        open
        embedded
        onOpenChange={open => {
          if (!open) send({ type: 'popup.close' });
        }}
      >
        <ContextMenuContent className="sol-menu-surface" ariaLabel={t('Actions', 'Actions')}>
          {items.map((label, index) => {
            const path = menuIconPath(label);
            return label === '' ? (
              <ContextMenuSeparator key={index} />
            ) : (
              <ContextMenuItem
                key={index}
                textValue={label}
                className="sol-menu-item"
                tone={isClosing(label) ? 'destructive' : 'default'}
                closeOnSelect={false}
                onSelect={() => send({ type: 'menu.pick', index })}
              >
                <span className={`row-badge${path ? '' : ' menu-icon-empty'}`} aria-hidden>
                  {path && <Icon d={path} size={14} />}
                </span>
                <span className="row-title">{label}</span>
              </ContextMenuItem>
            );
          })}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
