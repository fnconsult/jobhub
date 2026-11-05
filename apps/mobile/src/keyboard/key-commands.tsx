import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { nativeHardwareKeyboard } from "../../modules/key-commands";

/**
 * The hardware keyboard's shortcuts on a tablet (ADR-0076, #700): ⌘N new conversation, ⌘↩ send, ⌘\ the Sidebar, ⌘I the
 * Fiche (or Activité), ⌘W closes the Work Pane, Échap closes a pane; Ctrl in place of ⌘ on Android.
 *
 * A screen offers a shortcut with `useKeyCommand(id, run)` while it can carry it out, and withdraws it with `null`.
 * Only the shortcuts on offer are registered with the system, under their French or English title, so iPadOS's ⌘ panel
 * and Android's Keyboard Shortcuts Helper list what the page can do now. Two screens offering the same shortcut (a
 * menu over the shell, a pushed screen over the one beneath it): the last one to offer it has it, the one before gets it
 * back when it withdraws.
 */

export type KeyCommandId = "newConversation" | "send" | "sidebar" | "fiche" | "activite" | "closeWorkPane" | "closePane";

/** What the native module registers: UIKit's `UIKeyCommand`, Android's `KeyboardShortcutInfo`. */
export type NativeKeyCommand = {
  id: KeyCommandId;
  input: "n" | "Enter" | "\\" | "i" | "w" | "Escape";
  /** ⌘ on iPadOS, Ctrl on Android; none for Échap. */
  modifier: "command" | "control" | null;
  title: string;
};

/** The seam to the platform: modules/key-commands on a device, `fakeHardwareKeyboard` in the tests. */
export type HardwareKeyboard = {
  /** Replaces the shortcuts registered with the system, in the order the panel lists them. */
  setCommands: (commands: NativeKeyCommand[]) => void;
  /** Called with a shortcut's id when the person presses it. */
  addListener: (listener: (id: KeyCommandId) => void) => { remove: () => void };
};

/** The shortcuts, in the order the panel lists them. */
const COMMANDS: readonly { id: KeyCommandId; input: NativeKeyCommand["input"]; modified: boolean }[] = [
  { id: "newConversation", input: "n", modified: true },
  { id: "send", input: "Enter", modified: true },
  { id: "sidebar", input: "\\", modified: true },
  { id: "fiche", input: "i", modified: true },
  { id: "activite", input: "i", modified: true },
  { id: "closeWorkPane", input: "w", modified: true },
  { id: "closePane", input: "Escape", modified: false },
];

type Registry = { offer: (id: KeyCommandId, run: () => void) => () => void };

const RegistryContext = createContext<Registry>({ offer: () => () => {} });

/** Holds the shortcuts the screens offer, registers them with `keyboard`, and runs the one pressed. */
export function KeyCommandsProvider({ keyboard = nativeHardwareKeyboard, children }: { keyboard?: HardwareKeyboard; children: ReactNode }) {
  const { t } = useTranslation();
  // Each shortcut's offers, the latest last; `offered` changes whenever a shortcut comes or goes, to register them again.
  const offers = useRef(new Map<KeyCommandId, (() => void)[]>());
  const [offered, setOffered] = useState<ReadonlySet<KeyCommandId>>(new Set());

  const registry = useMemo<Registry>(
    () => ({
      offer: (id, run) => {
        const runs = [...(offers.current.get(id) ?? []), run];
        offers.current.set(id, runs);
        setOffered(new Set(offers.current.keys()));
        return () => {
          const left = (offers.current.get(id) ?? []).filter((candidate) => candidate !== run);
          if (left.length) offers.current.set(id, left);
          else offers.current.delete(id);
          setOffered(new Set(offers.current.keys()));
        };
      },
    }),
    [],
  );

  const modifier = Platform.OS === "ios" ? "command" : "control";
  useEffect(() => {
    keyboard.setCommands(
      COMMANDS.filter((command) => offered.has(command.id)).map((command) => ({
        id: command.id,
        input: command.input,
        modifier: command.modified ? modifier : null,
        title: t(`mobile.shortcuts.${command.id}`),
      })),
    );
  }, [keyboard, offered, modifier, t]);

  useEffect(() => {
    const subscription = keyboard.addListener((id) => offers.current.get(id)?.at(-1)?.());
    return () => subscription.remove();
  }, [keyboard]);

  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/** Offers shortcut `id` while `run` is given, `null` withdrawing it; `run` is the latest one passed. */
export function useKeyCommand(id: KeyCommandId, run: (() => void) | null) {
  const registry = useContext(RegistryContext);
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const offered = run !== null;
  useEffect(() => (offered ? registry.offer(id, () => latest.current?.()) : undefined), [registry, id, offered]);
}
