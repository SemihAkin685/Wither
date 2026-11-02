# Pack export, import and in game testing

## Why

Getting an addon from Wither into the game is the slowest step of the loop today. Every test means zipping packs by hand and importing them into Minecraft. The goal is a one click "Test in game" that installs the project's packs, optionally attaches them to a world, and starts the game, plus proper .mcaddon / .mcpack export and import.

Target setups: mcpelauncher on Linux (native and Flatpak) and Minecraft Bedrock on Windows (GDK and older UWP installs).

## Goals

* Export the open project as a .mcaddon (all packs) or a single pack as a .mcpack.
* Import a .mcaddon, .mcpack or .zip as a new project.
* Detect Minecraft installs (com.mojang folders) automatically, with a manual override.
* "Test in game" panel with two targets:
  * Install to game: copy packs into development_behavior_packs / development_resource_packs only.
  * Install to world: same copy, plus attach the packs to a world picked from a list of the user's worlds, shown as cards with thumbnails.
* Start the game after installing.

## Non goals

* Importing an archive into the already open project (import always creates a new project).
* Launching straight into a specific world. Minecraft has no reliable way to do that on these platforms; the user opens the world in game.
* Android, iOS, consoles, Bedrock Dedicated Server.
* Editing or creating worlds beyond adding pack references.
* Hot reload while inside a world (development packs refresh when the world is re-entered, that's enough).

## Anti goals

* Anything that can corrupt a world. Writes to a world are limited to world_behavior_packs.json and world_resource_packs.json, written atomically (temp file + rename), and existing entries are never removed or reordered.
* Writing outside the chosen com.mojang folder or the chosen import folder. Zip entries with absolute paths, .. components or symlinks are rejected.
* Silently overwriting a non empty folder on import.

## Background facts

* A pack is any folder with a manifest.json. Its header has uuid and version ([major, minor, patch]); modules[].type tells the kind: "data" or "script" means behavior pack, "resources" means resource pack. wither-diagnostics already treats every manifest.json folder as a pack.
* .mcpack is a zip of one pack with manifest.json at the root (or inside a single top level folder, both appear in the wild). .mcaddon is a zip with one folder per pack.
* com.mojang locations:
  * Linux mcpelauncher: ~/.local/share/mcpelauncher/games/com.mojang, Flatpak: ~/.var/app/io.mrarm.mcpelauncher/data/mcpelauncher/games/com.mojang
  * Windows GDK (1.21.120+): %APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang, plus per user folders under %APPDATA%\Minecraft Bedrock\Users\<id>\games\com.mojang where worlds live
  * Windows UWP (older): %LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang
* Worlds live in com.mojang/minecraftWorlds/<folder>/ with levelname.txt (display name), world_icon.jpeg (thumbnail, may be missing) and level.dat (mtime is a good "last played").
* A world's packs are listed in world_behavior_packs.json / world_resource_packs.json as [{ "pack_id": uuid, "version": [x,y,z] }]. Packs in development_* folders resolve from those references.

## Design

### Rust: new crate wither-packs

Logic that doesn't need Tauri goes into a new crate crates/packs (wither-packs), tested without a window like the others. New dependency: zip (deflate only). Pieces:

* manifest: read a manifest.json, return name, uuid, version, kind (Behavior / Resource / Skin / Unknown). Comments and trailing commas should not break it, reuse whatever lenient JSON reading the project already has if any, otherwise serde_json after stripping // comments.
* discover packs in a project folder (every folder with a manifest.json, not nested inside another pack).
* export: write a pack folder or a set of packs to a zip. .mcpack has the pack's files at the root. .mcaddon has one folder per pack named after the pack folder. Skip .git, node_modules and dotfiles.
* import: open a zip, find every manifest.json, extract each pack into <target>/<pack folder name>. If the archive has a single pack at its root, use the archive file name (sanitized) as the folder name. Reject unsafe entry paths. Nested .mcpack files inside a .mcaddon (some addons ship that way) get extracted too.
* installs: detect com.mojang folders for the current OS (list of { label, path }), plus validate a user supplied one (must exist and contain or be able to hold development_behavior_packs).
* worlds: list worlds under a com.mojang (folder id, name, last played, has icon), read a world icon as bytes.
* install: copy a pack into development_<kind>_packs/<pack folder name>, replacing the previous copy of the same pack (delete target folder then copy; target folder name is derived from the project, never from user input paths). Skin and unknown packs are skipped with a note.
* attach: add { pack_id, version } to the world's JSON list. If the uuid is already present, update its version in place. Atomic write.

### Tauri layer

New commands in commands.rs, registered in lib.rs, mirrored in api.ts and types.ts:

* export_project(kind: "mcaddon" | "mcpack", packPath?) → asks for the save path with the dialog plugin, returns the written path or None if cancelled.
* import_archive() → asks for the archive, then for an empty target folder, extracts, then opens it like open_workspace (and adds it to recent). Non empty folder → error.
* minecraft_installs() → detected installs plus the manual one from settings.
* list_worlds(install) / world_icon(install, folder) → icon returned as raw bytes like read_image.
* test_in_game(install, world?: folder) → install all packs, attach if a world is given, launch the game. Returns a short report (installed packs, skipped ones, whether launch was attempted).

Commands only accept install paths that are in the detected list or the saved manual path, and world folder ids that list_worlds returned for that install, same idea as open_recent only accepting recent paths.

Export, import and test need a workspace opened from disk; the in memory sample project gets a clear error. Unsaved buffers: the frontend asks to save all first (reuse ConfirmDialog).

### Launching

* Linux: if Flatpak io.mrarm.mcpelauncher is installed, flatpak run io.mrarm.mcpelauncher; otherwise mcpelauncher-ui-qt from PATH. (Builder's call to check whether mcpelauncher-client can be started directly without the version picker; the launcher UI is acceptable.)
* Windows: open the minecraft: URI.
* Settings gets an optional launch command override (string, empty means auto).
* Process is spawned detached, Wither doesn't wait for it. Detecting "already running" is best effort; if the check is unreliable, skip it and always launch.

### Settings

Add to Settings / SettingsPatch (serde default keeps old files loading):

* minecraftInstall: optional path, the manual com.mojang override.
* launchCommand: optional string.
* lastTestTarget: remembered target ("game" or a world folder id with its install), so the next test is one click.

### Frontend

* Menu: File → Import Addon…, Export as .mcaddon…, Export Pack as .mcpack… (pack picker if the project has several). Same entries in the command palette.
* Test in game panel (sidebar view or dialog, builder's call matching existing UI): install selector when more than one install is found, a "Game only" option and a grid of world cards (thumbnail, name, last played), a primary "Install and launch" button. Title bar / status bar gets a quick "Test in game" button that reuses the last target.
* Results and errors go to the output log.
* Tokens from styles/tokens.css, check dark and light themes. Missing world icon shows a neutral placeholder.

## Calls made without the user (check these)

* Install model: an install is { label, packs_root, worlds_root }. On Linux and UWP both are the same com.mojang. On GDK, development packs go to the Shared com.mojang and each per user folder that has minecraftWorlds becomes its own install entry (label includes the user folder id). The builder should verify on a real GDK install that dev packs in Shared resolve for per user worlds; if not, packs_root becomes the per user folder.
* Install folder naming: development_*/<sanitized project name>_<pack folder name>. Avoids collisions between two packs both called BP and between projects.
* Stale copies: Wither writes a .wither-install marker (project root path + pack uuid) into every folder it installs. Before installing, any folder in development_* with a Wither marker and the same uuid is removed. Folders without the marker are never touched; if one shares the uuid, the report warns about it.
* Game already running while attaching to a world: if detection says the game is running, the UI asks for confirmation before writing world JSON (the game can overwrite it when leaving the world). If detection isn't possible on a platform, just warn in the output log. Attach always happens before launch.
* Validation: an unreadable or invalid manifest.json blocks that pack from export and install with an error. Diagnostics findings never block; no dependency on wither-diagnostics.

## Tests

Rust unit tests in wither-packs: manifest kind detection, export then import round trip, unsafe zip entries rejected, attach adds / updates without dropping existing entries, world listing from a temp com.mojang. No frontend tests (project has no runner).

## Left to the builder

Exact UI placement of the test panel, file naming details, error wording, how to split work into commits.
