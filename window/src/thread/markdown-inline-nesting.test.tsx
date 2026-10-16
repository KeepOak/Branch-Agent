// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Markdown } from "./markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const hosts: HTMLElement[] = [];
afterEach(() => { hosts.splice(0).forEach((host) => host.remove()); });

async function render(text: string): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  hosts.push(host);
  await act(async () => createRoot(host).render(<Markdown text={text} />));
  return host;
}

it("formats a link and inline code inside bold text instead of showing their Markdown", async () => {
  const host = await render("**[#1536](https://github.com/KeepOak/Branch-Agent/pull/1536)** (service fix): now at **`6684a1d`**.");
  const link = host.querySelector("strong > a")!;
  expect(link.textContent).toBe("#1536");
  expect(link.getAttribute("href")).toBe("https://github.com/KeepOak/Branch-Agent/pull/1536");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(host.querySelector("strong > code")?.textContent).toBe("6684a1d");
  expect(host.textContent).not.toMatch(/[`[\]]|\]\(/);
});

it("formats inside italics too, and keeps raw HTML in bold as text", async () => {
  const host = await render("*see [the docs](https://example.com/docs)* and **<img src=x onerror=alert(1)>**");
  expect(host.querySelector("em > a")?.getAttribute("href")).toBe("https://example.com/docs");
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("strong")?.textContent).toBe("<img src=x onerror=alert(1)>");
});

it("keeps underscores inside words as written, and still reads _word_ as italic", async () => {
  const host = await render("BRANCH_HOME was the account home, so BRANCH_HOME moved. Read _this_ first.");
  expect(host.textContent).toBe("BRANCH_HOME was the account home, so BRANCH_HOME moved. Read this first.");
  expect([...host.querySelectorAll("em")].map((em) => em.textContent)).toEqual(["this"]);
});
