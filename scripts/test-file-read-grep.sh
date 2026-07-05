#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --env-file .env --import tsx/esm scripts/run-test.ts test_file_read_grep
