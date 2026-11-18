"use client";
// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.

import { type ComponentPropsWithRef, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BLACK,
  ColorPickerContext,
  clamp,
  formatHex,
  type Hsva,
  hsvaToRgba,
  parseHex,
  rgbaToHsva,
} from "./color-picker-math";

export {
  ColorPickerAlpha,
  type ColorPickerAlphaProps,
  ColorPickerArea,
  type ColorPickerAreaProps,
  ColorPickerHue,
  type ColorPickerHueProps,
  ColorPickerSwatch,
  type ColorPickerSwatchProps,
} from "./color-picker-controls";
export {
  ColorPickerChannels,
  type ColorPickerChannelsProps,
  ColorPickerEyeDropper,
  type ColorPickerEyeDropperProps,
  ColorPickerHexInput,
  type ColorPickerHexInputProps,
  ColorPickerPreset,
  type ColorPickerPresetProps,
  ColorPickerPresets,
  type ColorPickerPresetsProps,
} from "./color-picker-fields";
export {
  formatHex,
  type Hsva,
  hsvaToRgba,
  parseHex,
  type Rgba,
  rgbaToHsva,
  useColorPicker,
} from "./color-picker-math";

export interface ColorPickerProps
  extends Omit<ComponentPropsWithRef<"fieldset">, "onChange" | "defaultValue"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onValueCommit?: (value: string) => void;
  alpha?: boolean;
  name?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ColorPicker({
  value,
  defaultValue = "#3478f6",
  onValueChange,
  onValueCommit,
  alpha = true,
  disabled = false,
  name,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  form,
  className,
  children,
  ...props
}: ColorPickerProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [openInternal, setOpenInternal] = useState(defaultOpen);
  const open = openProp ?? openInternal;
  const setOpen = (next: boolean) => {
    if (next === open) return;
    if (openProp === undefined) setOpenInternal(next);
    onOpenChange?.(next);
  };
  const controlled = value !== undefined;
  const incoming = controlled ? value : defaultValue;
  const [state, setState] = useState(() => ({
    source: incoming,
    hsva: rgbaToHsva(parseHex(incoming) ?? BLACK),
  }));

  let hsva = state.hsva;
  if (controlled && value !== state.source) {
    const parsed = parseHex(value);
    hsva = parsed ? rgbaToHsva(parsed, state.hsva) : state.hsva;
    setState({ source: value, hsva });
  }
  if (!alpha && hsva.a !== 1) hsva = { ...hsva, a: 1 };

  const rgba = hsvaToRgba(hsva);
  const hex = formatHex(rgba);
  const hexRef = useRef(hex);
  useLayoutEffect(() => {
    hexRef.current = hex;
  }, [hex]);

  const update = (next: Hsva) => {
    const clean: Hsva = {
      h: clamp(next.h, 0, 360),
      s: clamp(next.s, 0, 100),
      v: clamp(next.v, 0, 100),
      a: alpha ? clamp(next.a, 0, 1) : 1,
    };
    const nextHex = formatHex(hsvaToRgba(clean));
    const changed = nextHex !== hexRef.current;
    hexRef.current = nextHex;
    setState({ source: nextHex, hsva: clean });
    if (changed) onValueChange?.(nextHex);
  };

  return (
    <ColorPickerContext.Provider
      value={{
        id,
        hsva,
        rgba,
        hex,
        alpha,
        disabled,
        update,
        commit: () => onValueCommit?.(hexRef.current),
        open,
        setOpen,
        triggerRef,
      }}
    >
      <fieldset
        {...props}
        disabled={disabled}
        form={form}
        className={cn(
          "relative flex w-full min-w-0 max-w-72 flex-col gap-3 border-0 p-0",
          "has-[>[data-color-picker-trigger]]:w-fit has-[>[data-color-picker-trigger]]:self-start",
          disabled && "opacity-50",
          className,
        )}
      >
        {children}
        {name && <input type="hidden" name={name} value={hex} form={form} />}
      </fieldset>
    </ColorPickerContext.Provider>
  );
}
