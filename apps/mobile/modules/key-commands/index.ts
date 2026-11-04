import { requireOptionalNativeModule, type EventSubscription } from "expo";
import type { HardwareKeyboard, KeyCommandId, NativeKeyCommand } from "../../src/keyboard/key-commands";

type KeyCommandsModule = {
  setCommands: (commands: NativeKeyCommand[]) => void;
  addListener: (event: "onKeyCommand", listener: (event: { id: KeyCommandId }) => void) => EventSubscription;
};

/**
 * The app's local Expo module (ios/, android/): it registers the shortcuts with UIKit (`UIKeyCommand`, listed in the ⌘
 * panel under their title) and Android (the activity's key events, listed in the Keyboard Shortcuts Helper), and sends
 * back the id of the one pressed. Absent where the app runs without its native code (Expo Go, the tests): no shortcut.
 */
const module = requireOptionalNativeModule<KeyCommandsModule>("JobbboxKeyCommands");

export const nativeHardwareKeyboard: HardwareKeyboard = module
  ? {
      setCommands: (commands) => module.setCommands(commands),
      addListener: (listener) => module.addListener("onKeyCommand", ({ id }) => listener(id)),
    }
  : { setCommands: () => {}, addListener: () => ({ remove: () => {} }) };
