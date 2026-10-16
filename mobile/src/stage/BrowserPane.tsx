// The browser pane on take-control: a real address bar, plus the same Touch and Trackpad DriveSurface.
// Address and /act follow window/src/stage/BrowserView.tsx. Without a screencast bitmap, taps map 1:1 to
// the pane's CSS pixels (the surface box is both frame and remote).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import type { EngineLink } from "../pairing/pairingSession";
import { layout, space, type } from "../theme/tokens";
import { browserAct } from "./browser-drive";
import { resolveBrowserInput } from "./browser-input";
import { browserCall, DEFAULT_BROWSER_ROUTE, profileLine, readTabs, type LiveTab } from "./browser-route";
import { bw } from "./bw";
import { DriveSurface } from "./DriveSurface";
import type { RemoteAction } from "./remote-action";
import type { Size } from "./remote-map";

export type BrowserPhase = "loading" | "empty" | "connected" | "error";

type Props = {
  link: EngineLink;
  sessionKey: string | null;
  control: boolean;
  onControl: (next: boolean) => void;
  onPhase: (phase: BrowserPhase) => void;
  overlay?: ReactNode;
};

export function BrowserPane({ link, sessionKey, control, onControl, onPhase, overlay }: Props) {
  const route = DEFAULT_BROWSER_ROUTE;
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<BrowserPhase>("loading");
  const [tabs, setTabs] = useState<LiveTab[]>([]);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [box, setBox] = useState<Size | null>(null);
  const [note, setNote] = useState("");
  const tab = tabs.find((t) => t.targetId === picked) ?? tabs[0];
  const url = tab?.url ?? "";
  const shown = editing ? address : url === "about:blank" ? "" : url;
  const live = useRef({ control, tabId: tab?.targetId, sessionKey });
  live.current = { control, tabId: tab?.targetId, sessionKey };
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const present = useCallback(
    (next: BrowserPhase, message = "") => {
      setPhase(next);
      setError(message);
      onPhase(next);
    },
    [onPhase],
  );

  useEffect(() => {
    let gone = false;
    present("loading");
    void (async () => {
      const status = await browserCall<{ running?: boolean }>(link, route, "GET", "/", { sessionKey: sessionKey ?? undefined });
      if (gone) return;
      if (!status?.running) {
        setTabs([]);
        present("empty");
        return;
      }
      const next = readTabs(await browserCall(link, route, "GET", "/tabs", { sessionKey: sessionKey ?? undefined }));
      if (gone) return;
      setTabs(next);
      present("connected");
    })().catch((e: unknown) => {
      if (!gone) present("error", e instanceof Error ? e.message : String(e));
    });
    return () => {
      gone = true;
    };
  }, [link, sessionKey, tick, present, route]);

  const call = (method: "GET" | "POST" | "DELETE", path: string, options: Parameters<typeof browserCall>[4] = {}) =>
    browserCall(link, route, method, path, { ...options, sessionKey: sessionKey ?? undefined });

  const fail = (e: unknown) => setNote(e instanceof Error ? e.message : "The browser input couldn't be sent. Check the connection and try again.");

  const go = (raw: string) => {
    const input = resolveBrowserInput(raw);
    if (input.kind === "empty" || opening) return;
    const destination = input.url;
    onControl(true);
    setNote("");
    if (!tab) {
      setOpening(true);
      void call("POST", "/tabs/open", { body: { url: destination } })
        .then((result) => {
          const id = String((result as { targetId?: unknown } | null)?.targetId ?? "");
          if (!id) throw new Error("The browser didn't open a tab. Try opening the page again.");
          setPicked(id);
          setEditing(false);
          setTick((n) => n + 1);
        }, fail)
        .finally(() => setOpening(false));
      return;
    }
    void call("POST", "/navigate", { targetId: tab.targetId, body: { url: destination } }).then(() => {
      setEditing(false);
      setTick((n) => n + 1);
    }, fail);
  };

  const history = (step: "back" | "forward") => {
    if (!tab) return;
    onControl(true);
    void call("POST", "/act", { targetId: tab.targetId, body: { kind: "evaluate", fn: `() => history.${step}()` } }).then(() => setTick((n) => n + 1), fail);
  };

  const reload = () => {
    if (!tab) return;
    onControl(true);
    void call("POST", "/act", { targetId: tab.targetId, body: { kind: "evaluate", fn: "() => location.reload()" } }).then(
      () => setTick((n) => n + 1),
      () => setTick((n) => n + 1),
    );
  };

  const send = (action: RemoteAction) => {
    const body = browserAct(action);
    const targetId = live.current.tabId;
    if (!body || !live.current.control || !targetId) return;
    queue.current = queue.current.then(
      () => call("POST", "/act", { targetId, body }),
      () => undefined,
    ).then(
      () => setNote(""),
      fail,
    );
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setBox({ width, height });
  };

  let page;
  if (phase === "loading") {
    page = <Blank title="Connecting to the browser…" text="Reading this conversation's tabs." />;
  } else if (phase === "error") {
    page = (
      <Blank title="Couldn't connect to the browser" text={error || "Check this conversation's browser connection, then try again."}>
        <Pressable
          testID="browser-retry"
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={() => setTick((n) => n + 1)}
          style={({ pressed }) => ({
            minHeight: layout.rowMinHeight,
            paddingHorizontal: space.lg,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: bw.ink,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...type.headline, color: bw.ink }}>Try again</Text>
        </Pressable>
      </Blank>
    );
  } else if (phase === "empty") {
    page = <Blank title="The browser isn’t running" text="Open a page from the address bar once the browser is on." />;
  } else if (!tab || tab.url === "about:blank") {
    page = (
      <Blank title="Its browser" text="Type a website or a search above and press Open. Then click and type yourself, or ask it to work on the page.">
        <Text style={{ ...type.caption1, color: bw.ink3, textAlign: "center" }}>Branch's browser is separate from your personal browser.</Text>
      </Blank>
    );
  } else {
    page = (
      <View testID="browser-page" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
        <Text numberOfLines={2} style={{ ...type.subhead, color: bw.ink, textAlign: "center" }}>
          {tab.title || tab.url}
        </Text>
      </View>
    );
  }

  return (
    <View testID="browser-pane" style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: layout.screenInset, paddingBottom: space.xs }}>
        <Text numberOfLines={1} style={{ ...type.caption2, color: bw.ink3 }}>
          {profileLine(route)}
        </Text>
      </View>
      <View
        testID="browser-address-bar"
        style={{
          marginHorizontal: layout.screenInset,
          marginBottom: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          borderWidth: 1,
          borderColor: bw.line,
          borderRadius: 12,
          backgroundColor: bw.raise,
          paddingLeft: space.xs,
          paddingRight: space.xs,
          minHeight: layout.rowMinHeight,
        }}
      >
        {tab ? (
          <>
            <Nav label="Back" testID="browser-back" onPress={() => history("back")} glyph="‹" />
            <Nav label="Forward" testID="browser-forward" onPress={() => history("forward")} glyph="›" />
            <Nav label="Reload" testID="browser-reload" onPress={reload} glyph="↻" />
          </>
        ) : null}
        <TextInput
          testID="browser-address"
          accessibilityLabel="Search or enter an address"
          value={shown}
          onChangeText={(text) => {
            setEditing(true);
            setAddress(text);
          }}
          onFocus={() => {
            if (!editing) {
              setAddress(url === "about:blank" ? "" : url);
              setEditing(true);
            }
          }}
          onSubmitEditing={() => go(shown)}
          placeholder="Search or enter an address"
          placeholderTextColor={bw.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="url"
          returnKeyType="go"
          editable={!opening}
          style={{ flex: 1, minWidth: 0, ...type.body, color: bw.ink, paddingVertical: space.sm }}
        />
        <Pressable
          testID="browser-open"
          accessibilityRole="button"
          accessibilityLabel="Open"
          disabled={opening || !shown.trim()}
          onPress={() => go(shown)}
          style={({ pressed }) => ({
            minHeight: 32,
            paddingHorizontal: space.sm,
            borderRadius: 8,
            backgroundColor: shown.trim() && !opening ? bw.ink : bw.fill,
            alignItems: "center",
            justifyContent: "center",
            opacity: opening || !shown.trim() ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...type.caption1, color: shown.trim() && !opening ? bw.onInk : bw.ink3, fontWeight: "600" }}>Open</Text>
        </Pressable>
      </View>
      {note ? (
        <Text testID="browser-note" accessibilityRole="alert" style={{ ...type.footnote, color: bw.ink, textAlign: "center", paddingHorizontal: layout.screenInset, paddingBottom: space.xs }}>
          {note}
        </Text>
      ) : null}
      <View testID="browser-stage" style={{ flex: 1, marginHorizontal: layout.screenInset, borderWidth: 1, borderColor: bw.line, borderRadius: 12, overflow: "hidden" }} onLayout={onLayout}>
        <DriveSurface active={control && phase === "connected"} frame={box} remote={box} send={send} typingLabel="Type into the page">
          {page}
        </DriveSurface>
        {overlay}
      </View>
    </View>
  );
}

function Nav({ label, testID, onPress, glyph }: { label: string; testID: string; onPress: () => void; glyph: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 28, height: 32, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ ...type.headline, color: bw.ink }}>{glyph}</Text>
    </Pressable>
  );
}

function Blank({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <View testID="browser-blank" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm }}>
      <Text style={{ ...type.headline, color: bw.ink, textAlign: "center" }}>{title}</Text>
      <Text style={{ ...type.footnote, color: bw.ink2, textAlign: "center" }}>{text}</Text>
      {children}
    </View>
  );
}
