import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import banner from "@assets/banner.png";
import type { AppInfo, Settings, SettingsPatch, Theme } from "../lib/types";

interface SettingsViewProps {
  settings: Settings;
  appInfo: AppInfo | null;
  onChange: (patch: SettingsPatch) => void;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={13} />
      </button>
      <span>{value}px</span>
      <button type="button" aria-label="Increase" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={13} />
      </button>
    </div>
  );
}

function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-description">{description}</div>
      </div>
      {children}
    </div>
  );
}

const themes: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function SettingsView({ settings, appInfo, onChange }: SettingsViewProps) {
  return (
    <div className="settings-view">
      <div className="settings-inner">
        <h1>Settings</h1>

        <section>
          <h2>Appearance</h2>
          <Row title="Theme" description="Color theme for the whole workbench.">
            <div className="segmented" role="radiogroup">
              {themes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === t.value}
                  className={settings.theme === t.value ? "is-active" : ""}
                  onClick={() => onChange({ theme: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Interface font size" description="Size of sidebar, tab and status bar text.">
            <Stepper value={settings.uiFontSize} min={11} max={18} onChange={(v) => onChange({ uiFontSize: v })} />
          </Row>
        </section>

        <section>
          <h2>Editor</h2>
          <Row title="Font size" description="Size of code in the editor.">
            <Stepper
              value={settings.editorFontSize}
              min={10}
              max={24}
              onChange={(v) => onChange({ editorFontSize: v })}
            />
          </Row>
          <Row title="Line numbers" description="Show line numbers in the gutter.">
            <button
              type="button"
              role="switch"
              aria-checked={settings.showLineNumbers}
              className={`switch${settings.showLineNumbers ? " is-on" : ""}`}
              onClick={() => onChange({ showLineNumbers: !settings.showLineNumbers })}
            >
              <span />
            </button>
          </Row>
        </section>

        <section>
          <h2>About</h2>
          <div className="about-card">
            <img src={banner} alt="Wither banner" draggable={false} />
            <div className="about-meta">
              <strong>{appInfo?.name ?? "Wither"}</strong>
              <span>{appInfo ? `Version ${appInfo.version}` : ""}</span>
              <span>{appInfo?.tagline}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
