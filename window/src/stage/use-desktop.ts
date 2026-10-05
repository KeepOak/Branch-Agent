import { useEffect, useState, type RefObject } from "react";
import type { DesktopObserveResult, DesktopSource, EnvironmentSummary } from "@branch/gateway-protocol";
import type { WindowEngine } from "../connect/engine";
import { DesktopClient } from "./desktop-client";
import { resolveGatewayWebSocketUrl } from "./gateway-websocket-url";

export type DesktopPhase = "loading" | "empty" | "connected" | "error";
export type DesktopView = {
  phase: DesktopPhase;
  /** The computer's own label, when the engine gave one. */
  title?: string;
  controlling?: boolean;
  message?: string;
};

/** The source desktop.observe needs for an environment id: the host, a paired node or a worker. */
export function sourceFor(id: string): DesktopSource {
  return id === "gateway"
    ? { kind: "host" }
    : id.startsWith("node:")
      ? { kind: "node", nodeId: id.slice(5) }
      : { kind: "environment", environmentId: id };
}

/**
 * One live screen of one computer: environments.status, then desktop.observe, then a noVNC viewer in `target`.
 * The observe grant is released whenever the view closes or changes. It never guesses another computer.
 */
export function useDesktopView(
  engine: WindowEngine,
  gatewayUrl: string,
  environmentId: string | null,
  target: RefObject<HTMLDivElement | null>,
  control: boolean,
  retry: number,
): DesktopView {
  const [view, setView] = useState<{ key: string; view: DesktopView }>({ key: "", view: { phase: "loading" } });
  const key = `${engine.sessionKey}|${environmentId}|${control}|${retry}`;
  useEffect(() => {
    let active = true,
      connection: { disconnect(): void } | undefined,
      observedPath: string | undefined;
    const show = (next: DesktopView) => {
      if (active) setView({ key, view: next });
    };
    const release = () => {
      const path = observedPath;
      observedPath = undefined;
      if (path) void engine.request("desktop.release", { wsPath: path }).catch(() => undefined);
    };
    if (!environmentId) {
      show({ phase: "empty" });
      return () => {
        active = false;
      };
    }
    show({ phase: "loading" });
    void (async () => {
      try {
        const environment = await engine.request<EnvironmentSummary>("environments.status", { environmentId });
        if (!active) return;
        const title = environmentLabel(environment);
        if (environment.id !== environmentId || !environment.desktop || environment.status !== "available") {
          show({ phase: "empty", title });
          return;
        }
        const observed = await engine.request<DesktopObserveResult>("desktop.observe", { source: sourceFor(environmentId), control });
        observedPath = observed.wsPath;
        if (!active || !target.current) {
          release();
          return;
        }
        // Account and VNC credentials are asked for by the computer's own settings; never guessed or collected here.
        if (observed.auth === "ard-account" || (observed.auth === "vnc-password" && !observed.vncPassword && !observed.preauthenticated)) {
          release();
          show({ phase: "error", title, message: "This computer requires authentication. Open its computer settings to connect." });
          return;
        }
        if (observed.transport === "frames") {
          const host = target.current;
          const image = document.createElement("img");
          image.alt = `${title} live screen`;
          image.className = "stage-frame-image";
          host.replaceChildren(image);
          if (control) host.tabIndex = 0;
          const socket = new WebSocket(resolveGatewayWebSocketUrl(observed.wsPath, gatewayUrl));
          const onClick = (event: MouseEvent) => {
            if (!control || socket.readyState !== WebSocket.OPEN || !image.naturalWidth) return;
            const rect = image.getBoundingClientRect();
            socket.send(JSON.stringify({ action: "left_click", x: Math.floor((event.clientX - rect.left) * image.naturalWidth / rect.width),
              y: Math.floor((event.clientY - rect.top) * image.naturalHeight / rect.height) }));
            host.focus();
          };
          const onKey = (event: KeyboardEvent) => {
            if (!control || socket.readyState !== WebSocket.OPEN) return;
            if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
              socket.send(JSON.stringify({ action: "type", text: event.key }));
            } else if (["Enter", "Backspace", "Delete", "Tab", "Escape"].includes(event.key)) {
              socket.send(JSON.stringify({ action: "key", key: event.key }));
            } else return;
            event.preventDefault();
          };
          host.addEventListener("click", onClick);
          host.addEventListener("keydown", onKey);
          let received = false;
          socket.addEventListener("message", (event) => {
            if (!active) return;
            try {
              const payload = JSON.parse(String(event.data)) as { type: string; image?: string; message?: string };
              if (payload.type === "error") {
                show({ phase: "error", title, message: payload.message || "Screen capture failed." });
              } else if (payload.type === "frame" && payload.image) {
                image.src = `data:image/jpeg;base64,${payload.image}`;
                if (!received) { received = true; show({ phase: "connected", title, controlling: control }); }
              }
            } catch { /* Ignore invalid frames and wait for the next picture. */ }
          });
          socket.addEventListener("close", () => {
            if (active && !received) show({ phase: "error", title, message: "The computer connection closed." });
          });
          connection = { disconnect: () => {
            host.removeEventListener("click", onClick);
            host.removeEventListener("keydown", onKey);
            image.remove();
            socket.close();
          } };
          return;
        }
        const handle = await new DesktopClient().connect({
          target: target.current,
          gatewayUrl,
          wsUrl: observed.wsPath,
          viewOnly: !observed.control,
          canResize: observed.canResize,
          sizingMode: "fit",
          isCurrent: () => active,
          ...(observed.vncPassword ? { credentials: { password: observed.vncPassword } } : {}),
          onConnect: () => show({ phase: "connected", title, controlling: observed.control }),
          onDisconnect: (d) => {
            release();
            show({ phase: "error", title, message: d.clean ? "The computer connection closed." : "The computer disconnected." });
          },
          onSecurityFailure: () => {
            release();
            show({ phase: "error", title, message: "The computer refused authentication." });
          },
        });
        if (!active) handle.disconnect();
        else connection = handle;
      } catch (e) {
        release();
        show({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      active = false;
      connection?.disconnect();
      release();
    };
  }, [engine, gatewayUrl, environmentId, control, retry, target, key]);
  return view.key === key ? view.view : { phase: environmentId ? "loading" : "empty" };
}

/** The name a person sees for a computer: the host is "This computer"; otherwise the engine's label, then its id. */
export function environmentLabel(environment: Pick<EnvironmentSummary, "id" | "label">): string {
  return environment.id === "gateway" ? "This computer" : environment.label || environment.id;
}
