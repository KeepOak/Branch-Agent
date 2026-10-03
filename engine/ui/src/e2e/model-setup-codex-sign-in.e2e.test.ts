// Renders detected-Codex activation responses through the real Model Setup UI.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createControlUiE2eArtifactDir } from "../test-helpers/control-ui-e2e-artifacts.ts";
import { takeControlUiViewportScreenshot } from "../test-helpers/control-ui-e2e-screenshot.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import { installSetupGateway, openModelSetup } from "./model-setup.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Detected Codex guided sign-in",
  startServerBeforeBrowser: true,
});

suite.define(() => {
  it.each(["before", "after"] as const)(
    "renders detected Codex activation %s guided sign-in",
    async (state) => {
      const artifacts = process.env.BRANCH_UI_E2E_ARTIFACT_DIR
        ? createControlUiE2eArtifactDir(
            "codex-sign-in-" + state,
            process.env.BRANCH_UI_E2E_ARTIFACT_DIR,
          )
        : undefined;
      await suite.withPage(
        {
          viewport: { width: 1280, height: 900 },
          locale: "en-US",
          colorScheme: "light",
          serviceWorkers: "block",
          reducedMotion: "reduce",
        },
        async ({ page }) => {
          const gateway = await installSetupGateway(page, {
            featureMethods: [
              "chat.metadata",
              "chat.startup",
              "branch.setup.detect",
              "branch.setup.activate.start",
              "wizard.next",
            ],
            methodResponses: {
              "branch.setup.detect": {
                candidates: [
                  {
                    kind: "codex-cli",
                    brandId: "openai",
                    label: "Codex",
                    modelRef: "openai/default",
                    detail: "installed; ChatGPT login found",
                    credentials: true,
                    recommended: false,
                  },
                ],
                manualProviders: [],
                workspace: "/tmp/branch-e2e",
                setupComplete: true,
              },
              "branch.setup.activate.start": {
                sessionId: "codex-sign-in",
                done: false,
                status: "running",
              },
              "wizard.next":
                state === "before"
                  ? {
                      done: true,
                      status: "error",
                      error: 'No API key found for provider "openai".',
                      activationRejection: {
                        disposition: "rejected-before-promotion",
                        status: "auth",
                      },
                    }
                  : {
                      sequence: [
                        {
                          done: false,
                          status: "running",
                          step: {
                            id: "scope",
                            type: "note",
                            message: "Scope: System / agent",
                            executor: "client",
                          },
                        },
                        {
                          done: false,
                          status: "running",
                          step: {
                            id: "device-code",
                            type: "progress",
                            executor: "gateway",
                            title: "OpenAI device code",
                            message: "Sign in to connect OpenAI to Branch.",
                            externalUrl: "https://example.com/device",
                            deviceCode: {
                              code: "DEMO-1234",
                              expiresInMinutes: 15,
                              message: "Enter this one-time code on the sign-in page.",
                            },
                          },
                        },
                        {
                          done: true,
                          status: "done",
                          modelActivation: { modelRef: "openai/default" },
                        },
                      ],
                    },
            },
          });
          await openModelSetup(page, suite.server.baseUrl);
          if (state === "after") {
            await gateway.deferNext("wizard.next", { answer: { stepId: "scope" } });
          }
          await page.locator('[data-candidate-kind="codex-cli"] button').click();
          expect(
            (await gateway.waitForRequest("branch.setup.activate.start")).params,
          ).toMatchObject({ kind: "codex-cli" });
          if (state === "after") {
            await page.getByRole("button", { name: "Continue", exact: true }).click();
            await gateway.waitForRequest("wizard.next", { match: { answer: { stepId: "scope" } } });
            await gateway.deferNext("wizard.next");
            await gateway.resolveDeferred("wizard.next");
            await page.getByText("DEMO-1234", { exact: true }).waitFor();
            await page.getByRole("link", { name: "Open sign-in" }).waitFor();
            await page.getByRole("button", { name: "Cancel", exact: true }).waitFor();
          } else {
            await page
              .getByText('No API key found for provider "openai".', { exact: true })
              .waitFor();
          }
          if (artifacts) {
            await writeFile(
              path.join(artifacts, state + ".png"),
              await takeControlUiViewportScreenshot(page, page.locator(".model-setup-wizard"), []),
            );
          }
          if (state === "after") {
            await gateway.resolveDeferred("wizard.next");
            await page.getByRole("heading", { name: "Connection verified" }).waitFor();
          }
        },
      );
    },
  );
});
