import React from "react";

export type PreviewThemeMode = "system" | "light" | "dark";
export type PreviewResolvedTheme = "light" | "dark";

const STORAGE_KEY = "lattice-preview-theme-mode";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

type PreviewThemeContextValue = {
  mode: PreviewThemeMode;
  resolvedTheme: PreviewResolvedTheme;
  setMode: React.Dispatch<React.SetStateAction<PreviewThemeMode>>;
};

const PreviewThemeContext = React.createContext<PreviewThemeContextValue | null>(null);

const THEME_OPTIONS: Array<{ label: string; mode: PreviewThemeMode }> = [
  { label: "System", mode: "system" },
  { label: "Light", mode: "light" },
  { label: "Dark", mode: "dark" },
];

function isThemeMode(value: string | null): value is PreviewThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredThemeMode(): PreviewThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const storedThemeMode = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(storedThemeMode) ? storedThemeMode : "system";
  } catch {
    return "system";
  }
}

function readSystemTheme(): PreviewResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
}

function syncDocumentTheme(mode: PreviewThemeMode, resolvedTheme: PreviewResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

export function PreviewThemeProvider(props: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<PreviewThemeMode>(() => readStoredThemeMode());
  const [systemTheme, setSystemTheme] = React.useState<PreviewResolvedTheme>(() => readSystemTheme());
  const resolvedTheme = mode === "system" ? systemTheme : mode;

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };
    const syncTheme = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    syncTheme();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncTheme);
      return () => {
        mediaQuery.removeEventListener("change", syncTheme);
      };
    }

    legacyMediaQuery.addListener?.(syncTheme);
    return () => {
      legacyMediaQuery.removeListener?.(syncTheme);
    };
  }, []);

  React.useLayoutEffect(() => {
    syncDocumentTheme(mode, resolvedTheme);
  }, [mode, resolvedTheme]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures so the preview shell still works in restricted contexts.
    }
  }, [mode]);

  return (
    <PreviewThemeContext.Provider
      value={{
        mode,
        resolvedTheme,
        setMode,
      }}
    >
      {props.children}
    </PreviewThemeContext.Provider>
  );
}

export function usePreviewTheme() {
  const context = React.useContext(PreviewThemeContext);
  if (!context) {
    throw new Error("usePreviewTheme must be used within PreviewThemeProvider.");
  }

  return context;
}

export function PreviewThemeControl() {
  const { mode, setMode } = usePreviewTheme();

  return (
    <div className="theme-control">
      <span className="theme-toggle-label">Theme</span>
      <div aria-label="Color theme" className="theme-toggle" role="group">
        {THEME_OPTIONS.map((option) => (
          <button
            aria-pressed={mode === option.mode}
            className={`theme-toggle-button ${mode === option.mode ? "is-active" : ""}`}
            key={option.mode}
            onClick={() => setMode(option.mode)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
