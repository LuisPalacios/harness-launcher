// Validates a typed shortcut and writes it into keybindings.json text, keeping
// the user's comments and formatting.
import { applyEdits, modify, parseTree, type FormattingOptions, type Node, type ParseError } from "jsonc-parser";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

// Modifier order as VS Code writes it in keybindings.json.
const MODIFIERS = ["ctrl", "shift", "alt", "meta", "cmd", "win"] as const;
const NAMED_KEYS = new Set([
  ..."`-=[]\\;',./",
  "left",
  "up",
  "right",
  "down",
  "pageup",
  "pagedown",
  "end",
  "home",
  "tab",
  "enter",
  "escape",
  "space",
  "backspace",
  "delete",
  "insert",
  "pausebreak",
  "capslock",
  "numpad_multiply",
  "numpad_add",
  "numpad_separator",
  "numpad_subtract",
  "numpad_decimal",
  "numpad_divide",
]);

function isKey(key: string): boolean {
  return /^([a-z0-9]|f([1-9]|1[0-9])|numpad[0-9])$/.test(key) || NAMED_KEYS.has(key);
}

function normalizeChord(chord: string, needsModifier: boolean): Result<string> {
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  if (!isKey(key)) {
    return { ok: false, error: `"${key}" is not a key VS Code knows, in "${chord}"` };
  }
  const unknown = parts.find((m) => !(MODIFIERS as readonly string[]).includes(m));
  if (unknown !== undefined) {
    return { ok: false, error: `"${unknown}" is not a modifier; use ${MODIFIERS.join(", ")}` };
  }
  if (new Set(parts).size !== parts.length) {
    return { ok: false, error: `"${chord}" repeats a modifier` };
  }
  if (needsModifier && parts.length === 0 && !/^f([1-9]|1[0-9])$/.test(key)) {
    return { ok: false, error: `"${chord}" needs a modifier such as ctrl, shift or alt, or it would take over typing` };
  }
  return { ok: true, value: [...MODIFIERS.filter((m) => parts.includes(m)), key].join("+") };
}

/** A typed shortcut such as `Shift+Alt+L` or `ctrl+k ctrl+l`, in keybindings.json form. */
export function normalizeShortcut(input: string): Result<string> {
  const chords = input.trim().toLowerCase().split(/\s+/);
  if (chords[0] === "") {
    return { ok: false, error: "type a shortcut, for example shift+alt+l" };
  }
  if (chords.length > 2) {
    return { ok: false, error: "a shortcut has at most two chords, for example ctrl+k ctrl+l" };
  }
  const normalized: string[] = [];
  for (const [i, chord] of chords.entries()) {
    const result = normalizeChord(chord, i === 0);
    if (!result.ok) {
      return result;
    }
    normalized.push(result.value);
  }
  return { ok: true, value: normalized.join(" ") };
}

function commandOf(entry: Node): unknown {
  return entry.children?.find((p) => p.children?.[0]?.value === "command")?.children?.[1]?.value;
}

/**
 * keybindings.json text where `command` is bound to `key` only: earlier entries
 * for the command are replaced, removals (`-command`) and everything else stay.
 */
export function withShortcut(text: string, command: string, key: string, formatting: FormattingOptions): Result<string> {
  let next = text.trim() === "" ? "[]" : text;
  const errors: ParseError[] = [];
  const root = parseTree(next, errors, { allowTrailingComma: true });
  if (errors.length > 0 || root?.type !== "array") {
    return { ok: false, error: "keybindings.json is not a valid list of key bindings; fix it first" };
  }
  const stale = (root.children ?? []).flatMap((entry, i) => (entry.type === "object" && commandOf(entry) === command ? [i] : []));
  for (const i of stale.toReversed()) {
    next = applyEdits(next, modify(next, [i], undefined, { formattingOptions: formatting }));
  }
  next = applyEdits(next, modify(next, [-1], { key, command }, { formattingOptions: formatting, isArrayInsertion: true }));
  return { ok: true, value: next };
}
