#!/usr/bin/env bash

resolve_upgrade_survivor_paths() {
  ARTIFACT_ROOT="$(dirname "${BRANCH_UPGRADE_SURVIVOR_SUMMARY_JSON:-/tmp/branch-upgrade-survivor-artifacts/summary.json}")"
  RUNTIME_ROOT="${BRANCH_UPGRADE_SURVIVOR_RUNTIME_ROOT:-/tmp/branch-upgrade-survivor-runtime}"
  SUMMARY_JSON="${BRANCH_UPGRADE_SURVIVOR_SUMMARY_JSON:-$ARTIFACT_ROOT/summary.json}"
  case "${BRANCH_UPGRADE_SURVIVOR_SCENARIO:-base}" in
    base|legacy-operator-state|missing-load-path) npm_config_prefix="$RUNTIME_ROOT/npm-prefix" ;;
    *) npm_config_prefix="$ARTIFACT_ROOT/npm-prefix" ;;
  esac
  BASELINE_PACKAGE_ROOT="$npm_config_prefix/lib/node_modules/branch"
  BASELINE_BIN_DIR="$npm_config_prefix/bin"
  BASELINE_INSTALL_LOG="$ARTIFACT_ROOT/baseline-install.log"
  UPDATE_JSON="$ARTIFACT_ROOT/update.json"
  UPDATE_ERR="$ARTIFACT_ROOT/update.err"
  export BRANCH_UPGRADE_SURVIVOR_ARTIFACT_ROOT="$ARTIFACT_ROOT"
  export BRANCH_UPGRADE_SURVIVOR_RUNTIME_ROOT="$RUNTIME_ROOT"
  export npm_config_prefix NPM_CONFIG_PREFIX="$npm_config_prefix"
}
