import { describe, expect, it } from "vitest";
import { decideHomeCall, HOME_HARD_DENY_DOMAINS } from "./home-control-guard.js";

const allowed = new Set(["light", "switch", "script", "scene", "automation", "lock", "climate"]);

describe("Home Assistant lock guard (AUTOMATION-0172)", () => {
  it("R-1615: script, scene and automation calls ask every time", () => {
    for (const service of [
      "script.turn_on",
      "scene.turn_on",
      "automation.trigger",
      "script.front_door",
    ]) {
      expect(decideHomeCall({ service }, allowed)).toMatchObject({
        outcome: "ask",
        remember: false,
      });
    }
  });

  it("R-1615: a generic call that targets a script entity still asks", () => {
    expect(
      decideHomeCall(
        { service: "homeassistant.turn_on", entityIds: ["script.unlock_front_door"] },
        new Set([...allowed, "homeassistant"]),
      ),
    ).toMatchObject({ outcome: "ask" });
  });

  it("R-1615: command-running integrations are refused even if the owner lists them", () => {
    const listed = new Set([...allowed, ...HOME_HARD_DENY_DOMAINS]);
    for (const domain of [
      "shell_command",
      "command_line",
      "python_script",
      "pyscript",
      "hassio",
      "rest_command",
    ]) {
      expect(decideHomeCall({ service: `${domain}.run` }, listed).outcome).toBe("deny");
    }
  });

  it("R-1615: ordinary listed domains run and unlisted ones are refused", () => {
    expect(
      decideHomeCall({ service: "light.turn_on", entityIds: ["light.kitchen"] }, allowed),
    ).toEqual({
      outcome: "allow",
    });
    expect(decideHomeCall({ service: "media_player.play" }, allowed).outcome).toBe("deny");
  });
});
