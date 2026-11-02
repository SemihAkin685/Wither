<p align="center"><img src="assets/banner.png" alt="Wither" width="640"></p>

# Wither

Wither is a native desktop IDE for Minecraft Bedrock Edition addon development, built with Rust and Tauri.

This first milestone is the IDE shell: title bar, explorer, workspace search, editor tabs, a lightweight code editor, bottom panel with a real system terminal, status bar, command palette and themes. Workspaces are served from mock data for now. Packs are checked as you type with [bedrock_addon](https://github.com/bedrock-crustaceans/bedrock-rs), the library behind [shulker](https://github.com/bedrock-crustaceans/shulker): JSON and script syntax errors and what the game would report about the addon show up in the editor and the Problems panel. JSON and script files get VS Code style completion (Ctrl+Space, or just start typing): component names per document family, manifest values, script modules, commands inside runCommand and vanilla ids come from the same library. Scripts also get the @minecraft/server, server-ui, common and gametest API: names inside import braces, and members after a dot, followed through chains like world.afterEvents.playerJoin.subscribe((event) => event.), local variables, for of loops and TypeScript or JSDoc annotations. That API is generated from the game's script module metadata with bedrock_addon's reader (cargo run -p wither-completion --example script_api -- <script_modules/@minecraft>) and shipped as crates/completion/data/script_api.json. Keys, values and words already used in the file are suggested too. The editor also has the usual VS Code editing shortcuts: undo and redo, line aware cut and copy, Ctrl+Shift+K to delete a line, Alt+Up/Down to move lines, Shift+Alt+Up/Down to copy them, Ctrl+/ to comment, Ctrl+] and Ctrl+[ to indent, Ctrl+L to select a line and Ctrl+Enter to open a new line. Packaging and Minecraft integration come later.

## Requirements

Rust 1.98+, Node 20+, and the Tauri system dependencies for your platform (on Linux: webkit2gtk 4.1 and GTK 3).

## Development

```sh
cd apps/desktop
npm install
npm run dev        # launches the app with hot reload
npm run build      # release build and bundles
```

Rust tests run from the repository root:

```sh
cargo test --workspace
```

## Keyboard

| Action | Keys |
| --- | --- |
| Command palette | Ctrl+Shift+P |
| Go to file | Ctrl+P |
| Open workspace | Ctrl+O |
| Search in workspace | Ctrl+Shift+F |
| Toggle sidebar | Ctrl+B |
| Toggle bottom panel | Ctrl+J |
| Toggle terminal | Ctrl+` |
| Terminal copy / paste | Ctrl+Shift+C / Ctrl+Shift+V |
| JSON UI preview (files under ui/) | Ctrl+Shift+V |
| Save / Save all | Ctrl+S / Ctrl+Alt+S |
| Close tab | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Editor font size | Ctrl+= / Ctrl+- / Ctrl+0 |
| Settings | Ctrl+, |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and commit conventions. Report security issues as described in [SECURITY.md](SECURITY.md).
