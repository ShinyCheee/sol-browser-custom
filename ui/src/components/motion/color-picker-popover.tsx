"use client";
// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Children,
  type ComponentPropsWithRef,
  isValidElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { PresenceGate } from "@/lib/presence-gate";
import { cn } from "@/lib/utils";
import { ColorPickerArea } from "./color-picker-controls";
import { CHECKERBOARD, CHIP_RADIUS, MORPH, MorphContext, usePickerContext } from "./color-picker-math";

export interface ColorPickerTriggerProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  children?: ReactNode;
}

function TriggerLabel({ hex }: { hex: string }) {
  const reduce = useReducedMotion();
  const textRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    setWidth(text.offsetWidth);
    const observer = new ResizeObserver(() => setWidth(text.offsetWidth));
    observer.observe(text);
    return () => observer.disconnect();
  }, []);
  const alpha = hex.slice(7);

  return (
    <motion.span
      className="relative inline-flex overflow-hidden"
      initial={false}
      animate={{ width: width ?? "auto" }}
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
    >
      <span ref={textRef} className="relative inline-flex shrink-0 whitespace-nowrap font-mono uppercase tabular-nums">
        {hex.slice(0, 7)}
        <AnimatePresence mode="popLayout" initial={false}>
          {alpha && (
            <motion.span
              key="alpha"
              className="text-muted-foreground"
              initial={{ opacity: 0, x: reduce ? 0 : -4, filter: reduce ? "blur(0px)" : "blur(3px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: reduce ? "blur(0px)" : "blur(3px)", transition: { duration: 0.12 } }}
              transition={SPRING_LAYOUT}
            >
              {alpha}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.span>
  );
}

export function ColorPickerTrigger({ className, children, onClick, ...props }: ColorPickerTriggerProps) {
  const { id, hex, open, setOpen, triggerRef, disabled } = usePickerContext("ColorPickerTrigger");
  const reduce = useReducedMotion();
  return (
    <button
      {...props}
      ref={triggerRef}
      type="button"
      data-color-picker-trigger=""
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? `${id}-content` : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      className={cn(
        "inline-flex h-10 w-fit items-center gap-2.5 rounded-xl border border-border bg-background pr-3.5 pl-2.5 text-sm text-foreground outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
        className,
      )}
    >
      <span aria-hidden="true" className="relative size-6 shrink-0">
        <span className="absolute inset-0 rounded-md border border-dashed border-foreground/20" />
        {!open && (
          <motion.span
            layoutId={reduce ? undefined : `${id}-chip`}
            transition={MORPH}
            className="absolute inset-0 overflow-hidden"
            style={{ borderRadius: CHIP_RADIUS, background: CHECKERBOARD }}
          >
            <span
              className="absolute inset-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
              style={{ backgroundColor: hex, borderRadius: CHIP_RADIUS }}
            />
          </motion.span>
        )}
      </span>
      {children ?? <TriggerLabel hex={hex} />}
    </button>
  );
}

export interface ColorPickerContentProps extends Omit<ComponentPropsWithRef<"div">, "role"> {
  align?: "start" | "end";
}

const VIEWPORT_GUTTER = 8;
const PANEL_DELAY = 0.1;
const PANEL_STAGGER = 0.035;

const PANEL_ITEM = {
  initial: { opacity: 0, y: -6, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const PANEL_ITEM_REDUCED = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

const PANEL_ITEM_EXIT = { opacity: 0, transition: { duration: 0.1 } };

export function ColorPickerContent({ align = "start", className, children, ...props }: ColorPickerContentProps) {
  const { id, open, setOpen, triggerRef } = usePickerContext("ColorPickerContent");
  const reduce = useReducedMotion() ?? false;
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    panel.style.marginLeft = "0px";
    const rect = panel.getBoundingClientRect();
    const max = document.documentElement.clientWidth - VIEWPORT_GUTTER;
    let shift = 0;
    if (rect.right > max) shift = max - rect.right;
    if (rect.left + shift < VIEWPORT_GUTTER) shift = VIEWPORT_GUTTER - rect.left;
    panel.style.marginLeft = `${shift}px`;
  }, [open]);
  useDismiss(open, () => setOpen(false), panelRef, {
    ignore: (target) => Boolean(triggerRef.current?.contains(target)),
  });

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    if (open) {
      panelRef.current
        ?.querySelector<HTMLElement>(
          '[role="slider"]:not([aria-disabled]), input:not(:disabled), button:not(:disabled)',
        )
        ?.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body || panelRef.current?.contains(active)) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open, triggerRef]);

  return (
    <AnimatePresence>
      {open && (
        <PresenceGate>
          {({ gate }) => {
            let row = 0;
            return (
              <motion.div
                {...(props as React.ComponentProps<typeof motion.div>)}
                {...gate}
                ref={panelRef}
                id={`${id}-content`}
                role="dialog"
                aria-label={props["aria-label"] ?? "Color picker"}
                className={cn(
                  "absolute top-full z-50 mt-2 flex w-72 flex-col gap-3 p-3",
                  align === "end" ? "right-0" : "left-0",
                  className,
                )}
              >
                <motion.div
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-2xl border border-border bg-background shadow-[0_12px_32px_-8px_rgb(0_0_0/0.25)]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16, ease: EASE_OUT, delay: PANEL_DELAY }}
                />
                <MorphContext.Provider value>
                  {Children.map(children, (child) => {
                    if (isValidElement(child) && child.type === ColorPickerArea) return child;
                    row += 1;
                    const item = reduce ? PANEL_ITEM_REDUCED : PANEL_ITEM;
                    return (
                      <motion.div
                        initial={item.initial}
                        animate={item.animate}
                        exit={PANEL_ITEM_EXIT}
                        transition={{ ...SPRING_LAYOUT, delay: PANEL_DELAY + row * PANEL_STAGGER }}
                      >
                        {child}
                      </motion.div>
                    );
                  })}
                </MorphContext.Provider>
              </motion.div>
            );
          }}
        </PresenceGate>
      )}
    </AnimatePresence>
  );
}
