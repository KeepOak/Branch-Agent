// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchResultsView, useSearch } from "./Search";
import { Thread } from "../thread/Thread";

vi.mock("../face/Face", () => ({ Face: () => <span /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("message search to conversation find", () => {
  it("passes the clicked search query into find and jumps to its first hit", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    function Probe() {
      const [find, setFind] = useState<{ query: string; nonce: number } | null>(null);
      return <>
      <SearchResultsView query="needle" chip="all" now={1} trunkName={() => "Sapling"} rowName={() => "A conversation"}
        results={{ chats: [], past: [], files: [], messages: [{ key: "agent:main:main", role: "user", snippet: "the needle", at: 1, messageId: "m1" }] }}
        onChip={() => {}} onOpen={() => {}} onOpenMessage={(key, query) => {
          expect(key).toBe("agent:main:main");
          setFind({ query, nonce: 1 });
        }} onLibrary={() => {}} />
      <Thread name="Sapling" history={[{ kind: "user", key: "m1", text: "first needle" }, { kind: "user", key: "m2", text: "second needle" }]}
        live={[]} pendingUser={null} running={false} onAnswer={() => {}} findRequest={find} onFindRequestHandled={() => setFind(null)} />
      </>;
    }
    await act(async () => root!.render(<Probe />));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="search-result"]')!.click());
    expect(host.querySelector<HTMLInputElement>('.find-bar input')?.value).toBe("needle");
    expect(host.querySelector('[data-testid="find-count"]')?.textContent).toBe("1 of 2");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.click());
    expect(host.querySelector('[data-testid="find-count"]')?.textContent).toBe("2 of 2");
  });
});

describe("live search results", () => {
  it("labels an assistant message with its own Trunk, not the default Trunk", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<SearchResultsView query="report" chip="all" now={1}
      trunkName={(id) => id === "elm" ? "Elm" : "Sapling"} rowName={() => "A conversation"}
      results={{ chats: [], past: [], files: [], messages: [{ key: "agent:elm:main", role: "assistant", snippet: "report ready", at: 1, messageId: "m" }] }}
      onChip={() => {}} onOpen={() => {}} onOpenMessage={() => {}} onLibrary={() => {}} />));
    expect(host.querySelector(".sr-from")?.textContent).toBe("Elm: ");
  });
  it("does not show old message or file hits while a new query is pending", async () => {
    vi.useFakeTimers();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const request = vi.fn(async (method: string, params?: unknown) => {
      const query = (params as { query: string }).query;
      return method === "sessions.search"
        ? { results: [{ sessionKey: "agent:main:main", messageId: "old", snippet: query, role: "user" }] }
        : { results: [{ path: `${query}.md`, snippet: query }] };
    });
    let search!: ReturnType<typeof useSearch>;
    function Probe() {
      search = useSearch(request as <T = unknown>(method: string, params?: unknown) => Promise<T>, [], () => "Sapling");
      return <span>{search.results.messages.map((hit) => hit.snippet).join(",")}|{search.results.files.map((hit) => hit.title).join(",")}</span>;
    }
    await act(async () => root!.render(<Probe />));
    await act(async () => { search.setQuery("first"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(host.textContent).toBe("first|first.md");
    await act(async () => { search.setQuery("second"); });
    expect(host.textContent).toBe("|");
    await act(async () => { await vi.advanceTimersByTimeAsync(180); });
    expect(host.textContent).toBe("second|second.md");
  });
});
