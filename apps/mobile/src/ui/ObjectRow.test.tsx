import { fireEvent, screen, userEvent } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { colorsFor } from "../theme/colors";
import { hardwareKeyboard, renderInApp, setWindow } from "../testing";
import { Control } from "./Control";
import { ROW_MAX_SCALE } from "./AppText";
import { ObjectRow } from "./ObjectRow";

const { hover, accent, onAccent } = colorsFor("light");

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

/** A Sidebar's menu row with a count (Recherches d'offres' offers à traiter, #818). */
async function renderCounted(value: number) {
  await renderInApp(<ObjectRow label="Recherches d'offres" onPress={open} actions={[]} count={{ value, label: `${value} offres à traiter` }} />);
}
const styleOf = (element: { props: { style?: unknown } }) => StyleSheet.flatten(element.props.style as never) as Record<string, unknown>;

// Option B of the prototype (#939): the count of #865 at the body size pushed « Recherches d'offres » onto two lines in
// the tablets' 256 pt column; a compact badge, as the web Sidebar's, leaves the label its line.
describe("ObjectRow's count, a compact badge (#939)", () => {
  it("draws its digits at the meta size, semi-bold and tabular, on the accent", async () => {
    await renderCounted(9);
    const digits = screen.getByText("9");
    expect(styleOf(digits)).toMatchObject({ fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"], color: onAccent });
    expect(digits.props.maxFontSizeMultiplier).toBe(ROW_MAX_SCALE);
    expect(styleOf(digits.parent!)).toMatchObject({ minHeight: 18, minWidth: 18, paddingHorizontal: 5, backgroundColor: accent });
  });

  it("stands 4 pt from the label: the counted row's gap of 8, pulled in by 4", async () => {
    await renderCounted(9);
    expect(styleOf(screen.getByText("9").parent!)).toMatchObject({ marginLeft: -4 });
  });

  it.each([1, 9])("keeps the current label semi-bold and recovers 8 pt at N=%i", async (value) => {
    await renderInApp(<ObjectRow current label="Recherches d'offres" onPress={open} actions={[]} count={{ value, label: `${value} offres à traiter` }} />);
    const link = screen.getByRole("link", { name: `Recherches d'offres, ${value} offres à traiter` });
    expect(link).toHaveStyle({ gap: 8, paddingRight: 8, paddingHorizontal: 12 });
    expect(styleOf(screen.getByText("Recherches d'offres"))).toMatchObject({ fontFamily: "Inter_600SemiBold" });
  });

  it("shows « 99+ » over 99, the exact number said to VoiceOver and TalkBack", async () => {
    await renderCounted(128);
    expect(screen.getByText("99+")).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: "Recherches d'offres, 128 offres à traiter" })).toBeOnTheScreen();
  });

  it("keeps the label on two lines at most, as a fallback", async () => {
    await renderCounted(100);
    expect(screen.getByText("Recherches d'offres").props.numberOfLines).toBe(2);
  });

  it("shows nothing at zero", async () => {
    await renderCounted(0);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("link", { name: "Recherches d'offres" })).toBeOnTheScreen();
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
