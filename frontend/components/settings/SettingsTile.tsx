"use client";

import { ChevronRight } from "lucide-react";

interface SettingsTileProps {
  label: string;
  description?: string;
  value?: string;
  onClick: () => void;
  showTrailingButton?: boolean;
  trailingIcon?: React.ReactNode;
}

export function SettingsTile({
  label,
  description,
  value,
  onClick,
  showTrailingButton = true,
  trailingIcon,
}: SettingsTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg p-4 text-left transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-link"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
        )}
      </div>

      {showTrailingButton && (
        <div className="flex shrink-0 items-center gap-2">
          {value && (
            <div className="flex h-8 items-center rounded-lg border border-border bg-background pl-3 pr-2 transition-colors group-hover:border-foreground/30">
              <span className="max-w-[140px] truncate text-xs font-medium text-foreground">
                {value}
              </span>
              <ChevronRight className="ml-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          )}
          {trailingIcon && !value && (
            <div className="flex size-8 items-center justify-center rounded-lg border border-border text-muted transition-colors group-hover:border-foreground/30 group-hover:text-foreground">
              {trailingIcon}
            </div>
          )}
          {!value && !trailingIcon && (
            <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          )}
        </div>
      )}
    </button>
  );
}
