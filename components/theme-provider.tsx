"use client";

import { useEffect, useState } from "react";
import { getTheme, saveSetting } from "@/lib/settings";
import type { AppSettings } from "@/lib/types";

type Theme = AppSettings["theme"];

const THEME_COLORS: Record<Theme, string> = {
  default: "#ffffff",
  dark: "#1a1a1a",
  scrapbook: "#fdf6e3",
};

export function applyThemeToDOM(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", THEME_COLORS[theme]);
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const applyTheme = async () => {
      const theme = await getTheme();
      if (cancelled) return;
      applyThemeToDOM(theme);
      setMounted(true);
    };

    applyTheme();

    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("default");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    getTheme().then((t) => {
      setThemeState(t);
      setMounted(true);
    });
  }, []);

  const setTheme = async (value: Theme) => {
    setThemeState(value);
    await saveSetting("theme", value);
    applyThemeToDOM(value);
  };

  return { theme, setTheme, mounted };
}
