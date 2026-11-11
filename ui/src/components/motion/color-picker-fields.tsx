"use client";
// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.

import { Pipette } from "lucide-react";
import { arc, LayoutGroup, motion, type Transition, useAnimate, useReducedMotion } from "motion/react";
import { type ComponentPropsWithRef, type ReactNode, useEffect, useState } from "react";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { CHECKERBOARD, clamp, formatHex, type Hsva, hslToHsv, hsvToHsl, parseHex, type Rgba, rgbaToHsva, usePickerContext } from "./color-picker-math";

const FIELD_CLASS = "h-9 w-full min-w-0 rounded-lg border border-border bg-background text-sm text-foreground tabular-nums outline-none transition-colors focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed";

function useRejectShake() {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotion();
  return {
    scope,
    shake: () => { if (!reduce && scope.current) animate(scope.current, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.3 }); },
  };
}

export interface ColorPickerHexInputProps extends Omit<ComponentPropsWithRef<"input">, "value" | "defaultValue" | "type"> {}

export function ColorPickerHexInput({
  className, onChange, onBlur, onKeyDown, "aria-label": ariaLabel = "Hex color", ...props
}: ColorPickerHexInputProps) {
  const { hsva, hex, update, commit, disabled } = usePickerContext("ColorPickerHexInput");
  const [draft, setDraft] = useState<string | null>(null);
  const { scope, shake } = useRejectShake();

  const settle = () => {
    if (draft === null) return;
    const parsed = parseHex(draft);
    if (parsed) {
      update(rgbaToHsva(parsed, hsva));
      commit();
    } else shake();
    setDraft(null);
  };

  return (
    <div ref={scope} className={cn("relative min-w-0 flex-1", className)}>
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        #
      </span>
      <input
        {...props}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={9}
        disabled={disabled}
        aria-label={ariaLabel}
        value={draft ?? hex.slice(1).toUpperCase()}
        onChange={(event) => {
          onChange?.(event);
          const next = event.target.value.replace(/^#/, "");
          setDraft(next);
          if (next.length === 6 || next.length === 8) {
            const parsed = parseHex(next);
            if (parsed) update(rgbaToHsva(parsed, hsva));
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          settle();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === "Enter") settle();
          if (event.key === "Escape" && draft !== null) {
            event.preventDefault();
            setDraft(null);
          }
        }}
        className={cn(FIELD_CLASS, "pr-3 pl-6 font-mono uppercase")}
      />
    </div>
  );
}

type ChannelSpec = { key: string; short: string; name: string; max: number; value: number; set: (n: number) => Hsva };

function ChannelField({ spec }: { spec: ChannelSpec }) {
  const { update, commit, disabled } = usePickerContext("ColorPickerChannels");
  const [draft, setDraft] = useState<string | null>(null);
  const shown = Math.round(spec.value);

  return (
    <label className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        aria-label={spec.name}
        value={draft ?? String(shown)}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d]/g, "").slice(0, 3);
          setDraft(next);
          if (next !== "") update(spec.set(clamp(Number(next), 0, spec.max)));
        }}
        onBlur={() => {
          if (draft !== null) commit();
          setDraft(null);
        }}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
          if (delta) {
            event.preventDefault();
            setDraft(null);
            update(spec.set(clamp(shown + delta * (event.shiftKey ? 10 : 1), 0, spec.max)));
            commit();
          } else if (event.key === "Enter") {
            setDraft(null);
            commit();
          }
        }}
        className={cn(FIELD_CLASS, "px-1 text-center")}
      />
      <span aria-hidden="true" className="text-[11px] font-medium text-muted-foreground">
        {spec.short}
      </span>
    </label>
  );
}

export interface ColorPickerChannelsProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  format?: "rgb" | "hsl";
}

export function ColorPickerChannels({ format = "rgb", className, ...props }: ColorPickerChannelsProps) {
  const { hsva, rgba, alpha } = usePickerContext("ColorPickerChannels");
  const fromRgb = (patch: Partial<Rgba>) => rgbaToHsva({ ...rgba, ...patch }, hsva);
  let specs: ChannelSpec[];
  if (format === "hsl") {
    const hsl = hsvToHsl(hsva);
    specs = [
      { key: "h", short: "H", name: "Hue", max: 360, value: hsl.h, set: (n) => hslToHsv(n, hsl.s, hsl.l, hsva, hsva.a) },
      { key: "s", short: "S", name: "Saturation", max: 100, value: hsl.s, set: (n) => hslToHsv(hsl.h, n, hsl.l, hsva, hsva.a) },
      { key: "l", short: "L", name: "Lightness", max: 100, value: hsl.l, set: (n) => hslToHsv(hsl.h, hsl.s, n, hsva, hsva.a) },
    ];
  } else {
    specs = [
      { key: "r", short: "R", name: "Red", max: 255, value: rgba.r, set: (n) => fromRgb({ r: n }) },
      { key: "g", short: "G", name: "Green", max: 255, value: rgba.g, set: (n) => fromRgb({ g: n }) },
      { key: "b", short: "B", name: "Blue", max: 255, value: rgba.b, set: (n) => fromRgb({ b: n }) },
    ];
  }
  if (alpha) {
    specs.push({ key: "a", short: "A", name: "Opacity percent", max: 100, value: hsva.a * 100, set: (n) => ({ ...hsva, a: n / 100 }) });
  }
  return (
    <div {...props} className={cn("flex min-w-0 flex-1 gap-1.5", className)}>
      {specs.map((spec) => (
        <ChannelField key={`${format}-${spec.key}`} spec={spec} />
      ))}
    </div>
  );
}

type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };

export interface ColorPickerEyeDropperProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  children?: ReactNode;
}

export function ColorPickerEyeDropper({
  className,
  children,
  onClick,
  "aria-label": ariaLabel = "Pick a color from the screen",
  ...props
}: ColorPickerEyeDropperProps) {
  const { hsva, update, commit, disabled } = usePickerContext("ColorPickerEyeDropper");
  const reduce = useReducedMotion();
  const [EyeDropper, setEyeDropper] = useState<EyeDropperConstructor | null>(null);
  useEffect(() => {
    const ctor = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (ctor) setEyeDropper(() => ctor);
  }, []);
  if (!EyeDropper) return null;

  return (
    <motion.button
      {...(props as React.ComponentProps<typeof motion.button>)}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
      transition={SPRING_PRESS}
      onClick={async (event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        try {
          const { sRGBHex } = await new EyeDropper().open();
          const parsed = parseHex(sRGBHex);
          if (!parsed) return;
          update(rgbaToHsva({ ...parsed, a: hsva.a }, hsva));
          commit();
        } catch {
          // Dismissed with Escape.
        }
      }}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
        className,
      )}
    >
      {children ?? <Pipette aria-hidden="true" className="size-4" />}
    </motion.button>
  );
}

const PRESET_HOP: Transition = {
  ...SPRING_LAYOUT,
  layout: { ...SPRING_LAYOUT, path: arc({ strength: -0.3 }) },
};

export type ColorPickerPresetsProps = ComponentPropsWithRef<"div">;

export function ColorPickerPresets({ className, children, ...props }: ColorPickerPresetsProps) {
  const { id } = usePickerContext("ColorPickerPresets");
  return (
    <div {...props} className={cn("flex flex-wrap gap-2", className)}>
      <LayoutGroup id={`${id}-presets`}>{children}</LayoutGroup>
    </div>
  );
}

export interface ColorPickerPresetProps
  extends Omit<ComponentPropsWithRef<"button">, "value" | "children" | "type"> {
  value: string;
  label?: string;
}

export function ColorPickerPreset({ value, label, className, onClick, ...props }: ColorPickerPresetProps) {
  const { hsva, hex, update, commit, disabled } = usePickerContext("ColorPickerPreset");
  const reduce = useReducedMotion();
  const parsed = parseHex(value);
  const normalized = parsed ? formatHex(parsed) : value;
  const selected = normalized === hex;

  return (
    <motion.button
      {...(props as React.ComponentProps<typeof motion.button>)}
      type="button"
      disabled={disabled}
      aria-label={label ?? normalized}
      aria-pressed={selected}
      whileTap={reduce || disabled ? undefined : { scale: 0.88 }}
      transition={SPRING_PRESS}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !parsed) return;
        update(rgbaToHsva(parsed, hsva));
        commit();
      }}
      className={cn(
        "relative size-6 shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground disabled:cursor-not-allowed",
        className,
      )}
    >
      {selected && (
        <motion.span
          aria-hidden="true"
          layoutId={reduce ? undefined : "color-picker-preset"}
          initial={false}
          transition={PRESET_HOP}
          className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-foreground/70"
        />
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{ background: CHECKERBOARD }}
      >
        <span
          className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
          style={{ backgroundColor: normalized }}
        />
      </span>
    </motion.button>
  );
}
