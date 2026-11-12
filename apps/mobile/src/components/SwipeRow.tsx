import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Platform, Pressable as RNPressable, StyleSheet, View } from "react-native";
import { Mail, MailOpen, Trash2 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useColors } from "@/src/lib/theme";

/** Width of the Delete button a left swipe uncovers. */
const REVEAL = 88;
/** How far a right swipe must go to toggle read. */
const READ_TRIGGER = 80;
const useNativeDriver = Platform.OS !== "web";

const SwipeGuard = createContext<() => boolean>(() => false);

/**
 * True right after a swipe ended. A mouse drag on web ends in a click, so rows
 * check this before opening a message.
 */
export function useJustSwiped(): () => boolean {
  return useContext(SwipeGuard);
}

/**
 * A list row that can be swiped (touch, or mouse drag on web/desktop):
 * - left: uncovers Delete; swiping past half the row deletes right away
 * - right: marks read (or unread)
 */
export function SwipeRow({
  children,
  unread,
  onToggleRead,
  onDelete,
}: {
  children: ReactNode;
  /** The row's state, to label the right swipe "Read" or "Unread". */
  unread: boolean;
  onToggleRead: () => void;
  /** Resolves false when nothing was deleted (cancelled or failed); the row then slides back. */
  onDelete: () => Promise<boolean>;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  const rest = useRef(0); // 0, or -REVEAL while the Delete button is showing
  const [open, setOpen] = useState(false);
  const swipedAt = useRef(0);
  const justSwiped = useMemo(() => () => Date.now() - swipedAt.current < 400, []);

  const handlers = useRef({ onToggleRead, onDelete });
  handlers.current = { onToggleRead, onDelete };

  const responder = useMemo(() => {
    const settle = (to: number) => {
      rest.current = to;
      setOpen(to !== 0);
      Animated.spring(x, { toValue: to, useNativeDriver, bounciness: 0, speed: 20 }).start();
    };
    const remove = () => {
      Animated.timing(x, { toValue: -width.current, duration: 160, useNativeDriver }).start(() => {
        void handlers.current.onDelete().then((deleted) => !deleted && settle(0));
      });
    };
    return {
      settle,
      remove,
      pan: PanResponder.create({
        // Only clearly horizontal drags; vertical ones keep scrolling the list.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          const pos = rest.current + g.dx;
          x.setValue(Math.max(-width.current, Math.min(pos, width.current * 0.4)));
        },
        onPanResponderRelease: (_e, g) => {
          swipedAt.current = Date.now();
          const pos = rest.current + g.dx;
          if (pos > READ_TRIGGER) {
            settle(0);
            handlers.current.onToggleRead();
          } else if (pos < -width.current / 2) {
            remove();
          } else if (pos < -REVEAL / 2) {
            settle(-REVEAL);
          } else {
            settle(0);
          }
        },
        onPanResponderTerminate: () => settle(rest.current),
      }),
    };
  }, [x]);

  const ReadIcon = unread ? MailOpen : Mail;
  const colors = useColors();
  // Each color only shows while the row is dragged its way, never at rest.
  const readOpacity = x.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });
  const deleteOpacity = x.interpolate({ inputRange: [-1, 0], outputRange: [1, 0], extrapolate: "clamp" });

  return (
    <View onLayout={(e) => (width.current = e.nativeEvent.layout.width)} className="overflow-hidden">
      {/* Behind the row: Read on the left (shown by a right swipe), Delete on the right. */}
      <View style={StyleSheet.absoluteFill} className="flex-row">
        <Animated.View style={{ flex: 1, opacity: readOpacity, backgroundColor: "#2563eb", flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20 }}>
          <ReadIcon size={18} color="#ffffff" />
          <Text size="sm" className="font-medium text-white">
            {unread ? "Read" : "Unread"}
          </Text>
        </Animated.View>
        <Animated.View style={{ flex: 1, opacity: deleteOpacity, backgroundColor: "#dc2626", flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
          <RNPressable
            onPress={responder.remove}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            style={{ width: REVEAL }}
            className="h-full items-center justify-center gap-1"
          >
            <Trash2 size={18} color="#ffffff" />
            <Text size="xs" className="font-medium text-white">
              Delete
            </Text>
          </RNPressable>
        </Animated.View>
      </View>

      {/* Animated.View takes no className (NativeWind), so its background is a plain style: an opaque row hides the colors. */}
      <Animated.View
        style={{ transform: [{ translateX: x }], backgroundColor: colors.background }}
        {...responder.pan.panHandlers}
      >
        {/* No text selection while dragging with the mouse. */}
        <View className="web:select-none">
          <SwipeGuard.Provider value={justSwiped}>{children}</SwipeGuard.Provider>
        </View>
        {/* While Delete is showing, a tap on the row closes it instead of opening the message. */}
        {open ? <RNPressable style={StyleSheet.absoluteFill} onPress={() => responder.settle(0)} accessibilityLabel="Close" /> : null}
      </Animated.View>
    </View>
  );
}
