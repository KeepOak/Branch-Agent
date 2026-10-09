import { expect, it } from "vitest";
import { gigabytes, memoryTone } from "./memory-tone";

it("colours memory by share used: ok to 90%, warn above 90%, bad at 95% and over", () => {
  expect(memoryTone(89, 100)).toBe("ok");
  expect(memoryTone(91, 100)).toBe("warn");
  expect(memoryTone(94, 100)).toBe("warn");
  expect(memoryTone(95, 100)).toBe("bad");
  expect(memoryTone(0, 0)).toBe("ok");
});

it("shows gigabytes with one decimal and no trailing .0", () => {
  expect(gigabytes(28.6 * 1024 ** 3)).toBe("28.6");
  expect(gigabytes(32 * 1024 ** 3)).toBe("32");
});
