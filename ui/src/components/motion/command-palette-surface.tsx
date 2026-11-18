// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.
"use client";
// beui.dev/components/blocks/command-palette

import { Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { t, useLang } from "@/i18n";
import { EASE_OUT } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";
import { cn } from "@/lib/utils";
import { type CommandItem, PANEL_SPRING } from "./command-palette";

interface CommandPaletteSurfaceProps {
  embedded: boolean;
  listHeight: number;
  title: string;
  open: boolean;
  reduce: boolean | null;
  canTouch: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  uid: string;
  query: string;
  setQuery: (q: string) => void;
  rows: CommandItem[];
  grouped: [string, CommandItem[]][];
  active: number;
  moveTo: (id: string) => void;
  setOpen: (v: boolean) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  placeholder: string;
  emptyMessage: string;
}

export function CommandPaletteSurface({
  embedded,
  listHeight,
  title,
  open,
  reduce,
  canTouch,
  inputRef,
  listRef,
  uid,
  query,
  setQuery,
  rows,
  grouped,
  active,
  moveTo,
  setOpen,
  onKeyDown,
  placeholder,
  emptyMessage,
}: CommandPaletteSurfaceProps) {
  useLang();
  const hasIcons = rows.some((item) => item.icon);
  const surface = (
    <AnimatePresence initial={false}>
      {open && !embedded ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label={t("Fermer la palette de commandes", "Close command palette")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.12, ease: EASE_OUT },
              }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              {...gate}
              onClick={() => setOpen(false)}
              className="pointer-events-auto fixed inset-0 z-[100] bg-background/5 [backdrop-filter:blur(12px)_saturate(140%)] [-webkit-backdrop-filter:blur(12px)_saturate(140%)]"
            />
          )}
        </PresenceGate>
      ) : null}

      {open ? (
        <PresenceGate key="panel-layer">
          {({ isPresent, gate }) => (
            <div
              inert={!isPresent}
              className={
                embedded
                  ? "sol-command-layer"
                  : "pointer-events-none fixed inset-x-4 bottom-4 top-[18vh] z-[100] flex items-start justify-center"
              }
            >
              <motion.div
                role="dialog"
                aria-modal={!embedded}
                aria-label={title}
                initial={{
                  opacity: 0,
                  y: reduce ? 0 : -8,
                  scale: reduce ? 1 : 0.97,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: reduce ? 0 : -8,
                  scale: reduce ? 1 : 0.97,
                  transition: { duration: 0.12, ease: EASE_OUT },
                }}
                transition={reduce ? { duration: 0.1 } : PANEL_SPRING}
                {...gate}
                onKeyDown={onKeyDown}
                className="sol-command-surface pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl will-change-transform"
              >
                <div className="palette-search flex items-center gap-3 border-b border-border px-4">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={`${uid}-list`}
                    aria-activedescendant={
                      rows[active] ? `palette-result-${rows[active].id}` : undefined
                    }
                    aria-autocomplete="list"
                    aria-label={placeholder}
                    className={cn(
                      "h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none",
                      canTouch && "text-base",
                    )}
                  />
                  <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
                    {t("Échap", "ESC")}
                  </kbd>
                </div>
                <div
                  ref={listRef}
                  id={`${uid}-list`}
                  role="listbox"
                  aria-label={title}
                  style={{ maxHeight: listHeight }}
                  className="palette-results max-h-[60vh] overflow-y-auto overscroll-contain p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {rows.length === 0 ? (
                    <div className="palette-empty p-8 text-center text-sm text-muted-foreground">
                      {emptyMessage}
                    </div>
                  ) : (
                    grouped.map(([group, list]) => (
                      <div key={group} className="mb-1 last:mb-0">
                        <div
                          aria-hidden
                          className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {group}
                        </div>
                        {list.map((it) => {
                          const idx = rows.indexOf(it);
                          const isActive = idx === active;
                          const Icon = it.icon;
                          return (
                            <button
                              key={it.id}
                              type="button"
                              id={`palette-result-${it.id}`}
                              role="option"
                              aria-selected={isActive}
                              data-index={idx}
                              data-palette-index={idx}
                              onMouseEnter={() => moveTo(it.id)}
                              onClick={() => {
                                it.onSelect();
                                if (!embedded) setOpen(false);
                              }}
                              className={cn(
                                "relative isolate flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                                isActive ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {isActive ? (
                                <motion.span
                                  layoutId={`${uid}-active`}
                                  className="absolute inset-0 z-0 rounded-md bg-muted"
                                  transition={
                                    reduce
                                      ? { duration: 0 }
                                      : { type: "spring", stiffness: 480, damping: 38 }
                                  }
                                />
                              ) : null}
                              {Icon ? (
                                <Icon className="relative z-10 h-4 w-4" />
                              ) : hasIcons ? (
                                <span className="relative z-10 h-4 w-4" />
                              ) : null}
                              <span className="relative z-10 flex-1 truncate">
                                {it.label}
                              </span>
                              {it.badge ? (
                                <span className="relative z-10 shrink-0">
                                  {it.badge}
                                </span>
                              ) : null}
                              {it.hint ? (
                                <kbd className="relative z-10 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {it.hint}
                                </kbd>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>
  );

  return embedded ? surface : createPortal(surface, document.body);
}
