use crate::workspace::{Workspace, WorkspaceBuilder};

/// Mock Bedrock project used until real folders can be opened.
pub fn bedrock_workspace() -> Workspace {
    WorkspaceBuilder::new("Withered Realms", "~/addons/withered-realms")
        .file("README.md", README)
        .file("behavior_pack/manifest.json", BP_MANIFEST)
        .file("behavior_pack/pack_icon.png", "")
        .file("behavior_pack/entities/wither_knight.json", BP_ENTITY)
        .file("behavior_pack/items/withered_blade.json", BP_ITEM)
        .file("behavior_pack/scripts/main.js", BP_SCRIPT)
        .file("resource_pack/manifest.json", RP_MANIFEST)
        .file("resource_pack/pack_icon.png", "")
        .file("resource_pack/entity/wither_knight.entity.json", RP_ENTITY)
        .file("resource_pack/texts/en_US.lang", RP_LANG)
        .file("resource_pack/ui/_ui_defs.json", RP_UI_DEFS)
        .file("resource_pack/ui/withered_menu.json", RP_UI_MENU)
        .build()
}

const README: &str = r#"# Withered Realms

A small Bedrock addon that adds the Wither Knight and the Withered Blade.

## Layout

- behavior_pack: server side logic, entities, items and scripts
- resource_pack: client visuals, entity definitions and translations

## Building

Packaging is not wired up yet. Copy both packs into your development folders.
"#;

const BP_MANIFEST: &str = r#"{
  "format_version": 2,
  "header": {
    "name": "Withered Realms BP",
    "description": "Behavior pack for Withered Realms",
    "uuid": "8f3c1a52-7d4e-4b9a-9c21-5e7f0b6d2a14",
    "version": [1, 0, 0],
    "min_engine_version": [1, 21, 0]
  },
  "modules": [
    {
      "type": "data",
      "uuid": "1b6e9d03-2c8f-4f57-a3d4-90e7c2b85f61",
      "version": [1, 0, 0]
    },
    {
      "type": "script",
      "language": "javascript",
      "uuid": "c4a27f18-6b3d-4e09-8f5a-3d1e9b7c0a26",
      "entry": "scripts/main.js",
      "version": [1, 0, 0]
    }
  ],
  "dependencies": [
    {
      "uuid": "e2d84b71-0f6a-4c3e-b958-7a1c5d3f9e40",
      "version": [1, 0, 0]
    },
    {
      "module_name": "@minecraft/server",
      "version": "1.16.0"
    }
  ]
}
"#;

const BP_ENTITY: &str = r#"{
  "format_version": "1.21.0",
  "minecraft:entity": {
    "description": {
      "identifier": "wither:knight",
      "is_spawnable": true,
      "is_summonable": true
    },
    "components": {
      "minecraft:health": {
        "value": 40,
        "max": 40
      },
      "minecraft:movement": {
        "value": 0.28
      },
      "minecraft:attack": {
        "damage": 6,
        "effect_name": "wither",
        "effect_duration": 5
      },
      "minecraft:behavior.melee_attack": {
        "priority": 2,
        "speed_multiplier": 1.2
      },
      "minecraft:behavior.nearest_attackable_target": {
        "priority": 1,
        "entity_types": [
          {
            "filters": { "test": "is_family", "subject": "other", "value": "player" },
            "max_dist": 24
          }
        ]
      },
      "minecraft:physics": {}
    }
  }
}
"#;

const BP_ITEM: &str = r#"{
  "format_version": "1.21.0",
  "minecraft:item": {
    "description": {
      "identifier": "wither:withered_blade",
      "menu_category": { "category": "equipment" }
    },
    "components": {
      "minecraft:icon": "withered_blade",
      "minecraft:max_stack_size": 1,
      "minecraft:damage": 9,
      "minecraft:durability": { "max_durability": 1024 },
      "minecraft:hand_equipped": true
    }
  }
}
"#;

const BP_SCRIPT: &str = r#"import { world, system } from "@minecraft/server";

const KNIGHT_ID = "wither:knight";

world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (entity.typeId !== KNIGHT_ID) return;

  // Announce every knight so players know trouble is coming
  world.sendMessage(`§5A Wither Knight has risen at ${formatLocation(entity.location)}`);
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const held = player.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
    if (held?.typeId === "wither:withered_blade") {
      player.addEffect("night_vision", 220, { showParticles: false });
    }
  }
}, 100);

function formatLocation({ x, y, z }) {
  return [x, y, z].map((n) => Math.floor(n)).join(", ");
}
"#;

const RP_MANIFEST: &str = r#"{
  "format_version": 2,
  "header": {
    "name": "Withered Realms RP",
    "description": "Resource pack for Withered Realms",
    "uuid": "e2d84b71-0f6a-4c3e-b958-7a1c5d3f9e40",
    "version": [1, 0, 0],
    "min_engine_version": [1, 21, 0]
  },
  "modules": [
    {
      "type": "resources",
      "uuid": "5a9f3e27-81c4-4d6b-b07e-2f8d1c6a4e93",
      "version": [1, 0, 0]
    }
  ]
}
"#;

const RP_ENTITY: &str = r##"{
  "format_version": "1.10.0",
  "minecraft:client_entity": {
    "description": {
      "identifier": "wither:knight",
      "materials": { "default": "entity_alphatest" },
      "textures": { "default": "textures/entity/wither_knight" },
      "geometry": { "default": "geometry.wither_knight" },
      "render_controllers": ["controller.render.default"],
      "spawn_egg": {
        "base_color": "#1c1726",
        "overlay_color": "#a78bfa"
      }
    }
  }
}
"##;

const RP_LANG: &str = r#"## Withered Realms translations
entity.wither:knight.name=Wither Knight
item.spawn_egg.entity.wither:knight.name=Spawn Wither Knight
item.wither:withered_blade=Withered Blade
pack.name=Withered Realms
pack.description=Knights, blades and a lot of soul sand
withered.menu.title=Withered Realms
withered.menu.settings=Realm Settings
"#;

const RP_UI_DEFS: &str = r#"{
  "ui_defs": ["ui/withered_menu.json"]
}
"#;

const RP_UI_MENU: &str = r##"{
  "namespace": "withered_menu",

  // the vanilla action form, title swapped for our own. body text and buttons come
  // from the server at runtime, the preview fills them from its preview data
  "main_screen": {
    "type": "panel",
    "controls": [
      {
        "form@server_form.long_form": {
          "$text_name": "withered.menu.title"
        }
      }
    ]
  },

  // the modal settings form with inputs, toggles, sliders and dropdowns
  "settings_screen": {
    "type": "panel",
    "controls": [
      {
        "form@server_form.custom_form": {
          "$text_name": "withered.menu.settings"
        }
      }
    ]
  }
}
"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_has_both_packs_and_readable_manifests() {
        let ws = bedrock_workspace();
        let roots: Vec<_> = ws.tree.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(roots, ["behavior_pack", "resource_pack", "README.md"]);
        for path in [
            "behavior_pack/manifest.json",
            "resource_pack/manifest.json",
            "resource_pack/ui/_ui_defs.json",
        ] {
            let text = ws.read(path).unwrap();
            serde_json::from_str::<serde_json::Value>(text).unwrap();
        }
    }

    #[test]
    fn search_finds_identifiers_across_packs() {
        let ws = bedrock_workspace();
        let hits = ws.search("wither:knight", 50);
        assert!(hits.iter().any(|m| m.path.starts_with("behavior_pack")));
        assert!(hits.iter().any(|m| m.path.starts_with("resource_pack")));
    }
}
