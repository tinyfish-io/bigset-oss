"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
} from "lucide-react";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("bigset:theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => getInitialTheme());

  const readTheme = useCallback(() => {
    const stored = localStorage.getItem("bigset:theme");
    if (stored === "dark" || stored === "light") return stored as "light" | "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }, []);

  useEffect(() => {
    const html = document.documentElement;

    const observer = new MutationObserver(() => {
      const attr = html.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") {
        setTheme(attr);
      } else {
        setTheme(readTheme());
      }
    });
    observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [readTheme]);

  return { theme };
}

function BigSetToaster({ ...props }: ToasterProps) {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      duration={1000}
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="size-4" />,
        loading: <Loader2 className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
          "--normal-border-radius": "6px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
}

export { BigSetToaster, toast };