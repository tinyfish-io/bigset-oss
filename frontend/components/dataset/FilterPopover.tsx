"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import type { DatasetColumn, DatasetRow } from "@/components/table/types";

/** How the filter value should be matched against cell values. */
export type MatchType = "contains" | "exact";

interface FilterPopoverProps {
  columns: DatasetColumn[];
  rows: DatasetRow[];
  /**
   * Called when the user selects a column + value + matchType and clicks Apply.
   */
  onFilter: (column: string, value: string, matchType: MatchType) => void;
}

export function FilterPopover({ columns, rows, onFilter }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [matchType, setMatchType] = useState<MatchType>("contains");
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  const selectedColDef = columns.find((c) => c.name === selectedColumn);

  /**
   * Close the popover when clicking outside of it.
   * The `triggerRef` is excluded so clicking the trigger button
   * does not immediately close the popover.
   */
  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  /**
   * Reset transient selection state whenever the popover closes so the next
   * open starts with a clean slate.
   * Uses useLayoutEffect to detect the transition from open → closed before paint.
   */
  useLayoutEffect(() => {
    if (open === false && wasOpenRef.current === true) {
      setSelectedColumn("");
      setSelectedValue("");
      setMatchType("contains");
    }
    wasOpenRef.current = open;
  }, [open]);

  /**
   * Unique, sorted cell values for the selected column derived from all rows.
   * Used only for "exact" match mode where we display a pickable list.
   * Memoized to avoid recomputing on every render (e.g., keystroke in search box).
   */
  const colValues = useMemo(() => {
    if (!selectedColDef) return [];
    return Array.from(
      new Set(
        rows
          .map((r) => r.data[selectedColDef.name])
          .map((v) => String(v ?? ""))
          .filter(Boolean),
      ),
    ).sort();
  }, [rows, selectedColDef]);

  function handleApply() {
    if (!selectedColumn || !selectedValue) return;
    onFilter(selectedColumn, selectedValue, matchType);
    setOpen(false);
  }

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
          }
        }}
        className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/[0.03] transition-colors"
      >
        <Filter className="size-3" />
        <span>Filter</span>
      </button>

      {/* Popover panel */}
      {open && (
        <div
          ref={popoverRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="absolute top-full left-0 mt-1.5 w-72 bg-surface border border-border rounded-lg shadow-lg z-50"
        >
          {/* Column + match-type selectors */}
          <div className="p-3 border-b border-border space-y-2">
            {/* Row: column select + match type select side-by-side */}
            <div className="flex gap-2">
              <select
                value={selectedColumn}
                onChange={(e) => {
                  setSelectedColumn(e.target.value);
                  setSelectedValue("");
                }}
                className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-foreground/30"
              >
                <option value="">Column</option>
                {columns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
              </select>

              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as MatchType)}
                className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-foreground/30"
              >
                <option value="contains">Contains</option>
                <option value="exact">Exact match</option>
              </select>
            </div>

            {/* Value input / search area */}
            {selectedColumn && (
              <>
                {matchType === "contains" ? (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted pointer-events-none" />
                    <input
                      type="text"
                      value={selectedValue}
                      onChange={(e) => setSelectedValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && selectedColumn && selectedValue) {
                          handleApply();
                        }
                      }}
                      placeholder="Type to filter…"
                      className="w-full rounded border border-border bg-background pl-7 pr-2 py-1.5 text-xs text-foreground outline-none focus:border-foreground/30"
                    />
                  </div>
                ) : (
                  colValues.length > 0 ? (
                    <div className="max-h-44 overflow-y-auto space-y-0.5">
                      {colValues.map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSelectedValue(val)}
                          className={`w-full text-left px-2 py-1 rounded text-xs transition-colors truncate ${
                            selectedValue === val
                              ? "bg-foreground text-accent-text font-medium"
                              : "text-foreground/70 hover:bg-foreground/[0.04]"
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted text-center py-2">
                      No values found
                    </p>
                  )
                )}
              </>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-end gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!selectedColumn || !selectedValue}
              className="text-xs font-medium px-3 py-1 rounded bg-foreground text-accent-text hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ActiveFilterProps {
  column: string;
  value: string;
  matchType: MatchType;
  onClear: () => void;
}

export function ActiveFilter({
  column,
  value,
  matchType,
  onClear,
}: ActiveFilterProps) {
  const label =
    matchType === "exact" ? `${column}: "${value}"` : `${column}: *${value}*`;

  return (
    <div className="inline-flex items-center gap-1.5 rounded border border-border bg-surface text-foreground px-2.5 py-1 text-[11px] font-medium">
      <span>
        <span className="text-muted">{label}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center justify-center text-muted hover:text-foreground transition-colors"
        aria-label={`Remove filter: ${column} = ${value}`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}