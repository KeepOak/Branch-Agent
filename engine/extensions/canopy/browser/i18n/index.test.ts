import { expect, it } from "vitest";
import { canopyTestHost } from "../test/host.setup.ts";
import { t } from "./index.ts";

it("uses the host locale for migrated Canopy translations", () => {
  Object.assign(canopyTestHost().host, { locale: "zh-CN" });
  expect(t("canopy.widget.boardLabel")).toBe("Canopy 看板");
  expect(t("canopy.widget.cardCount", { count: "3" })).toBe("3 张卡片");
});

it("falls back to English for an untranslated locale", () => {
  Object.assign(canopyTestHost().host, { locale: "unsupported-locale" });
  expect(t("canopy.newCard")).toBe("New card");
});
