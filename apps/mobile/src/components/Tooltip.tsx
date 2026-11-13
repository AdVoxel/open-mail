import type { ReactNode } from "react";
import { View } from "react-native";

/** Phones have no hover: the icon is shown as is, labelled for screen readers. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <View accessibilityLabel={label}>{children}</View>;
}
