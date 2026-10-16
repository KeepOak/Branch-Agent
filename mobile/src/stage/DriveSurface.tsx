// The surface you drive the computer through while you have it (Take over). Copied from
// window/src/stage/DriveSurface.tsx and wired to React Native touches instead of DOM pointer events.
// Geometry lives in remote-map.ts, gestures in touch-gestures.ts; this file only wires them to the view.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { contentRect, IDENTITY_VIEW, panBy, toRemote, zoomAt, type Point, type Rect, type Size, type View as ZoomView } from "./remote-map";
import { GestureMachine, LONG_PRESS_MS, type GestureOut } from "./touch-gestures";
import { keyPress } from "./drive-keys";
import { useTouchMode } from "./touch-mode";
import type { RemoteAction } from "./remote-action";
import { bw } from "./bw";

export type { RemoteAction };

type Props = {
  active: boolean;
  frame: Size | null;
  remote: Size | null;
  send: (action: RemoteAction) => void;
  typingLabel: string;
  children: ReactNode;
};

const now = () => Date.now();

type TouchPoint = { identifier: number; pageX: number; pageY: number };

function touchesOf(event: GestureResponderEvent): TouchPoint[] {
  const native = event.nativeEvent as GestureResponderEvent["nativeEvent"] & {
    changedTouches?: Array<{ identifier: number; pageX: number; pageY: number }>;
  };
  const changed = native.changedTouches;
  if (changed && changed.length) return [...changed];
  return [{ identifier: Number(native.identifier ?? 1), pageX: native.pageX, pageY: native.pageY }];
}

export function DriveSurface({ active, frame, remote, send, typingLabel, children }: Props) {
  const mode = useTouchMode();
  const surface = useRef<View>(null);
  const field = useRef<TextInput>(null);
  const [box, setBox] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });
  const [view, setView] = useState<ZoomView>(IDENTITY_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [cursor, setCursor] = useState<Point | null>(null);
  const machine = useRef<GestureMachine | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ active, send, frame, remote, box });
  live.current = { active, send, frame, remote, box };

  const bounds = useCallback((): { box: Rect; content: Rect } | null => {
    const f = live.current.frame, b = live.current.box;
    if (!f || b.width <= 0 || b.height <= 0) return null;
    const content = contentRect(b, f, viewRef.current);
    return content ? { box: b, content } : null;
  }, []);

  const gestures = useCallback((): GestureMachine | null => {
    const b = bounds();
    if (!b) return null;
    if (!machine.current) machine.current = new GestureMachine({ mode, bounds: b.content });
    else machine.current.setBounds(b.content);
    if (machine.current.mode !== mode) machine.current.setMode(mode);
    return machine.current;
  }, [bounds, mode]);

  useEffect(() => {
    machine.current = null;
    clearTimeout(timer.current);
    setCursor(null);
    if (!active) setView(IDENTITY_VIEW);
  }, [active, mode]);

  const remotePoint = useCallback((p: Point, clamp = false): Point | null => {
    const { frame: f, remote: r, box: b } = live.current;
    if (!f || !r || b.width <= 0) return null;
    return toRemote(p, b, f, r, viewRef.current, clamp);
  }, []);

  const apply = useCallback(
    (outs: GestureOut[]) => {
      const { send: out, box: b } = live.current;
      for (const g of outs) {
        if (g.kind === "zoom" || g.kind === "pan") {
          if (b.width <= 0) continue;
          const next = g.kind === "zoom" ? zoomAt(viewRef.current, g.factor, { x: g.x, y: g.y }, b) : panBy(viewRef.current, g.dx, g.dy, b);
          viewRef.current = next;
          setView(next);
          continue;
        }
        if (g.kind === "cursor") {
          setCursor({ x: g.x - b.left, y: g.y - b.top });
          continue;
        }
        if (g.kind === "drag") {
          const from = remotePoint({ x: g.fromX, y: g.fromY });
          const to = remotePoint({ x: g.x, y: g.y }, true);
          if (from && to) out({ kind: "drag", fromX: from.x, fromY: from.y, x: to.x, y: to.y });
          continue;
        }
        const at = remotePoint({ x: g.x, y: g.y });
        if (!at) continue;
        if (g.kind === "click") out({ kind: "click", ...at, button: g.button });
        else if (g.kind === "move") out({ kind: "move", ...at });
        else out({ kind: "scroll", ...at, dx: g.dx, dy: g.dy });
      }
    },
    [remotePoint],
  );

  const feed = (type: "down" | "move" | "up" | "cancel", event: GestureResponderEvent) => {
    if (!live.current.active) return;
    const m = gestures();
    if (!m) return;
    if (type === "down") {
      if (m.mode === "trackpad" && !cursor) {
        const c = m.cursor;
        setCursor({ x: c.x - live.current.box.left, y: c.y - live.current.box.top });
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => apply(m.tick(now())), LONG_PRESS_MS + 20);
      (timer.current as { unref?: () => void }).unref?.();
    }
    if (type === "up" || type === "cancel") clearTimeout(timer.current);
    const outs: GestureOut[] = [];
    for (const touch of touchesOf(event)) {
      outs.push(...m.feed({ type, id: touch.identifier, x: touch.pageX, y: touch.pageY, t: now(), pointerType: "touch" }));
    }
    apply(outs);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const onLayout = (event: LayoutChangeEvent) => {
    const layout = event.nativeEvent.layout;
    const next = { left: layout.x, top: layout.y, width: layout.width, height: layout.height };
    live.current.box = next;
    setBox(next);
    const node = surface.current as (View & { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void }) | null;
    node?.measureInWindow?.((left, top, width, height) => {
      if (width > 0 && height > 0) {
        const measured = { left, top, width, height };
        live.current.box = measured;
        setBox(measured);
      }
    });
  };

  const zoomed = view.zoom !== 1 || view.panX !== 0 || view.panY !== 0;

  return (
    <View
      ref={surface}
      testID="drive-surface"
      collapsable={false}
      onLayout={onLayout}
      onStartShouldSetResponder={() => active}
      onMoveShouldSetResponder={() => active}
      onResponderGrant={(e) => feed("down", e)}
      onResponderMove={(e) => feed("move", e)}
      onResponderRelease={(e) => feed("up", e)}
      onResponderTerminate={(e) => feed("cancel", e)}
      style={{ flex: 1, overflow: "hidden", backgroundColor: bw.bg }}
      accessibilityLabel={active ? "Remote screen, you are driving" : "Remote screen, look only"}
    >
      <View
        testID="drive-view"
        pointerEvents="none"
        style={
          zoomed
            ? {
                flex: 1,
                transform: [{ translateX: view.panX }, { translateY: view.panY }, { scale: view.zoom }],
              }
            : { flex: 1 }
        }
      >
        {children}
      </View>
      {active && mode === "trackpad" && cursor ? (
        <View
          testID="drive-cursor"
          pointerEvents="none"
          accessible={false}
          style={{
            position: "absolute",
            left: cursor.x - 2,
            top: cursor.y - 2,
            width: 14,
            height: 18,
            borderTopWidth: 18,
            borderRightWidth: 12,
            borderTopColor: bw.ink,
            borderRightColor: "transparent",
          }}
        />
      ) : null}
      <TextInput
        ref={field}
        testID="drive-keyboard-field"
        accessibilityLabel={typingLabel}
        editable={active}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        caretHidden
        value=""
        onChangeText={(text) => {
          if (active && text) send({ kind: "type", text });
        }}
        onKeyPress={(event) => {
          const press = keyPress({ key: event.nativeEvent.key });
          if (!active || !press) return;
          send({ kind: "key", key: press });
        }}
        onSubmitEditing={() => {
          if (active) send({ kind: "key", key: "Enter" });
        }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, left: 0, bottom: 0 }}
        showSoftInputOnFocus={Platform.OS !== "web"}
      />
      {active ? (
        <Pressable
          testID="drive-keyboard"
          accessibilityRole="button"
          accessibilityLabel="Keyboard"
          onPress={() => field.current?.focus()}
          style={({ pressed }) => ({
            position: "absolute",
            right: 12,
            bottom: 12,
            zIndex: 3,
            width: 44,
            height: 44,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: bw.line,
            backgroundColor: bw.raise,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View accessible={false}>
            <View style={{ width: 18, height: 12, borderRadius: 2, borderWidth: 1.5, borderColor: bw.ink }} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
