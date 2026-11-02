import type { ReactNode } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import banner from "@assets/banner.png";
import type { AppInfo, Settings, SettingsPatch, Theme } from "../lib/types";
import { defaultSettings, EDITOR_FONT_SIZE_RANGE, TAB_SIZE_RANGE, UI_FONT_SIZE_RANGE } from "../state/useSettings";

interface SettingsViewProps {
  settings: Settings;
  appInfo: AppInfo | null;
  onChange: (patch: SettingsPatch) => void;
}

interface StepperProps {
  value: number;
  range: readonly [number, number];
  unit?: string;
  onChange: (v: number) => void;
}

function Stepper({ value, range: [min, max], unit = "px", onChange }: StepperProps) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={13} />
      </button>
      <span>
        {value}
        {unit}
      </span>
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

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      className={`switch${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

const themes: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function isDefault(settings: Settings) {
  return (Object.keys(defaultSettings) as (keyof Settings)[]).every((key) => settings[key] === defaultSettings[key]);
}

export function SettingsView({ settings, appInfo, onChange }: SettingsViewProps) {
  return (
    <div className="settings-view">
      <div className="settings-inner">
        <div className="settings-header">
          <h1>Settings</h1>
          <button
            type="button"
            className="settings-reset"
            disabled={isDefault(settings)}
            onClick={() => onChange(defaultSettings)}
          >
            <RotateCcw size={13} />
            Restore defaults
          </button>
        </div>

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
            <Stepper value={settings.uiFontSize} range={UI_FONT_SIZE_RANGE} onChange={(v) => onChange({ uiFontSize: v })} />
          </Row>
        </section>

        <section>
          <h2>Editor</h2>
          <Row title="Font size" description="Size of code in the editor.">
            <Stepper
              value={settings.editorFontSize}
              range={EDITOR_FONT_SIZE_RANGE}
              onChange={(v) => onChange({ editorFontSize: v })}
            />
          </Row>
          <Row title="Line numbers" description="Show line numbers in the gutter.">
            <Toggle
              on={settings.showLineNumbers}
              label="Line numbers"
              onChange={(on) => onChange({ showLineNumbers: on })}
            />
          </Row>
          <Row title="Highlight current line" description="Shade the line the caret is on.">
            <Toggle
              on={settings.highlightCurrentLine}
              label="Highlight current line"
              onChange={(on) => onChange({ highlightCurrentLine: on })}
            />
          </Row>
          <Row title="Tab size" description="Spaces inserted by Tab and auto indent, and how wide a tab character shows.">
            <Stepper
              value={settings.tabSize}
              range={TAB_SIZE_RANGE}
              unit=""
              onChange={(v) => onChange({ tabSize: v })}
            />
          </Row>
          <Row
            title="Suggestions while typing"
            description="Open completions as you type in pack JSON and scripts. Ctrl+Space works either way."
          >
            <Toggle on={settings.suggestions} label="Suggestions while typing" onChange={(on) => onChange({ suggestions: on })} />
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
