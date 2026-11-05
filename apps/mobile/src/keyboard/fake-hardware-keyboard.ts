import type { HardwareKeyboard, KeyCommandId, NativeKeyCommand } from "./key-commands";

/** How a chord reads, as iPadOS's ⌘ panel and Android's Keyboard Shortcuts Helper print it. */
const KEY_NAMES: Record<NativeKeyCommand["input"], string> = { n: "N", Enter: "↩", "\\": "\\", i: "I", w: "W", Escape: "Échap" };
const MODIFIERS: Record<NonNullable<NativeKeyCommand["modifier"]>, string> = { command: "⌘", control: "Ctrl+" };

export const chordOf = (command: Pick<NativeKeyCommand, "input" | "modifier">) => `${command.modifier ? MODIFIERS[command.modifier] : ""}${KEY_NAMES[command.input]}`;

/**
 * A hardware keyboard for the tests, at the seam the native module fills on a device (modules/key-commands): it holds
 * the commands the app registered, matches a chord against them as UIKit and Android do, and fires the one it matches.
 */
export function fakeHardwareKeyboard() {
  let commands: NativeKeyCommand[] = [];
  const listeners = new Set<(id: KeyCommandId) => void>();
  const keyboard: HardwareKeyboard = {
    setCommands: (next) => void (commands = next),
    addListener: (listener) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
  };
  return {
    keyboard,
    /** The ⌘ panel (Ctrl on Android): each command the app offers now, « ⌘N Nouvelle conversation ». */
    panel: () => commands.map((command) => `${chordOf(command)} ${command.title}`),
    /** Presses `chord` (« ⌘N », « Ctrl+N », « Échap »); a chord the app does not offer now does nothing. */
    press: (chord: string) => {
      const command = commands.find((candidate) => chordOf(candidate) === chord);
      if (command) for (const listener of listeners) listener(command.id);
    },
  };
}
