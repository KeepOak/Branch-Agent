import { describe, expect, it } from "vitest";
import { editingKey, forwardedKey, resolveBrowserInput, SEARCH_ENDPOINT } from "./browser-input";

describe("resolveBrowserInput: address or search", () => {
  it("treats a bare domain as an https address", () => {
    expect(resolveBrowserInput("keepoak.com")).toEqual({ kind: "url", url: "https://keepoak.com" });
    expect(resolveBrowserInput("  docs.example.org/a?b=1  ")).toEqual({ kind: "url", url: "https://docs.example.org/a?b=1" });
  });

  it("keeps a full web address as typed", () => {
    expect(resolveBrowserInput("https://keepoak.com/pricing")).toEqual({ kind: "url", url: "https://keepoak.com/pricing" });
    expect(resolveBrowserInput("http://example.com")).toEqual({ kind: "url", url: "http://example.com" });
  });

  it("opens localhost, IP addresses and host:port over http", () => {
    expect(resolveBrowserInput("localhost:3000")).toEqual({ kind: "url", url: "http://localhost:3000" });
    expect(resolveBrowserInput("192.168.1.20:8080/x")).toEqual({ kind: "url", url: "http://192.168.1.20:8080/x" });
    expect(resolveBrowserInput("keepoak.com:8443")).toEqual({ kind: "url", url: "https://keepoak.com:8443" });
  });

  it("searches for a plain word instead of navigating to https://hi", () => {
    expect(resolveBrowserInput("hi")).toEqual({ kind: "search", query: "hi", url: `${SEARCH_ENDPOINT}hi` });
  });

  it("searches for anything with spaces, encoding the query", () => {
    expect(resolveBrowserInput("best coffee near me")).toEqual({
      kind: "search",
      query: "best coffee near me",
      url: "https://duckduckgo.com/?q=best%20coffee%20near%20me",
    });
    expect(resolveBrowserInput("a&b=c")).toEqual({ kind: "search", query: "a&b=c", url: "https://duckduckgo.com/?q=a%26b%3Dc" });
  });

  it("never navigates to script, data or file addresses", () => {
    for (const hostile of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "about:config"]) {
      expect(resolveBrowserInput(hostile).kind).toBe("search");
    }
  });

  it("returns empty for blank input and keeps about:blank for new tabs", () => {
    expect(resolveBrowserInput("   ")).toEqual({ kind: "empty" });
    expect(resolveBrowserInput("about:blank")).toEqual({ kind: "url", url: "about:blank" });
  });
});

describe("forwardedKey: what reaches the page as a key press", () => {
  it("forwards editing and navigation keys", () => {
    for (const key of ["Enter", "Backspace", "Delete", "Tab", "ArrowLeft", "ArrowDown", "Home", "PageUp"]) {
      expect(forwardedKey({ key })).toBe(key);
    }
  });

  it("does not forward printable characters, which arrive as text instead", () => {
    expect(forwardedKey({ key: "a" })).toBeNull();
    expect(forwardedKey({ key: "Unidentified" })).toBeNull();
  });

  it("leaves shortcuts, composition and Escape to the window", () => {
    expect(forwardedKey({ key: "Enter", metaKey: true })).toBeNull();
    expect(forwardedKey({ key: "Backspace", ctrlKey: true })).toBeNull();
    expect(forwardedKey({ key: "Enter", isComposing: true })).toBeNull();
    expect(forwardedKey({ key: "Enter", keyCode: 229 })).toBeNull();
    expect(forwardedKey({ key: "Escape" })).toBeNull();
  });
});

describe("editingKey: soft keyboards send edits as input types", () => {
  it("maps delete and line break input types to page keys", () => {
    expect(editingKey("deleteContentBackward")).toBe("Backspace");
    expect(editingKey("deleteContentForward")).toBe("Delete");
    expect(editingKey("insertParagraph")).toBe("Enter");
    expect(editingKey("insertText")).toBeNull();
  });
});
