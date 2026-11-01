# Contributing to Wither

Thanks for your interest in Wither. This guide covers how to set up the project, how the code is organized and what we expect from a pull request.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it. Bug reports and feature requests use the templates in the issue tracker. Security problems are never reported in public issues, see [SECURITY.md](SECURITY.md).

## Setup

You need:

- Rust 1.80 or newer (stable, via rustup)
- Node.js 20 or newer
- The Tauri system dependencies for your platform, see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

On Debian or Ubuntu the Linux dependencies are:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev libssl-dev
```

On Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel openssl-devel
```

Then:

```sh
git clone https://github.com/SemihAkin685/Wither.git
cd Wither/apps/desktop
npm install
npm run dev
```

npm run dev starts Vite and launches the app with hot reload. Rust changes trigger a rebuild and restart automatically.

## Project layout

| Path | What lives there |
| --- | --- |
| apps/desktop/src | React and TypeScript frontend |
| apps/desktop/src-tauri | Tauri app crate, IPC commands and app state |
| crates/core | Shared app types and settings |
| crates/terminal | Pty sessions for the terminal panel |
| crates/workspace | Workspace tree, in memory files, search, sample project |
| assets | Logos and banners, reuse these instead of adding new branding |

Keep new code inside the boundary it belongs to. Logic that doesn't need Tauri goes into a crate under crates so it can be tested without a window. Only add a new crate when there is a clear architectural boundary.

## Checks

Run these before opening a pull request. CI runs the same ones.

```sh
# repository root
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# apps/desktop
npm run typecheck
npm run build:web
```

Clippy and test builds need apps/desktop/dist to exist, so run npm run build:web once before building Rust on a fresh clone.

If you change the UI, check it by hand in the running app in both the dark and the light theme.

## Code style

- Match the style of the surrounding code. Rust is formatted with rustfmt, TypeScript follows the existing files.
- Keep changes focused. Don't mix refactors or formatting changes with a fix.
- Rust types that cross IPC use serde with camelCase, and their TypeScript mirrors live in apps/desktop/src/lib/types.ts. Update both together.
- Colors, spacing and fonts come from the design tokens in apps/desktop/src/styles/tokens.css. Prefer a token over a hard coded value.
- Add tests next to the code for new Rust logic. The frontend has no test runner yet, so don't add a framework just for one change.
- Comments explain why, not what. Describe the current behavior, change history belongs in the commit.

## Commits and pull requests

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/) in lowercase, without a scope:

```
feat: add json schema hints for manifests
fix: keep terminal alive when panel hides
docs: explain the workspace crate
```

Common types are feat, fix, docs, refactor, perf, test, build, ci and chore.

Branch names use the same types, for example fix/terminal-resize or feat/manifest-schema.

One purpose per pull request. Fill in the template, link the related issue and add screenshots for visual changes. A maintainer reviews every pull request before it is merged.

## Releases

Releases are built by the Release workflow when a maintainer pushes a tag like v0.2.0. It creates a draft GitHub release with installers for Linux, Windows and macOS. The version has to match in Cargo.toml, apps/desktop/package.json and apps/desktop/src-tauri/tauri.conf.json.

## License

By contributing you agree that your contributions are licensed under the MIT license of this project.
