Register each Harvest batch in a sorted <batch>.txt file here, one engine:<path> or
window:<path> test file per line. Harvest tests do not belong in feature-batch-ci-named.

Linux PR checks run files from Harvest lists added or changed by the PR, plus
registered Harvest test files changed by the PR. The nightly and manually
dispatched workflow runs every registered Harvest file. Shards are sized by expected
time from the per-file seconds in scripts/feature-batch-ci-targets.mjs: PR
shards target six minutes and nightly shards ten, both including runner setup.
The nightly reports failures in one harvest-nightly issue.
