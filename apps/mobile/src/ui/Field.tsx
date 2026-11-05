import { TextInput, View, type TextInputProps } from "react-native";
import { INTER, radius, space, TARGET, type, useTheme } from "../theme/theme";
import { AppText } from "./AppText";

/** What the web app refused, said under its field (or the form) as an alert. */
export function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View role="alert">
      <AppText tone="danger">{message}</AppText>
    </View>
  );
}

/** A labelled text field, 44 pt high at least: its hint below the label, what the web app refused below the field. */
export function Field({ label, hint, error = null, ...input }: { label: string; hint?: string; error?: string | null } & Omit<TextInputProps, "style" | "aria-label">) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <AppText weight="semiBold">{label}</AppText>
      {hint ? (
        <AppText variant="meta" tone="secondary">
          {hint}
        </AppText>
      ) : null}
      <TextInput
        aria-label={label}
        aria-invalid={error !== null}
        placeholderTextColor={colors.meta}
        {...input}
        style={{
          minHeight: input.multiline ? TARGET * 2 : TARGET,
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.borderStrong,
          borderRadius: radius.control,
          fontFamily: INTER.regular,
          fontSize: type.fontSize.body,
          color: colors.text,
          textAlignVertical: input.multiline ? "top" : "center",
        }}
      />
      <FieldError message={error} />
    </View>
  );
}
