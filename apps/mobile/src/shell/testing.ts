import { screen, userEvent } from "@testing-library/react-native";
import { ActionSheetIOS } from "react-native";

/**
 * iOS's action sheet, which the compact Top Bar's « … » opens (#899), answered as a person would: `choose`, one of its
 * entries' words, or nothing (it stays open). Returns what each sheet offered, its « Annuler » last.
 */
export function answerActionSheet(choose?: string): string[][] {
  const offered: string[][] = [];
  jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation((options, callback) => {
    offered.push(options.options);
    if (choose !== undefined && options.options.includes(choose)) callback(options.options.indexOf(choose));
  });
  return offered;
}

/** Chooses `label` under the compact Top Bar's « … » (« Autres actions »), on iOS. */
export async function chooseFromMoreActions(label: string) {
  const offered = answerActionSheet(label);
  await userEvent.setup().press(screen.getByRole("button", { name: "Autres actions" }));
  expect(offered.at(-1)).toContain(label);
}
