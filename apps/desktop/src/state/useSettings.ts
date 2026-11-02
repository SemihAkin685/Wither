import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Settings, SettingsPatch } from "../lib/types";

export const defaultSettings: Settings = {
  theme: "dark",
  uiFontSize: 13,
  editorFontSize: 14,
  showLineNumbers: true,
  tabSize: 2,
  highlightCurrentLine: true,
  suggestions: true,
};

// mirrors of the clamps in crates/core/src/settings.rs
export const UI_FONT_SIZE_RANGE = [11, 18] as const;
export const EDITOR_FONT_SIZE_RANGE = [10, 24] as const;
export const TAB_SIZE_RANGE = [1, 8] as const;

function applyToDocument(settings: Settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty("--ui-font-size", `${settings.uiFontSize}px`);
  root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
}

export function useSettings(onError: (message: string) => void) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((error) => onError(`Could not load settings: ${errorMessage(error)}`));
  }, [onError]);

  useEffect(() => applyToDocument(settings), [settings]);

  const update = useCallback(
    (patch: SettingsPatch) => {
      setSettings((current) => ({ ...current, ...patch }));
      api
        .updateSettings(patch)
        .then(setSettings)
        .catch((error) => onError(`Could not save settings: ${errorMessage(error)}`));
    },
    [onError],
  );

  return { settings, update };
}
