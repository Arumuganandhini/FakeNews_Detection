#!/usr/bin/env bash
# Full six-factor benchmark, run in the order the paper needs it.
#
# Every config is resumable: runEval.js skips article ids already present in its
# output file, so an interrupted run can simply be started again.
#
#   bash eval/runAll.sh          # core configs (paper §7.1 headline numbers)
#   bash eval/runAll.sh --all    # core configs plus the four ablations
set -u
cd "$(dirname "$0")/.."

DATA=eval/data/isot.csv
N=300
SEED=42

# Core three: the current pipeline, the black-box baseline it is compared
# against, and the Phase I content pipeline so the two new factors can be
# credited separately.
CORE=(content-only baseline content-v1)

# Ablations: remove one factor at a time to show each contributes.
ABLATIONS=(no-transparency no-manipulation no-bias no-clickbait)

CONFIGS=("${CORE[@]}")
if [ "${1:-}" = "--all" ]; then CONFIGS+=("${ABLATIONS[@]}"); fi

echo "=== benchmark start: $(date '+%Y-%m-%d %H:%M') ==="
echo "configs: ${CONFIGS[*]}"
echo "n=$N seed=$SEED"
echo

for cfg in "${CONFIGS[@]}"; do
  echo "--- $cfg  ($(date '+%H:%M')) ---"
  node eval/runEval.js --data "$DATA" --config "$cfg" --sample "$N" --seed "$SEED" \
    2>&1 | grep -viE "model busy|rate limited|falling back|JSON parse failed|coverage search"
  echo
done

echo "=== all configs finished: $(date '+%Y-%m-%d %H:%M') ==="
node eval/report.js
