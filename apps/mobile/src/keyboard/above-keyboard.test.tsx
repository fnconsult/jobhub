import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { DeviceEventEmitter, Platform, Text } from "react-native";
import { AboveKeyboard } from "./above-keyboard";

// What the test renderer's Views answer when asked where they sit in the window.
const nativeMethods = jest.requireActual("@react-native/jest-preset/jest/MockNativeMethods").default as { measureInWindow: jest.Mock };

const SE = { width: 375, height: 667 };
/** Under the Top Bar: where the signed-in pages sit, 100 pt from the window's top, to its bottom. */
const PAGE = { top: 100, height: SE.height - 100 };
/** The iPhone SE's keyboard: its top 216 pt above the bottom of the screen. */
const KEYBOARD = { duration: 0, easing: "keyboard", endCoordinates: { screenX: 0, screenY: SE.height - 216, width: SE.width, height: 216 }, isEventFromThisApp: true };

const roomUnder = () => (screen.getByTestId("page").props.style as { paddingBottom?: number }[]).flat().reduce((room, style) => style?.paddingBottom ?? room, 0);

// The signed-in pages sit under the Top Bar, not at the window's top; React Native's KeyboardAvoidingView reckons from its
// own frame, relative to what holds it, so it left the keyboard 100 pt of the page: on an iPhone SE the conversation's
// box went half under the keyboard, its « Envoyer » out of reach (#705, Maestro). The room is reckoned in the window.
describe.each(["ios", "android"] as const)("AboveKeyboard on %s, below the Top Bar (#705)", (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", os);
    nativeMethods.measureInWindow.mockImplementation((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, PAGE.top, SE.width, PAGE.height));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    nativeMethods.measureInWindow.mockReset();
  });

  it("leaves the keyboard all it covers of the page", async () => {
    await render(
      <AboveKeyboard testID="page">
        <Text>Envoyer</Text>
      </AboveKeyboard>,
    );
    const layout = { persist: () => {}, nativeEvent: { layout: { x: 0, y: 0, width: SE.width, height: PAGE.height } } };
    await fireEvent(screen.getByTestId("page"), "layout", layout);
    expect(roomUnder()).toBe(0);
    await act(async () => DeviceEventEmitter.emit(os === "ios" ? "keyboardWillShow" : "keyboardDidShow", KEYBOARD));
    expect(roomUnder()).toBe(216);
  });
});
