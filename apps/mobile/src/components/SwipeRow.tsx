import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, Platform, Pressable as RNPressable, StyleSheet, View } from "react-native";
import { Mail, MailOpen, Trash2 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useColors } from "@/src/lib/theme";

/** Width of the Delete button a left swipe uncovers. */
const REVEAL = 88;
/** How far a right swipe must go to toggle read. */
const READ_TRIGGER = 80;
/** How far a left swipe must go to delete: half the row, but never more than this. */
const DELETE_TRIGGER_MAX = 200;
/** Release speed (px/ms) that counts as a flick, completing the swipe the way it was going. */
const FLICK = 0.5;
const useNativeDriver = Platform.OS !== "web";

/** Where a left swipe deletes when let go: half the row, but never further than DELETE_TRIGGER_MAX. */
function deleteThreshold(width: number): number {
  return -Math.min(width / 2, DELETE_TRIGGER_MAX);
}

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
  /** The row's width as state too: the delete threshold's highlight depends on it. */
  const [rowWidth, setRowWidth] = useState(0);
  const rest = useRef(0); // 0, or -REVEAL while the Delete button is showing
  const [open, setOpen] = useState(false);
  const swipedAt = useRef(0);
  const justSwiped = useMemo(() => () => Date.now() - swipedAt.current < 400, []);

  const handlers = useRef({ onToggleRead, onDelete });
  handlers.current = { onToggleRead, onDelete };

  const responder = useMemo(() => {
    /** Where the row was when last let go, so a delete slides only the rest of the way. */
    const currentX = { current: 0 };
    /** Slides to `to`, carrying on at the speed the finger let go with (px/ms). */
    const settle = (to: number, velocity = 0) => {
      rest.current = to;
      setOpen(to !== 0);
      Animated.spring(x, { toValue: to, velocity, useNativeDriver, overshootClamping: true, stiffness: 400, damping: 40, mass: 1 }).start();
    };
    const remove = (velocity = 0) => {
      rest.current = -width.current;
      setOpen(false);
      // Faster flicks leave faster; never slower than a short slide.
      const remaining = Math.max(0, width.current - Math.abs(currentX.current));
      const duration = Math.min(200, Math.max(90, remaining / Math.max(Math.abs(velocity), 1.5)));
      Animated.timing(x, { toValue: -width.current, duration, easing: Easing.out(Easing.quad), useNativeDriver }).start(() => {
        void handlers.current.onDelete().then((deleted) => !deleted && settle(0));
      });
    };
    /** Where the row was let go (or the gesture taken away): finish the swipe it was making. */
    const finish = (dx: number, vx: number) => {
      swipedAt.current = Date.now();
      const pos = Math.max(-width.current, Math.min(rest.current + dx, width.current * 0.4));
      currentX.current = pos;
      const deleteAt = deleteThreshold(width.current);
      if (pos > READ_TRIGGER || (vx > FLICK && pos > READ_TRIGGER / 3 && rest.current === 0)) {
        settle(0, vx);
        handlers.current.onToggleRead();
      } else if (pos < deleteAt || (vx < -FLICK * 2 && pos < -REVEAL)) {
        remove(vx);
      } else if (vx < -FLICK / 2 && pos < 0) {
        settle(-REVEAL, vx); // a flick towards Delete shows it
      } else if (vx > FLICK / 2) {
        settle(0, vx); // a flick back closes it
      } else {
        settle(pos < -REVEAL / 2 ? -REVEAL : 0, vx);
      }
    };
    return {
      settle,
      remove: () => remove(),
      pan: PanResponder.create({
        // Only clearly horizontal drags; vertical ones keep scrolling the list.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderGrant: () => x.stopAnimation(),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          const pos = rest.current + g.dx;
          x.setValue(Math.max(-width.current, Math.min(pos, width.current * 0.4)));
        },
        onPanResponderRelease: (_e, g) => finish(g.dx, g.vx),
        // Taken away mid-swipe (the list or the browser claimed the touch): still finish what was meant.
        onPanResponderTerminate: (_e, g) => finish(g.dx, g.vx),
      }),
    };
  }, [x]);

  const ReadIcon = unread ? MailOpen : Mail;
  const colors = useColors();
  // Each color only shows while the row is dragged its way, never at rest.
  // While dragging: a neutral gray. Past the point where letting go acts, the action's color
  // (blue: read/unread, red: delete), so you see before releasing that it will happen.
  const dragged = x.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, 1], extrapolate: "clamp" });
  const readArmed = x.interpolate({ inputRange: [READ_TRIGGER, READ_TRIGGER + 1], outputRange: [0, 1], extrapolate: "clamp" });
  const deleteAt = deleteThreshold(rowWidth);
  const deleteArmed = x.interpolate({ inputRange: [deleteAt - 1, deleteAt], outputRange: [1, 0], extrapolate: "clamp" });
  const readSide = x.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });
  const deleteSide = x.interpolate({ inputRange: [-1, 0], outputRange: [1, 0], extrapolate: "clamp" });
  const neutral = colors.dark ? "#3f3f46" : "#a1a1aa";

  return (
    <View
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
        setRowWidth(e.nativeEvent.layout.width);
      }}
      className="overflow-hidden"
    >
      {/* Behind the row, all covering the whole row however far it slides: gray while dragging, then the
          action's color once letting go would act. The Delete button stays red (it can be tapped when shown). */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: dragged, backgroundColor: neutral }]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: readArmed, backgroundColor: "#2563eb" }]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: deleteArmed, backgroundColor: "#dc2626" }]} />
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: readSide, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20 }]}
        >
          <ReadIcon size={18} color="#ffffff" />
          <Text size="sm" className="font-medium text-white">
            {unread ? "Read" : "Unread"}
          </Text>
        </Animated.View>
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { opacity: deleteSide, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }]}
        >
          <RNPressable
            onPress={responder.remove}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            style={{ width: REVEAL, backgroundColor: "#dc2626" }}
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
        {/* No text selection while dragging with the mouse; the browser only scrolls vertically, leaving sideways drags to the row. */}
        <View className="web:select-none web:touch-pan-y">
          <SwipeGuard.Provider value={justSwiped}>{children}</SwipeGuard.Provider>
        </View>
        {/* While Delete is showing, a tap on the row closes it instead of opening the message. */}
        {open ? <RNPressable style={StyleSheet.absoluteFill} onPress={() => responder.settle(0)} accessibilityLabel="Close" /> : null}
      </Animated.View>
    </View>
  );
}
