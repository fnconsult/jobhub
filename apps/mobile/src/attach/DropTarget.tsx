import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { NativeDropTarget, type NativeDropEvent } from "../../modules/drop-target";
import type { DroppedItem } from "./attachment";

/**
 * Where something can be dropped on a tablet (ADR-0076, #696): the conversation's box, on iPadOS and Android. `onDrop`
 * is handed what was dropped, first item first. Without the app's native code (Expo Go, the tests), a plain view whose
 * `onDropItems` is the native view's, for a test to drop on it.
 */
export function DropTarget({ onDrop, style, children }: { onDrop: (items: DroppedItem[]) => void; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const onDropItems = ({ nativeEvent }: NativeDropEvent) => onDrop(nativeEvent.items);
  if (NativeDropTarget)
    return (
      <NativeDropTarget style={style} onDropItems={onDropItems}>
        {children}
      </NativeDropTarget>
    );
  return (
    <View style={style} {...({ onDropItems } as object)}>
      {children}
    </View>
  );
}
