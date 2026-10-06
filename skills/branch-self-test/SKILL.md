---
name: branch-self-test
description: Test your own Branch change the way the owner will see it, before opening a PR. Run a scratch engine and the built window, drive the changed control with Branch's browser tool (and the computer tool for desktop-only things), screenshot it next to the design artifact, and attach the screenshots to the PR. Use for every window or engine change that has a visible effect.
---

# Self-test before every PR

Unit tests are not enough: the owner tests by clicking. Before `gh pr create`, prove the change works in a running Branch.

## Never
- Never use the owner's app, its data (%LOCALAPPDATA%/BranchAgent) or its gateway (port 19031).
- Never use ports 3210, 3300 or 3299.
- Never leave scratch processes running: stop them by the PID you started, when you finish.

## Your ports (one set per builder, so builders never collide)
| Builder | scratch gateway | window server |
|---|---|---|
| Ash | 19611 | 5611 |
| Elm | 19621 | 5621 |
| Oak | 19631 | 5631 |
| Birch | 19641 | 5641 |
| Cedar | 19651 | 5651 |
| Maple | 19661 | 5661 |

## Steps (PowerShell 5.1 on this Windows host)
1. Build what you changed.
   - Engine: NEVER run the full engine build (`pnpm build`) on this shared machine; CI runs it. Use the dist already in your worktree. If you changed a gateway package, rebuild only that package: `node --import ./scripts/tsx.mjs scripts/build-workspace-package.mts <pkg>`. Engine logic is proven by `node scripts/strict-typecheck.mjs` plus named tests. If engine `dist/` is missing, ask the lead instead of building it.
   - Before any heavy step (build, scratch gateway, preview, Chrome), check that free memory is at least 6 GB: `[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)`. Run only one heavy step at a time.
   - Window: `pnpm -C window exec vite build`.
2. Start a scratch engine with its own home and token, in the background:
   - `$env:BRANCH_HOME = "$env:TEMP\branch-selftest-<you>"`, `$env:BRANCH_GATEWAY_TOKEN = "<random 32 hex>"`, `$env:BRANCH_SKIP_CHANNELS = "1"`;
   - `Start-Process -WindowStyle Hidden -PassThru node -ArgumentList "branch.mjs","gateway","--dev","--port","<your gateway port>"` from `engine/`;
   - note the PID;
   - wait until `http://127.0.0.1:<port>/readyz` returns 200 (can take 1-3 minutes on this machine).
   - Seed only what the test needs, through gateway methods. Use no real accounts: a scratch engine has no model sign-in, so test UI, routing and engine methods, not model replies.
3. Serve the built window: `pnpm -C window exec vite preview --port <your window port> --strictPort` (hidden, note the PID).
4. Open the window and drive it. Branch's **browser** tool refuses loopback addresses by design (its SSRF guard; the owner keeps that default), so for the scratch window use `node` + `playwright-core` from `engine/node_modules` with installed Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`, headless). Before `page.goto("http://127.0.0.1:<window port>/")`, inject the desktop bridge the way the desktop preload does, so the window connects to YOUR scratch engine: `await page.addInitScript((tok) => { window.branchDesktop = { gatewayUrl: "ws://127.0.0.1:<gateway port>", gatewayToken: tok }; }, token)` (the `?gatewayUrl=` link only works after a manual confirm). A working example script, reading the token from a file and never printing it: C:/Users/bishi/Code/Branch/tools/branch-driver/skills/branch-self-test/clickrows.example.cjs. Use the browser and computer tools for public web pages and desktop-only checks.
   - with Playwright, click through exactly the flow you changed, as the owner would;
   - take a screenshot at each meaningful step.
   Use the **computer** tool only for things that live outside the page (desktop app, OS windows).
5. Compare with the design artifact.
   - Find the matching screen in `C:/Users/bishi/Code/Branch/docs/design/screens/` or the click-crawl at `C:/Users/bishi/Code/Branch/docs/dogfood/audit/frag/D-artifact-clicks.md` (section 1 has the priority flows with screenshots).
   - Behaviour follows the artifact, except where the owner's punch list (`C:/Users/bishi/Code/Branch/docs/OWNER-PUNCHLIST-20261005.md`) says otherwise; the punch list wins.
6. Attach the evidence. Save the screenshots outside the worktree (`$env:TEMP\branch-selftest-<you>\shots\`, PNG). `gh gist create` can't take images, so push them into a secret gist with git:
   - `"Self-test for <branch>" | Out-File -Encoding utf8 $env:TEMP\branch-selftest-<you>\README.md`; `gh gist create $env:TEMP\branch-selftest-<you>\README.md` (secret by default) prints the gist URL; its id is the last path part.
   - `git clone https://gist.github.com/<id>.git $env:TEMP\branch-selftest-<you>\gist`, copy the PNGs in, `git add *.png; git commit -m "self-test shots"; git push` (gh's credentials work for gists).
   - In the PR body, embed each one as `![<step>](https://gist.githubusercontent.com/stabrea/<id>/raw/<file>.png)`, plus what you clicked, what you saw, and how it compares with the artifact screen (name the screen file or crawl step).
7. Stop the scratch engine and window server by their PIDs (`Stop-Process -Id <pid>`). Delete `$env:TEMP\branch-selftest-<you>` only after they have exited.

## If a tool doesn't work
If the browser or computer tool fails on this Windows host (it can't launch, can't attach, or gets no screenshot), don't skip the self-test silently.
- Say exactly what failed (tool, call, error text) in your reply and in the PR body.
- Fall back to `node` + `playwright-core` from `engine/node_modules` driving Chrome/Edge headless against the same URL, for screenshots.
The lead logs the failure in WEAKNESSES.md and gets it fixed.

## Clean up (mandatory)
Stop the scratch gateway, vite preview and headless Chrome by PID (`Stop-Process -Id <pid>`) as soon as the screenshots are taken, and list the stopped PIDs in the PR body. A PR that leaves scratch processes running is sent back.

## CI tour (additional evidence)

The `visual-tour.yml` workflow also runs a shared-shell click-through on GitHub-hosted runners. Inspect its sticky PR comment, screenshots, dead-control report, and console errors. Fix red checks and link the successful run in the PR body. The CI tour supplements the local self-test above; it does not replace it while the workflow is being stabilized. Add new visible flows to `scripts/visual-tour/screens.json` with a visible response assertion for each click.
