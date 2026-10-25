#!/usr/bin/env bash
# Unauthenticated Maestro smoke for the HDS Chat preview APK.
#
# Runs ONLY against the dedicated test emulator HDS_Test_API35 — refuses any
# non-emulator serial and verifies the AVD name before touching the device.
# It never clears app data, never uninstalls, never submits the login form, and
# makes no production API calls beyond what the Login screen itself issues.
#
# Usage:  ./scripts/test-emulator-smoke.sh [emulator-serial]
#         default serial: emulator-5554
#
# Requires: adb (platform-tools), maestro (https://maestro.mobile.dev), the app
# installed on the emulator. Evidence lands in /tmp/hds-device-smoke-<ts>/.
set -euo pipefail

SERIAL="${1:-emulator-5554}"
AVD_EXPECTED="HDS_Test_API35"
APP_ID="za.co.hdsgroup.chat"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOW="$ROOT/.maestro/unauthenticated-smoke.yaml"
OUT="/tmp/hds-device-smoke-$(date +%Y%m%d-%H%M%S)"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$HOME/.maestro/bin:$ANDROID_HOME/platform-tools:$PATH"

die() { echo "smoke: $*" >&2; exit 1; }

# ---- tool checks ------------------------------------------------------------
command -v adb >/dev/null     || die "adb not found (platform-tools)"
command -v maestro >/dev/null || die "maestro not found (~/.maestro/bin)"
[ -f "$FLOW" ]                || die "flow missing: $FLOW"

# ---- emulator-only guard ----------------------------------------------------
[[ "$SERIAL" =~ ^emulator-[0-9]+$ ]] \
  || die "serial '$SERIAL' is not an emulator serial — refusing to run on a physical/unknown device"
ADB=(adb -s "$SERIAL")
AVD_NAME="$("${ADB[@]}" emu avd name 2>/dev/null | head -1 | tr -d '[:space:]')" \
  || die "cannot query avd name on $SERIAL"
[ "$AVD_NAME" = "$AVD_EXPECTED" ] \
  || die "AVD name '$AVD_NAME' != '$AVD_EXPECTED' — refusing to run"
echo "smoke: verified $SERIAL is AVD $AVD_EXPECTED"

"${ADB[@]}" shell pm list packages "$APP_ID" | grep -q "$APP_ID" \
  || die "$APP_ID not installed on $SERIAL — install the preview APK first"
[ "$("${ADB[@]}" shell getprop sys.boot_completed | tr -d '[:space:]')" = "1" ] \
  || die "emulator not fully booted"

mkdir -p "$OUT"
echo "smoke: evidence dir $OUT"

# ---- night-mode control (cmd uimode is the authoritative switch) ------------
night_now() { "${ADB[@]}" shell cmd uimode night | tr -d '[:space:]'; }  # "Night mode: no|yes|auto"
PRIOR_NIGHT="$(night_now)"
PRIOR_KEY="$("${ADB[@]}" shell settings get secure ui_night_mode 2>/dev/null | tr -d '[:space:]')"
case "$PRIOR_NIGHT" in
  *:no|*:yes|*:auto) ;;
  *) die "cannot parse current night mode '$PRIOR_NIGHT' — refusing to mutate" ;;
esac
cleanup() {
  case "$PRIOR_NIGHT" in
    *:no|*:yes|*:auto) "${ADB[@]}" shell cmd uimode night "${PRIOR_NIGHT##*:}" >/dev/null 2>&1 \
      || echo "smoke: WARN could not restore prior night mode '$PRIOR_NIGHT'" >&2 ;;
    *) echo "smoke: WARN prior night mode '$PRIOR_NIGHT' unrecognized — not restoring" >&2 ;;
  esac
  # settings key: we never write it, but if it was absent and somehow got set,
  # remove it rather than leave a literal 'null' behind.
  if [ "$PRIOR_KEY" = "null" ] || [ -z "$PRIOR_KEY" ]; then
    "${ADB[@]}" shell settings delete secure ui_night_mode >/dev/null 2>&1 || true
  else
    "${ADB[@]}" shell settings put secure ui_night_mode "$PRIOR_KEY" >/dev/null 2>&1 || true
  fi
  for p in "${LOGCAT_PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
}
LOGCAT_PIDS=()
trap cleanup EXIT

run_pass() {
  local tag="$1" want="$2" want_nightval="$3"
  "${ADB[@]}" shell cmd uimode night "$want" >/dev/null
  sleep 2
  {
    echo "cmd uimode night -> $(night_now)"
    "${ADB[@]}" shell dumpsys uimode
  } > "$OUT/uimode-$tag.txt" 2>&1
  grep -q "Nightmode:$want" "$OUT/uimode-$tag.txt" \
    || die "night mode did not switch to '$want' — see $OUT/uimode-$tag.txt"
  grep -q "mNightMode=$want_nightval" "$OUT/uimode-$tag.txt" \
    || die "dumpsys uimode does not show mNightMode=$want_nightval — see $OUT/uimode-$tag.txt"
  echo "smoke: night mode verified '$want' (dumpsys mNightMode=$want_nightval)"

  "${ADB[@]}" logcat -T 1 -v threadtime > "$OUT/logcat-$tag.txt" &
  local lpid=$!; LOGCAT_PIDS+=("$lpid")

  set +e
  maestro test --device "$SERIAL" -e "DARK_MODE_TAG=$tag" \
      --format junit --output "$OUT/maestro-$tag.xml" "$FLOW" \
      > "$OUT/maestro-$tag.log" 2>&1
  local rc=$?
  set -e

  kill "$lpid" 2>/dev/null || true
  wait "$lpid" 2>/dev/null || true

  # Maestro's own tagged screenshots (login-<tag>.png etc.) live in the newest run
  # dir ~/.maestro/tests/<ts>/unauthenticated-smoke/takeScreenshot/ — not copied
  # here to avoid clobbering with stale runs; screen-$tag.png/uidump are reliable.
  "${ADB[@]}" exec-out screencap -p > "$OUT/screen-$tag.png" || true
  "${ADB[@]}" shell uiautomator dump /sdcard/uidump-$tag.xml >/dev/null 2>&1 \
    && "${ADB[@]}" pull /sdcard/uidump-$tag.xml "$OUT/uidump-$tag.xml" >/dev/null 2>&1 || true
  echo "smoke: pass '$tag' rc=$rc -> $OUT"
  return $rc
}

rc=0
run_pass light no  1 || rc=$?
run_pass dark  yes 2 || rc=$?

# ---- crash scan (broad: whole-logcat grep for fatal lines, app-pid context) --
grep -ahE "FATAL EXCEPTION|Fatal signal" "$OUT"/logcat-*.txt > "$OUT/fatal-scan.txt" 2>/dev/null || true
if [ -s "$OUT/fatal-scan.txt" ]; then
  echo "smoke: fatal lines found (broad scan — see $OUT/fatal-scan.txt for process context)" >&2
  rc=1
fi

echo "smoke: done rc=$rc evidence=$OUT"
exit "$rc"
