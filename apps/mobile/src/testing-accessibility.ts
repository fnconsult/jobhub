// What VoiceOver and TalkBack would miss on the screen a test rendered, and the text a large system text size would
// cut (#705, ADR-0009): the automatic part of the app's accessibility checks, run on each key screen.
import { screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

/** The roles of what a person acts on, each announced by its name. */
const CONTROL_ROLES = ["button", "link", "switch", "checkbox", "radio", "menuitem", "tab", "togglebutton", "combobox", "adjustable", "slider", "searchbox"] as const;

/** Whether assistive technology skips `instance`: it, or a parent, hidden from it (a page behind a drawer, say). */
function hidden(instance: TestInstance | null): boolean {
  for (let each = instance; each; each = each.parent) {
    const { props } = each;
    if (props["aria-hidden"] === true || props.accessibilityElementsHidden === true || props.importantForAccessibility === "no-hide-descendants") return true;
  }
  return false;
}

const textOf = (instance: TestInstance): string => instance.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
const where = (instance: TestInstance) => `${instance.type} « ${textOf(instance).slice(0, 60) || "(vide)"} »`;
const shownHost = (predicate: (instance: TestInstance) => boolean) => screen.container.queryAll((instance) => predicate(instance) && !hidden(instance));

/**
 * The controls a screen reader would announce with no name: a button, link, switch… with neither text nor label, a text
 * field with no label, and anything pressable with no role (announced without saying it can be pressed).
 */
export function unnamedControls(): string[] {
  const unnamed = CONTROL_ROLES.flatMap((role) => {
    const named = new Set(screen.queryAllByRole(role, { name: /\S/ }));
    return screen
      .queryAllByRole(role)
      .filter((control) => !named.has(control))
      .map((control) => `${role} sans nom : ${where(control)}`);
  });
  const fields = shownHost((instance) => instance.type === "TextInput" && !instance.props["aria-label"] && !instance.props.accessibilityLabel).map(
    (field) => `champ sans libellé : ${where(field)}`,
  );
  const pressables = shownHost(
    (instance) => typeof instance.props.onClick === "function" && instance.props.accessible !== false && !instance.props.role && !instance.props.accessibilityRole,
  ).map((pressable) => `élément pressable sans rôle : ${where(pressable)}`);
  return [...unnamed, ...fields, ...pressables];
}

/** The texts cut to a number of lines (an ellipsis after them), which at a large text size lose their end. */
export function cutTexts(): string[] {
  return shownHost((instance) => instance.type === "Text" && Number(instance.props.numberOfLines) > 0).map((text) => `${textOf(text)} (${text.props.numberOfLines} ligne(s))`);
}
