# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex and others) when working with code in this repository.

Wither is a native desktop IDE for Minecraft Bedrock addon development: a Tauri 2 app with a React 19 + TypeScript frontend and a Rust workspace behind it.

## Commands

Frontend and app (run in apps/desktop):

```sh
npm install
npm run dev          # tauri dev, Vite + app with hot reload, Rust changes rebuild and restart
npm run dev:web      # Vite only, no Tauri backend (invoke calls will fail)
npm run typecheck    # tsc --noEmit
npm run build:web    # typecheck + vite build into apps/desktop/dist
npm run build        # release build and installers
```

Rust (run at the repository root):

```sh
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p wither-diagnostics                 # one crate
cargo test -p wither-completion --test catalog   # one integration test file
cargo test -p wither-workspace some_test_name    # tests matching a name
```

apps/desktop/dist must exist before any Rust build that touches the app crate (clippy over the workspace, cargo test --workspace), because tauri::generate_context! checks frontendDist at compile time. On a fresh clone run npm run build:web once first.

CI (.github/workflows/ci.yml) runs exactly: npm ci, typecheck, build:web, cargo fmt --check, clippy with -D warnings and --locked, cargo test --workspace --locked on Linux, macOS and Windows. The frontend has no test runner; don't add one for a single change.

Regenerating the script API data shipped in crates/completion/data/script_api.json:

```sh
cargo run -p wither-completion --example script_api -- <script_modules/@minecraft> [out.json]
```

The input is the docs/script_modules folder a dedicated server writes, or metadata/script_modules from Mojang's bedrock-samples.

## Architecture

Logic that doesn't need Tauri lives in crates under crates/ so it can be tested without a window. apps/desktop/src-tauri is a thin layer: AppState (state.rs) holds Mutex wrapped settings, the open Workspace, recent projects and a TerminalManager, and commands.rs exposes them as #[tauri::command] functions registered in lib.rs. Errors go through CommandError, which serializes to a plain string for the UI.

Crates:

* wither-workspace: a project held fully in memory. Text files are loaded up front (skips .git, node_modules, target; caps on file count and size) so search and diagnostics never hit the disk; folder backed workspaces write saves through. Also the file tree, search, recent list and the built in sample project.
* wither-diagnostics: treats every folder with a manifest.json as a pack, stacks them and loads them with bedrock_addon, then maps findings back to workspace file, line and column. check_workspace passes unsaved editor buffers so problems reflect what's on screen.
* wither-completion: completion catalog (components, manifest values, vanilla ids, commands) from bedrock_addon, plus the script module API loaded from the bundled JSON.
* wither-core: AppInfo and Settings (with SettingsPatch for partial updates, persisted to settings.json in the app config dir).
* wither-git: status, init, checkout and branch creation by shelling out to the git CLI.
* wither-terminal: pty sessions via portable-pty; output and exit stream to the frontend over Tauri Channels.
* wither-packs: pack discovery from manifest.json, .mcaddon / .mcpack export and import (zip, rejects entries escaping the target), Minecraft install detection (mcpelauncher on Linux, GDK and UWP on Windows), world listing, installing into development_*_packs with a .wither-install marker so only Wither's own copies get replaced, attaching packs to a world and launching the game.

bedrock_addon is pinned to a specific commit of bedrock-rs in the root Cargo.toml, and smallvec must stay at 2.0.0-beta.1 in Cargo.lock because newer betas break bedrock_addon_support. Don't bump either casually.

Frontend (apps/desktop/src):

* lib/api.ts is the single place that calls invoke; lib/types.ts mirrors the Rust IPC types. Rust types crossing IPC use serde rename_all camelCase. When you add or change a command, update commands.rs, the generate_handler! list in lib.rs, api.ts and types.ts together.
* state/workbench.ts is a plain reducer (tabs, buffers, file tree, panels, palette, output log) driven by useWorkbench; useSettings and useGit wrap their slices of backend state.
* The editor is hand written, no Monaco or CodeMirror: components/CodeEditor.tsx with lib/highlight.ts, lib/editing.ts (line operations) and lib/completion (context detection, JSON and script providers backed by the Rust catalog).
* lib/jsonui is a JSON UI preview renderer: parse, resolve (@base merging, variables, bindings, requires expressions), layout and paint. Vanilla UI files and textures are downloaded on demand from Mojang's bedrock-samples at a pinned tag (VANILLA_VERSION in vanilla.ts) and cached in IndexedDB, never bundled.
* Colors, spacing and fonts come from styles/tokens.css. Use tokens over hard coded values and check UI changes in both dark and light themes. Reuse branding from assets/ instead of adding new logos.

Linux only: desktop_entry.rs installs a .desktop entry at startup so Wayland shows the real app icon. WebKitGTK ignores canvas filters, so see through panels blur by hand.

## Conventions

* Commit titles: plain imperative sentence case, no type: prefix, single line (matches recent history). CONTRIBUTING.md still describes Conventional Commits, but the maintainer doesn't use them here. Branches use type/short-kebab-name, e.g. fix/terminal-resize.
* Add Rust tests next to the code (or in the crate's tests/ folder, as diagnostics and completion do).
* Releases are cut by pushing a tag like v0.2.0. The version must match in Cargo.toml, apps/desktop/package.json and apps/desktop/src-tauri/tauri.conf.json. The nightly workflow publishes a rolling prerelease under the nightly tag.
