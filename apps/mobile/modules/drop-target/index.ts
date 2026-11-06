import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";
import type { DroppedItem } from "../../src/attach/attachment";

/** The native view's drop, as it sends it: what was dropped, first item first. */
export type NativeDropEvent = { nativeEvent: { items: DroppedItem[] } };

export type NativeDropTargetProps = ViewProps & { onDropItems: (event: NativeDropEvent) => void };

/**
 * The app's local Expo module (ios/, android/): a view that takes what another app drops on it on a tablet (#696):
 * iPadOS's drag and drop (`UIDropInteraction`) and Android's (the view's drag events, with the activity's drag-and-drop
 * permissions for another app's content). It is one drop target with what it holds: a drop on its text field is its
 * own, not the field's (which would insert it into the draft). A PDF or Word file is copied to the app's cache and sent
 * as its file (`uri`, `name`, `size`, `mimeType`), a link or text as its text. Absent where the app runs without its
 * native code (Expo Go, the tests): null, and the box takes nothing dropped.
 */
export const NativeDropTarget: ComponentType<NativeDropTargetProps> | null = requireOptionalNativeModule("JobbboxDropTarget")
  ? requireNativeView<NativeDropTargetProps>("JobbboxDropTarget")
  : null;
