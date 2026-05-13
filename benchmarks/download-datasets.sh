#!/usr/bin/env bash
# Engram benchmark dataset downloader.
#
# Fetches the public datasets used by the benchmark suite into
# benchmarks/data/. Idempotent — re-running skips anything already
# downloaded. Safe to abort and resume.
#
# Datasets:
#   * LoCoMo        https://github.com/snap-research/locomo
#   * LongMemEval   https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
#
# Usage:
#   bash benchmarks/download-datasets.sh           # download everything missing
#   bash benchmarks/download-datasets.sh --force   # re-download everything
#   bash benchmarks/download-datasets.sh locomo    # download only LoCoMo
#   bash benchmarks/download-datasets.sh lme       # download only LongMemEval
#
# Requires: curl, git, tar (all standard on macOS + Linux).

set -euo pipefail

# Resolve the script's directory so this works no matter where it's invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"

# ── Args ──────────────────────────────────────────────────────────────
FORCE=0
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    locomo|lme|longmemeval) TARGETS+=("$arg") ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "${#TARGETS[@]}" -eq 0 ]; then
  TARGETS=("locomo" "lme")
fi

mkdir -p "$DATA_DIR"

want() {
  for t in "${TARGETS[@]}"; do
    if [ "$t" = "$1" ] || { [ "$1" = "lme" ] && [ "$t" = "longmemeval" ]; }; then
      return 0
    fi
  done
  return 1
}

log() { printf "[download-datasets] %s\n" "$*"; }
err() { printf "[download-datasets] ERROR: %s\n" "$*" >&2; }

# ── LoCoMo ────────────────────────────────────────────────────────────
# The dataset ships inside the snap-research/locomo repo at
# data/locomo10.json. The repo is small (~30 MB) and there is no
# tarball release, so a shallow clone is the cheapest path.
download_locomo() {
  local target="${DATA_DIR}/locomo"
  local dataset="${target}/data/locomo10.json"

  if [ -f "$dataset" ] && [ "$FORCE" -eq 0 ]; then
    log "LoCoMo already present at ${dataset} — skipping"
    return 0
  fi

  if [ "$FORCE" -eq 1 ] && [ -d "$target" ]; then
    log "LoCoMo force flag set — removing existing checkout"
    rm -rf "$target"
  fi

  log "Cloning snap-research/locomo into ${target}"
  if ! git clone --depth 1 https://github.com/snap-research/locomo.git "$target"; then
    err "git clone failed — check network or run with --force after fixing"
    return 1
  fi

  if [ ! -f "$dataset" ]; then
    err "expected ${dataset} after clone but did not find it — upstream layout may have changed"
    return 1
  fi

  log "LoCoMo ready at ${dataset}"
}

# ── LongMemEval ───────────────────────────────────────────────────────
# Downloaded as a single ~277 MB JSON from the cleaned mirror on
# Hugging Face. The original (xiaowu0162) repo is the source the
# longmemeval benchmark already references.
download_lme() {
  local file="${DATA_DIR}/longmemeval_s_cleaned.json"
  local url="https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json"

  if [ -f "$file" ] && [ "$FORCE" -eq 0 ]; then
    log "LongMemEval already present at ${file} — skipping"
    return 0
  fi

  log "Downloading LongMemEval (~277 MB) to ${file}"
  if ! curl -fL --retry 3 --retry-delay 2 -o "${file}.partial" "$url"; then
    err "curl failed — check network and try again"
    rm -f "${file}.partial"
    return 1
  fi

  mv "${file}.partial" "$file"
  log "LongMemEval ready at ${file}"
}

# ── Run ───────────────────────────────────────────────────────────────
STATUS_LOCOMO="skipped"
STATUS_LME="skipped"

if want locomo; then
  if download_locomo; then STATUS_LOCOMO="ok"; else STATUS_LOCOMO="failed"; fi
fi

if want lme; then
  if download_lme; then STATUS_LME="ok"; else STATUS_LME="failed"; fi
fi

# ── Summary ───────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────"
echo " Engram benchmark datasets"
echo "─────────────────────────────────────────────────"
printf " LoCoMo        %s\n" "$STATUS_LOCOMO"
printf " LongMemEval   %s\n" "$STATUS_LME"
echo "─────────────────────────────────────────────────"
echo " Data root:    ${DATA_DIR}"
echo
echo " Next:         npm run bench:all"
echo

if [ "$STATUS_LOCOMO" = "failed" ] || [ "$STATUS_LME" = "failed" ]; then
  exit 1
fi
