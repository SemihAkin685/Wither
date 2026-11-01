import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Settings, SettingsPatch } from "../lib/types";

export const defaultSettings: Settings = {
  theme: "dark",
  uiFontSize: 13,
  editorFontSize: 14,
  showLineNumbers: true,
};

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
