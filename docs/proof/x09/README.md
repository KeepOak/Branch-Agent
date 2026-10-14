# X09: observed run pace

`node scripts/parity/measure-run-pace.mjs <output-directory>` remeasures X09
against the source checkout. It runs the event-driven fixed-timing regression
and the overview rendering regression and writes an explicit PASS/FAIL result.
Raw logs stay in the caller-selected output directory.

The legacy live scorecard does not contain X09. This extension measures source
behavior, not the currently installed release. The checked-in result is a
source-checkout measurement.

Three individually observed completions at 10, 30 and 60 seconds after the plan
baseline give 3 completed steps/minute. With two steps left, the observed
10–30 second interval envelope yields a 20–60 second plan ETA. It is not a
statistical confidence interval or an estimate for work outside that plan.

Plans with fewer than three timed completions, missing totals, changed step
identities, reopened steps or an overdue next step do not show a numeric ETA.
Batch completions contribute to the rate but cannot manufacture independent
timing samples. Each run owns its own history; registration resets it.

Before/after screenshots mount the actual run-card component with production
styles and identical synthetic props in an isolated browser fixture. The
fixture checks that opening the conversation still works. It does not exercise
a live model or the installed application.
