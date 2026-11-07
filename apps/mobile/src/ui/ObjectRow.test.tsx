import { fireEvent, screen, userEvent } from "@testing-library/react-native";
import { colorsFor } from "../theme/colors";
import { hardwareKeyboard, renderInApp, setWindow } from "../testing";
import { Control } from "./Control";
import { ROW_MAX_SCALE } from "./AppText";
import { ObjectRow } from "./ObjectRow";

const { hover } = colorsFor("light");

const open = jest.fn();
const share = jest.fn();

async function renderRow() {
  await renderInApp(
    <ObjectRow
      label="Aéroline · Responsable qualité"
      onPress={open}
      actions={[
        { label: "Ouvrir", onPress: open },
        { label: "Partager le lien", onPress: share },
      ]}
    />,
  );
}

const row = () => screen.getByRole("link", { name: "Aéroline · Responsable qualité" });
/** The context menu, by its first item. */
const menu = () => screen.queryByRole("menuitem", { name: "Ouvrir" });
const item = (name: string) => screen.getByRole("menuitem", { name });
/** A click of the pointer's secondary button (a right click, two fingers on a trackpad) at `x`, `y`. */
const rightClick = (x = 120, y = 80) => fireEvent(row(), "pointerDown", { nativeEvent: { button: 2, pageX: x, pageY: y } });

beforeEach(() => {
  setWindow({ width: 1366, height: 1024 });
  open.mockClear();
  share.mockClear();
});

describe("ObjectRow, a row of an Application, a Job Offer or a Free conversation", () => {
  it("opens what it names when pressed", async () => {
    await renderRow();
    await userEvent.setup().press(row());
    expect(open).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("opens its context menu on a long press, with the row's actions", async () => {
    await renderRow();
    await userEvent.setup().longPress(row());
    expect(menu()).toBeOnTheScreen();
    expect(item("Ouvrir")).toBeOnTheScreen();
    expect(item("Partager le lien")).toBeOnTheScreen();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens it on a right click, and not on the primary button", async () => {
    await renderRow();
    await fireEvent(row(), "pointerDown", { nativeEvent: { button: 0, pageX: 10, pageY: 10 } });
    expect(menu()).toBeNull();
    await rightClick();
    expect(menu()).toBeOnTheScreen();
  });

  it("carries out the action chosen, and closes", async () => {
    await renderRow();
    await rightClick();
    await userEvent.setup().press(item("Partager le lien"));
    expect(share).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("closes with Échap, which the ⌘ panel then lists", async () => {
    await renderRow();
    await rightClick();
    expect(hardwareKeyboard.panel()).toContain("Échap Fermer le volet");
    await hardwareKeyboard.press("Échap");
    expect(menu()).toBeNull();
  });

  it("closes with « Fermer » too, for VoiceOver and TalkBack", async () => {
    await renderRow();
    await userEvent.setup().longPress(row());
    await userEvent.setup().press(screen.getByRole("button", { name: "Fermer" }));
    expect(menu()).toBeNull();
  });

  it("offers its actions in the accessibility actions, without the menu", async () => {
    await renderRow();
    expect(row().props.accessibilityActions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Partager le lien" })]));
    const { name } = row().props.accessibilityActions.find((action: { label: string }) => action.label === "Partager le lien");
    await fireEvent(row(), "accessibilityAction", { nativeEvent: { actionName: name } });
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("is highlighted while the pointer is over it", async () => {
    await renderRow();
    await fireEvent(row(), "pointerEnter");
    expect(row()).toHaveStyle({ backgroundColor: hover });
    await fireEvent(row(), "pointerLeave");
    expect(row()).not.toHaveStyle({ backgroundColor: hover });
  });
});

describe("Control, under the pointer", () => {
  it("is highlighted while the pointer is over it", async () => {
    await renderInApp(<Control label="Fiche" onPress={() => {}} />);
    const control = screen.getByRole("button", { name: "Fiche" });
    expect(control).not.toHaveStyle({ backgroundColor: hover });
    await fireEvent(control, "pointerEnter");
    expect(control).toHaveStyle({ backgroundColor: hover });
    await fireEvent(control, "pointerLeave");
    expect(control).not.toHaveStyle({ backgroundColor: hover });
  });
});

// At iOS's largest text size on an iPhone SE, a row's words grew freely and broke mid-word in a 261 pt column
// (« Aéroli / ne »), the row taller than the screen (#705, Maestro). The product owner's choice: a row's text grows up
// to twice its size, as titles and bars do.
describe("ObjectRow, at a large system text size", () => {
  it("lets its words grow up to twice their size", async () => {
    setWindow({ width: 375, height: 667, fontScale: 3.571 });
    await renderRow();
    expect(screen.getByText("Aéroline · Responsable qualité").props.maxFontSizeMultiplier).toBe(ROW_MAX_SCALE);
    expect(ROW_MAX_SCALE).toBe(2);
  });
});
