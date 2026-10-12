export type WebKitHostMessages = {
  branchLink: { type: "open-link"; url: string; target: "external" };
  branchUpdate: { type: "start-update" };
  branchNav: { type: "nav-state"; collapsed: boolean; width: number };
  branchWindowDrag: { type: "window-drag" };
  branchGateways:
    | {
        type: "select" | "open-window" | "set-primary" | "reconnect" | "reconnect-cancel";
        id: string;
      }
    | { type: "open-settings" };
  branchNotifications:
    | { type: "status" | "request-permission" | "send-test" }
    | {
        type: "background-session-completed";
        runId: string;
        path: string;
        search?: string;
      };
};

type WebKitMessageHandler<Message> = {
  postMessage(message: Message): void;
};

type WebKitHostWindow = Window & {
  webkit?: {
    messageHandlers?: {
      [Name in keyof WebKitHostMessages]?: WebKitMessageHandler<WebKitHostMessages[Name]>;
    };
  };
};

export function webKitHostWindow(): WebKitHostWindow | undefined {
  // SAFETY: WebKit owns this optional ambient bridge and the mapped contract narrows every handler.
  return typeof window === "undefined" ? undefined : (window as WebKitHostWindow);
}
