"use client";
// beUI source: Copyright (c) 2026 Saurabh Chauhan, MIT; see ui/licenses/beui-MIT.txt.

import {
  ActionSwapText,
  type ActionSwapTextProps,
} from "./action-swap";

export type {
  ActionSwapButtonSize,
  ActionSwapButtonVariant,
  ActionSwapItem,
} from "./action-swap";

export type ActionSwapRollTextProps = Omit<ActionSwapTextProps, "animation">;

export function ActionSwapRollText(props: ActionSwapRollTextProps) {
  return <ActionSwapText {...props} animation="roll" />;
}
