// Minimal declarations for the existing jsdom fixture dependency; no extra types package is needed.
declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: {
      runScripts?: "dangerously";
      beforeParse?: (window: Pick<Window, "setInterval" | "clearInterval">) => void;
    });
    window: Window & Pick<typeof globalThis, "MouseEvent" | "Event">;
  }
}
