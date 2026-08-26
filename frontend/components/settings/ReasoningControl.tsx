"use client";

import { useId, useRef } from "react";
import {
  REASONING_LEVELS,
  REASONING_LEVEL_LABELS,
  type ReasoningLevel,
} from "@/lib/backend";

interface ReasoningControlProps {
  value: ReasoningLevel;
  /** False when the level is the provider/role default rather than a choice. */
  overridden: boolean;
  /** Called with a level to pin it, or null to hand the role back to the default. */
  onChange: (level: ReasoningLevel | null) => void;
  disabled?: boolean;
  /** Shown in place of the control when the provider has no reasoning knob. */
  unsupportedReason?: string;
}

/**
 * Segmented control over the canonical reasoning scale.
 *
 * This is a fixed set of five named steps, so every step is a real button with
 * a full-height hit target rather than a thumb on a track — there is nothing to
 * drag and nothing to miss. Levels read low-to-high left-to-right, so the scale
 * still reads as a scale.
 *
 * The selected segment is filled when the level is pinned and outlined when it
 * is inherited, so "which level runs" and "who chose it" stay separable at a
 * glance: an inherited role still shows where it landed.
 */
export function ReasoningControl({
  value,
  overridden,
  onChange,
  disabled = false,
  unsupportedReason,
}: ReasoningControlProps) {
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, REASONING_LEVELS.indexOf(value));

  if (unsupportedReason) {
    return (
      <p className="pb-4 text-xs leading-5 text-muted">{unsupportedReason}</p>
    );
  }

  // Arrow keys move between steps and commit, matching native radio-group
  // behaviour. Roving tabindex keeps the whole control a single tab stop.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowUp: -1,
      ArrowRight: 1,
      ArrowDown: 1,
    };
    let next: number | null = null;

    if (event.key in deltas) {
      next = selectedIndex + deltas[event.key];
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = REASONING_LEVELS.length - 1;
    }
    if (next === null) return;

    event.preventDefault();
    const clamped = Math.min(Math.max(next, 0), REASONING_LEVELS.length - 1);
    if (clamped === selectedIndex) return;
    onChange(REASONING_LEVELS[clamped]);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons?.[clamped]?.focus();
  }

  return (
    <div className={`pb-4 ${disabled ? "opacity-50" : ""}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-xs text-muted">
          Reasoning effort
        </span>
        {overridden ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-xs text-link underline decoration-link/30 underline-offset-2 hover:decoration-link/60 disabled:cursor-not-allowed disabled:no-underline"
          >
            Reset to default
          </button>
        ) : (
          <span className="rounded-full border border-border px-2 py-px text-[11px] font-medium text-muted">
            Default
          </span>
        )}
      </div>

      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={handleKeyDown}
        className="flex w-full overflow-hidden rounded-lg border border-border"
      >
        {REASONING_LEVELS.map((level, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(level)}
              className={[
                "flex-1 border-border px-1 py-2 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-link",
                "disabled:cursor-not-allowed",
                index > 0 ? "border-l" : "",
                isSelected && overridden
                  ? "bg-accent text-accent-text"
                  : isSelected
                    ? "bg-foreground/[0.07] font-semibold text-foreground"
                    : "text-muted hover:bg-foreground/5 hover:text-foreground",
              ].join(" ")}
            >
              {REASONING_LEVEL_LABELS[level]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
