//! What the editor can suggest inside a Bedrock pack. The component names, the manifest
//! vocabulary, the vanilla identifiers and commands all come straight out of bedrock_addon, so the
//! suggestions match what the diagnostics accept. The editor asks for the catalog once and
//! does the cursor work on its side.

use bedrock_addon::families::biome::component::BiomeComponent;
use bedrock_addon::families::block::component::BlockComponent;
use bedrock_addon::families::client_biome::component::ClientBiomeComponent;
use bedrock_addon::families::entity::component::EntityComponent;
use bedrock_addon::families::item::component::ItemComponent;
use bedrock_addon::families::particle::component::ParticleComponent;
use bedrock_addon::families::script::meta::{self as script_meta, ModuleVersion};
use bedrock_addon::manifest::{CapabilityRegistry, ModuleType};
use bedrock_addon::vanilla;
use bedrock_addon::versioning::{ComponentMeta, ComponentTable, ContextArea, Family};
use serde::Serialize;

pub mod script_api;

use script_api::{script_api, ScriptModuleApi};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub families: Vec<FamilyCatalog>,
    pub manifest: ManifestCatalog,
    pub vanilla: VanillaCatalog,
    /// Exports and members of the public script modules, newest stable version each.
    pub script_api: &'static [ScriptModuleApi],
}

/// One document family with a component table, like blocks or entities.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyCatalog {
    pub name: &'static str,
    /// The root member that holds the definition, `minecraft:block` for blocks.
    pub payload_key: &'static str,
    /// Pack folders the family's files sit in, used to guess the family of an empty file.
    pub directories: &'static [&'static str],
    /// Members of the payload object.
    pub members: &'static [&'static str],
    /// Members of `description`.
    pub description: &'static [&'static str],
    /// Paths under the payload whose objects hold components, `*` matches any key or index.
    pub component_parents: &'static [&'static str],
    pub components: Vec<ComponentInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInfo {
    pub name: &'static str,
    /// First format version that accepts it, when the family gates it by version at all.
    pub released: Option<String>,
    pub deprecated_since: Option<String>,
    /// The component that replaces this one, when the game names one.
    pub superseded_by: Option<&'static str>,
    pub experimental: bool,
    /// Members the game added later on, the only member names the table knows about.
    pub fields: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCatalog {
    pub module_types: Vec<&'static str>,
    pub capabilities: Vec<&'static str>,
    pub script_modules: Vec<ScriptModule>,
}

/// A script module a manifest can depend on, by `module_name`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptModule {
    pub name: &'static str,
    /// Newest first, the beta (if any) leads.
    pub versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VanillaCatalog {
    pub blocks: &'static [&'static str],
    pub items: &'static [&'static str],
    pub entities: &'static [&'static str],
    pub biomes: &'static [&'static str],
    pub effects: &'static [&'static str],
    pub enchantments: &'static [&'static str],
    pub commands: Vec<CommandInfo>,
}

/// A slash command, for `runCommand` strings in scripts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    /// The first overload written out, like `give <player: target> [amount: int]`.
    pub usage: String,
}

/// Everything the editor suggests, built fresh on each call. It is cheap, a few thousand
/// static strings, so the caller can just ask again instead of caching.
pub fn catalog() -> Catalog {
    let ids = vanilla::ids();
    Catalog {
        families: families(),
        manifest: ManifestCatalog {
            module_types: ModuleType::ALL
                .into_iter()
                .filter(|ty| *ty != ModuleType::Invalid)
                .map(ModuleType::name)
                .collect(),
            capabilities: CapabilityRegistry::default().names().collect(),
            script_modules: script_modules(),
        },
        vanilla: VanillaCatalog {
            blocks: ids.blocks,
            items: ids.items,
            entities: ids.entities,
            biomes: ids.biomes,
            effects: ids.effects,
            enchantments: ids.enchantments,
            commands: vanilla::commands().iter().map(command_info).collect(),
        },
        script_api: script_api(),
    }
}

fn families() -> Vec<FamilyCatalog> {
    // hmm, the payload layout isn't in the component tables, so it's written out here. it only
    // covers the containers, every component name still comes from bedrock_addon
    vec![
        FamilyCatalog {
            name: "block",
            payload_key: "minecraft:block",
            directories: &["blocks"],
            members: &["description", "components", "permutations"],
            description: &[
                "identifier",
                "menu_category",
                "states",
                "traits",
                "is_experimental",
            ],
            component_parents: &["components", "permutations/*/components"],
            components: components(BlockComponent::TABLE),
        },
        FamilyCatalog {
            name: "item",
            payload_key: "minecraft:item",
            directories: &["items"],
            members: &["description", "components"],
            description: &["identifier", "menu_category", "is_experimental"],
            component_parents: &["components"],
            components: components(ItemComponent::TABLE),
        },
        FamilyCatalog {
            name: "entity",
            payload_key: "minecraft:entity",
            directories: &["entities"],
            members: &["description", "components", "component_groups", "events"],
            description: &[
                "identifier",
                "is_spawnable",
                "is_summonable",
                "is_experimental",
                "runtime_identifier",
                "properties",
                "animations",
                "scripts",
            ],
            component_parents: &["components", "component_groups/*"],
            components: components(EntityComponent::TABLE),
        },
        FamilyCatalog {
            name: "biome",
            payload_key: "minecraft:biome",
            directories: &["biomes"],
            members: &["description", "components"],
            description: &["identifier"],
            component_parents: &["components"],
            components: components(BiomeComponent::TABLE),
        },
        FamilyCatalog {
            name: "client_biome",
            payload_key: "minecraft:client_biome",
            directories: &["biomes"],
            members: &["description", "components"],
            description: &["identifier"],
            component_parents: &["components"],
            components: components(ClientBiomeComponent::TABLE),
        },
        FamilyCatalog {
            name: "particle",
            payload_key: "particle_effect",
            directories: &["particles"],
            members: &["description", "curves", "events", "components"],
            description: &["identifier", "basic_render_parameters"],
            component_parents: &["components"],
            components: components(ParticleComponent::TABLE),
        },
    ]
}

fn command_info(command: &vanilla::Command) -> CommandInfo {
    let mut usage = command.name.to_owned();
    for param in command
        .overloads
        .first()
        .map_or(&[][..], |overload| overload.params)
    {
        let (open, close) = if param.optional {
            ('[', ']')
        } else {
            ('<', '>')
        };
        usage.push_str(&format!(
            " {open}{}: {}{close}",
            param.name, param.type_name
        ));
    }
    CommandInfo {
        name: command.name,
        aliases: command.aliases,
        usage,
    }
}

fn script_modules() -> Vec<ScriptModule> {
    script_meta::modules()
        .iter()
        .map(|module| ScriptModule {
            name: module.name,
            versions: module.versions.iter().rev().map(version_text).collect(),
        })
        .collect()
}

fn version_text(version: &ModuleVersion) -> String {
    let ModuleVersion {
        major,
        minor,
        patch,
        ..
    } = *version;
    match version.pre {
        Some(pre) => format!("{major}.{minor}.{patch}-{pre}"),
        None => format!("{major}.{minor}.{patch}"),
    }
}

/// The rows a pack may write, vanilla only rows are left out.
fn components<F: Family>(table: &ComponentTable<F>) -> Vec<ComponentInfo> {
    table
        .0
        .iter()
        .filter(|meta| meta.area == ContextArea::Public)
        .map(|meta| info(meta, table))
        .collect()
}

fn info<F: Family>(meta: &ComponentMeta<F>, table: &ComponentTable<F>) -> ComponentInfo {
    // ok so the table stores it backwards, the new row says which old one it supersedes
    let superseded_by = table
        .0
        .iter()
        .find(|other| other.supersedes == Some(meta.name))
        .map(|other| other.name);
    ComponentInfo {
        name: meta.name,
        released: meta.released.map(|version| version.to_string()),
        deprecated_since: meta.deprecated_since.map(|version| version.to_string()),
        superseded_by,
        // hmm, most families leave `released` empty for "always there", so only a row with
        // nothing but an experiment gate counts as experimental
        experimental: meta.released.is_none() && !meta.requires.is_empty(),
        fields: meta
            .fields
            .iter()
            .map(|field| field.name)
            // yeah, "" means the whole component and nested ones aren't direct members
            .filter(|name| !name.is_empty() && !name.contains('.'))
            .collect(),
    }
}
