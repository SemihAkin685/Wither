import { isObject, type Json, type JsonObject } from "./parse";
import { evalExpression } from "./requires";

/**
 * Stand in for the game's data. `bindings` answers global #names, `collections`
 * feeds factories and collection bindings, one object per item.
 */
export interface PreviewData {
  bindings: Record<string, Json>;
  collections: Record<string, JsonObject[]>;
}

export const DEFAULT_PREVIEW_DATA: PreviewData = {
  bindings: {
    "#title_text": "Form Title",
    "#form_text": "This is the body text of the form. It wraps across lines just like it does in game.",
    "#submit_text": "Submit",
    "#submit_button_visible": true,
  },
  collections: {
    form_buttons: [
      { "#form_button_text": "First Button" },
      { "#form_button_text": "Second Button" },
      { "#form_button_text": "Third Button" },
    ],
    custom_form: [
      { type: "label", "#custom_text": "Pick how the realm should play." },
      { type: "input", "#custom_text": "Realm name", "#custom_placeholder_text": "Type a name", "#custom_input_text": "" },
      { type: "toggle", "#custom_text": "Allow PvP", "#custom_toggle_state": true },
      { type: "slider", "#custom_slider_text": "Difficulty: 2", "#custom_slider_value": 0.5 },
      { type: "dropdown", "#custom_text": "Game mode", "#dropdown_option_text": "Survival" },
    ],
  },
};

/** The collection items in effect for a control, keyed by collection name. */
export type CollectionScope = ReadonlyMap<string, JsonObject>;

/** A view binding that reads another control, it can only run once the whole tree exists. */
export interface DeferredView {
  source: string;
  siblingScope: boolean;
  expression: string;
  target: string;
}

const EMPTY_ENV = new Map<string, Json>();

/**
 * Runs a control's bindings against the preview data and writes the results
 * into props under their #names. View bindings pointing at other controls come
 * back so the resolver can run them after the tree is built.
 */
export function applyBindings(props: JsonObject, bindings: Json | undefined, data: PreviewData, scope: CollectionScope): DeferredView[] {
  const deferred: DeferredView[] = [];
  if (!Array.isArray(bindings)) return deferred;
  const global = (name: string) => data.bindings[name];
  for (const binding of bindings) {
    if (!isObject(binding)) continue;
    const type = typeof binding.binding_type === "string" ? binding.binding_type : "global";
    if (type === "view") {
      const expression = binding.source_property_name;
      const target = binding.target_property_name;
      if (typeof expression !== "string" || typeof target !== "string") continue;
      if (typeof binding.source_control_name === "string") {
        deferred.push({
          source: binding.source_control_name,
          siblingScope: binding.resolve_sibling_scope === true,
          expression,
          target,
        });
      } else {
        props[target] = evalExpression(expression, EMPTY_ENV, (name) => props[name]);
      }
      continue;
    }
    const name = binding.binding_name;
    if (typeof name !== "string" || !name) continue;
    let value: Json | undefined;
    if (type === "collection") {
      const collection = binding.binding_collection_name;
      const item = typeof collection === "string" ? scope.get(collection) : undefined;
      value = name.startsWith("(") ? (item ? evalExpression(name, EMPTY_ENV, (field) => item[field] ?? null) : undefined) : item?.[name];
      // inside an item, a field the server didn't send reads as empty, same as in game. enabled
      // flags are the exception, the server leaves them out when the control is usable
      const target = typeof binding.binding_name_override === "string" ? binding.binding_name_override : name;
      if (item && value === undefined && props[target] === undefined && !/enabled/.test(target)) value = null;
    } else if (type === "global" || type === "none") {
      // yeah, a binding name can itself be an expression like "(not #is_using_gamepad)"
      value = name.startsWith("(") ? evalExpression(name, EMPTY_ENV, (field) => global(field) ?? null) : global(name);
    }
    if (value === undefined) continue;
    const override = typeof binding.binding_name_override === "string" ? binding.binding_name_override : name;
    props[override] = value;
  }
  return deferred;
}

// bound #props that stand for a real property once they have a value
const BOUND_PROPERTIES: Record<string, string> = {
  "#visible": "visible",
  "#enabled": "enabled",
  "#texture": "texture",
  "#text": "text",
  "#alpha": "alpha",
  "#color": "color",
};

/**
 * Replaces "#name" property values with what the bindings stored under that name.
 * A label or image naming a #property with no binding of its own reads the global
 * data, which is how vanilla forms get their body text.
 */
export function settleBoundProps(props: JsonObject, data?: PreviewData) {
  for (const [bound, real] of Object.entries(BOUND_PROPERTIES)) {
    if (props[bound] !== undefined) props[real] = props[bound];
  }
  for (const flag of ["visible", "enabled"]) {
    const value = props[flag];
    if (value !== undefined && typeof value !== "boolean") props[flag] = value !== "false" && value !== 0 && value !== "" && value !== null;
  }
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "string" || !value.startsWith("#") || key.startsWith("#")) continue;
    if (props[value] !== undefined) props[key] = props[value];
    else if ((key === "text" || key === "texture") && data?.bindings[value] !== undefined) props[key] = data.bindings[value];
  }
}

/** Reads preview data from loosely shaped JSON, keeping only what it understands. */
export function parsePreviewData(value: Json): PreviewData {
  const out: PreviewData = { bindings: {}, collections: {} };
  if (!isObject(value)) return out;
  if (isObject(value.bindings)) Object.assign(out.bindings, value.bindings);
  if (isObject(value.collections)) {
    for (const [name, items] of Object.entries(value.collections)) {
      if (Array.isArray(items)) out.collections[name] = items.filter(isObject);
    }
  }
  return out;
}
