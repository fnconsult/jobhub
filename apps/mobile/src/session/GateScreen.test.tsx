import { act, fireEvent, screen } from "@testing-library/react-native";
import { DeviceEventEmitter, Platform, Text } from "react-native";
import { renderInApp, setWindow } from "../testing";
import { GateField, GateScreen } from "./GateScreen";

const SE = { width: 375, height: 667 };
/** The iPhone SE's keyboard, as iOS announces it: its top 216 pt above the bottom of the screen. */
const KEYBOARD = { duration: 0, easing: "keyboard", endCoordinates: { screenX: 0, screenY: SE.height - 216, width: SE.width, height: 216 }, isEventFromThisApp: true };

async function renderGate() {
  await renderInApp(
    <GateScreen title="Se connecter à Jobbbox">
      <GateField label="Votre adresse e-mail" />
      <Text>Recevoir mon lien de connexion</Text>
    </GateScreen>,
  );
  // The screen as the device lays it out: the whole window.
  await fireEvent(screen.getByTestId("gate-screen"), "layout", { persist: () => {}, nativeEvent: { layout: { x: 0, y: 0, ...SE } } });
}

/** The room the screen leaves under its content: what the keyboard covers. */
const roomUnder = () => (screen.getByTestId("gate-screen").props.style as { paddingBottom?: number }[]).flat().reduce((room, style) => style?.paddingBottom ?? room, 0);

// The sign-in screen sits before the shell, outside what keeps the signed-in app above the keyboard: on an iPhone SE the
// email field, « Recevoir mon lien de connexion » and the code field went under the keyboard, out of sight and out of
// reach (#705, the iPhone SE's Maestro run).
describe("GateScreen, the keyboard up (#705)", () => {
  beforeEach(() => setWindow(SE));
  afterEach(() => jest.restoreAllMocks());

  it("lays its content out again above the keyboard on iOS", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await renderGate();
    expect(roomUnder()).toBe(0);
    await act(async () => DeviceEventEmitter.emit("keyboardWillShow", KEYBOARD));
    expect(roomUnder()).toBe(216);
    await act(async () => DeviceEventEmitter.emit("keyboardWillHide", { ...KEYBOARD, endCoordinates: { ...KEYBOARD.endCoordinates, screenY: SE.height } }));
    expect(roomUnder()).toBe(0);
  });

  // Android 15 draws the app edge to edge, under the keyboard, which no longer resizes the window: on the Android tablet
  // the conversation's box and its « Envoyer » stayed under the keyboard while a message was typed (#705, Maestro).
  it("lays its content out again above the keyboard on Android, which draws the app edge to edge", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await renderGate();
    expect(roomUnder()).toBe(0);
    await act(async () => DeviceEventEmitter.emit("keyboardDidShow", KEYBOARD));
    expect(roomUnder()).toBe(216);
    await act(async () => DeviceEventEmitter.emit("keyboardDidHide", { ...KEYBOARD, endCoordinates: { ...KEYBOARD.endCoordinates, screenY: SE.height } }));
    expect(roomUnder()).toBe(0);
  });
});

// iOS's number keyboard has no key that closes it: on an iPad in portrait at the largest text size it stayed over « Me
// connecter avec ce code », and the tap meant for the button landed on the keyboard (#705, Maestro).
describe("GateScreen, closing the keyboard (#705)", () => {
  it("closes the keyboard on a drag", async () => {
    setWindow(SE);
    await renderGate();
    expect(screen.getByTestId("gate-scroll")).toHaveProp("keyboardDismissMode", "on-drag");
  });
});
