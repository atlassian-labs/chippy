#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://127.0.0.1:7823/__chippy"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HELPER_ENTRY="$SCRIPT_DIR/chippy-helper-server.js"
HELPER_TOKEN_FILE="${CHIPPY_STATE_DIR:-$HOME/.chippy}/helper-7823.token"
AUTH_HEADER=()
CURL_OPTS=(-fsS)

AUTH_HEADER_FILE=""

# The helper writes its access token after it starts listening. Reload it after
# starting the helper; CHIPPY_HELPER_TOKEN overrides the file. curl reads the
# header from a private file so the token does not appear in the process list.
load_helper_token() {
  local token="${CHIPPY_HELPER_TOKEN:-}"
  if [[ -z "$token" && -r "$HELPER_TOKEN_FILE" ]]; then
    token=$(tr -d '[:space:]' <"$HELPER_TOKEN_FILE")
  fi
  AUTH_HEADER=()
  if [[ -n "$token" ]]; then
    if [[ -z "$AUTH_HEADER_FILE" ]]; then
      AUTH_HEADER_FILE=$(mktemp "${TMPDIR:-/tmp}/chippy-auth.XXXXXX")
      trap 'rm -f "$AUTH_HEADER_FILE"' EXIT
    fi
    printf 'X-Chippy-Token: %s\n' "$token" >"$AUTH_HEADER_FILE"
    AUTH_HEADER=(-H "@$AUTH_HEADER_FILE")
  fi
  CURL_OPTS=(-fsS ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"})
}
load_helper_token

usage() {
  cat <<'EOF'
Usage:
  ./scripts/chippy.sh start [--host <address>]
  ./scripts/chippy.sh stop
  ./scripts/chippy.sh health
  ./scripts/chippy.sh inject-url
  ./scripts/chippy.sh recipes <query...> [--limit N]
  ./scripts/chippy.sh pages [slice]
  ./scripts/chippy.sh recent-pages
  ./scripts/chippy.sh page <clientId> [slice]
  ./scripts/chippy.sh snapshot <clientId> [slice]
  ./scripts/chippy.sh request-snapshot <clientId>
  ./scripts/chippy.sh wait <clientId> [timeoutSeconds]
  ./scripts/chippy.sh activate <clientId>
  ./scripts/chippy.sh deactivate <clientId>
  ./scripts/chippy.sh context-ui <clientId> <on|off>
  ./scripts/chippy.sh ensure-probes <clientId>
  ./scripts/chippy.sh clear-probes <clientId>
  ./scripts/chippy.sh show-status <clientId> <text>
  ./scripts/chippy.sh hide-status <clientId>
  ./scripts/chippy.sh command <type> [clientId]
  ./scripts/chippy.sh get-computed-style <clientId> <probeId> [parentLevel] [selector]
  ./scripts/chippy.sh probe-dom <clientId> <probeId> [parentLevel]
  ./scripts/chippy.sh probe-parents <clientId> <probeId> [max]
  ./scripts/chippy.sh probe-boundaries <clientId> <probeId> [max]
  ./scripts/chippy.sh probe-owners <clientId> <probeId>
  ./scripts/chippy.sh probe-owner <clientId> <probeId> <ownerIndex>
  ./scripts/chippy.sh probe-props <clientId> <probeId> [ownerIndex]
  ./scripts/chippy.sh probe-prop-value <clientId> <probeId> <propName> [ownerIndex]
  ./scripts/chippy.sh probe-hooks <clientId> <probeId>
  ./scripts/chippy.sh probe-hooks-summary <clientId> <probeId>
  ./scripts/chippy.sh page-click <clientId> <selector|probeId|fiberId>
  ./scripts/chippy.sh fiber-prop-contract <clientId> <fiberId> <propName>
  ./scripts/chippy.sh fiber-invoke <clientId> <fiberId> <propName> [--args JSON]
  ./scripts/chippy.sh fiber-schedule-update <clientId> <fiberId> [--ownerIndex N]
  ./scripts/chippy.sh find-fibers <clientId> [--name regex] [--file regex] [--prop name] [--testid regex] [--text regex] [--max N]
  ./scripts/chippy.sh fiber-state-capture <clientId> [label] [maxFibers]
  ./scripts/chippy.sh fiber-state-list
  ./scripts/chippy.sh fiber-state-compare <beforeCaptureId> <afterCaptureId> [maxChanges]
  ./scripts/chippy.sh page-boundaries <clientId> [max]
  ./scripts/chippy.sh inspect-fiber-hooks <clientId> <fiberId>
  ./scripts/chippy.sh inspect-fiber-hooks-summary <clientId> <fiberId>
  ./scripts/chippy.sh inspect-fiber-props <clientId> <fiberId>
  ./scripts/chippy.sh inspect-fiber-owners <clientId> <fiberId>
  ./scripts/chippy.sh inspect-fiber-parents <clientId> <fiberId> [max]
  ./scripts/chippy.sh inspect-fiber-boundaries <clientId> <fiberId> [max]
  ./scripts/chippy.sh inspect-fiber-structure <clientId> <fiberId> <hookIndex> [windowSize]
  ./scripts/chippy.sh describe-component <clientId> <fiberIdOrName> [--text|--json]
  ./scripts/chippy.sh explain-component <clientId> <probeId|fiberId|name> [--text|--json|--complexity]
  ./scripts/chippy.sh avalanche-clear <clientId>
  ./scripts/chippy.sh avalanche-status <clientId>
  ./scripts/chippy.sh avalanche-export <clientId> [lastN]
  ./scripts/chippy.sh avalanche-hot-sources <clientId> [limit]
  ./scripts/chippy.sh avalanche-commit-list <clientId> [top] [by]
  ./scripts/chippy.sh avalanche-commit-peek <clientId> <commitId> [include] [depth] [maxItems]
  ./scripts/chippy.sh avalanche-describe-action <clientId> <actionId>
  ./scripts/chippy.sh avalanche-install <clientId> [detectionMode]
  ./scripts/chippy.sh avalanche-recapture <clientId> [detectionMode]
  ./scripts/chippy.sh avalanche-debug-hook <clientId> <sourceId> <hookIndex> [window]
  ./scripts/chippy.sh avalanche-save <clientId> <file> [count]
  ./scripts/chippy.sh avalanche-offline <file> <summary|commit-list|commit-peek|hot-sources|describe-action|source-search> [args...]
  ./scripts/chippy.sh eval-page <clientId> <snippet-file-or-name> [--key value ...]
  ./scripts/chippy.sh eval-snippets
  ./scripts/chippy.sh avalanche-arm <clientId> <origin> [maxCommits] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]
  ./scripts/chippy.sh avalanche-disarm <clientId> <origin>
  ./scripts/chippy.sh page-reload <clientId>
  ./scripts/chippy.sh page-wait-reload <clientId> [timeoutMs]
  ./scripts/chippy.sh reload-with-avalanche <clientId> <origin> [maxCommits] [timeoutMs] [settleMs] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]
  ./scripts/chippy.sh handoff-to-playwright <clientId> [url] [probeIdsCsv] [browserName] [headless]
  ./scripts/chippy.sh proxy-state
   ./scripts/chippy.sh proxy-start <targetPort> [originalUrl]
  ./scripts/chippy.sh proxy-stop

Notes:
  - Base URL is fixed to http://127.0.0.1:7823/__chippy.
  - recipes searches the local task corpus and does not contact the helper.
  - slice is one of: minimal, standard, full.
  - wait performs one cancellable long poll; it does not install or modify host hooks.
  - Prefer the explicit subcommands over the generic 'command' form.
EOF
}

post_avalanche() {
  local client_id="$1"
  local body="$2"
  post_json "/api/pages/$client_id/avalanche" "$body"
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

helper_is_up() {
  curl "${CURL_OPTS[@]}" "$BASE_URL/health" >/dev/null 2>&1
}

# Binds 127.0.0.1 unless --host or CHIPPY_HELPER_HOST asks for a wider address.
start_helper() {
  local bind_host="${CHIPPY_HELPER_HOST:-127.0.0.1}"
  if [[ "${1:-}" == "--host" ]]; then
    bind_host="${2:?--host needs an address, for example 0.0.0.0}"
  fi
  if helper_is_up; then
    echo "Chippy helper already up at $BASE_URL; stop it first to change the bind address" >&2
    curl "${CURL_OPTS[@]}" "$BASE_URL/health"
    return 0
  fi

  mkdir -p .agents
  nohup node "$HELPER_ENTRY" --host "$bind_host" --port 7823 >/dev/null 2>&1 &
  local pid=$!

  for _ in $(seq 1 40); do
    if helper_is_up; then
      load_helper_token
      echo "Chippy helper started (pid $pid)" >&2
      curl "${CURL_OPTS[@]}" "$BASE_URL/health"
      return 0
    fi
    sleep 0.25
  done

  echo "Failed to start Chippy helper." >&2
  return 1
}

stop_helper() {
  local helper_pattern="chippy-helper-server.js .*--port 7823"
  if ! pgrep -f "$helper_pattern" >/dev/null 2>&1; then
    echo "Chippy helper is not running" >&2
    return 0
  fi

  pkill -f "$helper_pattern" >/dev/null 2>&1 || true

  for _ in $(seq 1 20); do
    if ! helper_is_up; then
      echo "Chippy helper stopped" >&2
      return 0
    fi
    sleep 0.25
  done

  echo "Timed out waiting for Chippy helper to stop" >&2
  return 1
}

run_curl() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local response_file stderr_file http_code code stderr_text
  response_file=$(mktemp)
  stderr_file=$(mktemp)
  set +e
  if [[ "$method" == "POST" ]]; then
    http_code=$(curl -sS -o "$response_file" -w '%{http_code}' ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} -X POST "$url" -H 'Content-Type: application/json' -d "$body" 2>"$stderr_file")
  else
    http_code=$(curl -sS -o "$response_file" -w '%{http_code}' ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} "$url" 2>"$stderr_file")
  fi
  code=$?
  set -e
  stderr_text=$(cat "$stderr_file" 2>/dev/null || true)

  if [[ $code -eq 0 && "$http_code" -lt 400 ]]; then
    cat "$response_file"
    rm -f "$response_file" "$stderr_file"
    return 0
  fi

  case "$code" in
    7)
      echo "Chippy helper request failed." >&2
      echo "  observed: curl_exit=7 request='$method $url'" >&2
      echo "  meaning: could not connect to helper at $BASE_URL" >&2
      echo "  next: start helper with ./.agents/skills/chippy/scripts/chippy.sh start" >&2
      ;;
    28)
      echo "Chippy helper request failed." >&2
      echo "  observed: curl_exit=28 request='$method $url'" >&2
      echo "  meaning: HTTP request itself timed out before a response completed" >&2
      echo "  next: retry, then check helper and page responsiveness with pages / request-snapshot" >&2
      ;;
    *)
      if [[ "$http_code" == "504" ]]; then
        echo "Chippy helper request failed." >&2
        echo "  observed: http_status=504 request='$method $url'" >&2
        echo "  meaning: helper answered the HTTP request, but timed out while waiting for an upstream result" >&2
        echo "  upstream in this setup is usually the connected page/runtime" >&2
        echo "  next: verify lighter round-trips first (pages, request-snapshot, avalanche-status) before retrying this command" >&2
      elif [[ "$http_code" =~ ^5 ]]; then
        echo "Chippy helper request failed." >&2
        echo "  observed: http_status=$http_code request='$method $url'" >&2
        echo "  meaning: helper returned a server error" >&2
      elif [[ "$http_code" == "401" ]]; then
        echo "Chippy helper request failed." >&2
        echo "  observed: http_status=401 request='$method $url'" >&2
        echo "  meaning: helper requires its access token and none matched" >&2
        echo "  next: the running helper writes its token to $HELPER_TOKEN_FILE; restart it with stop/start if that file is missing or stale, or set CHIPPY_HELPER_TOKEN" >&2
      elif [[ "$http_code" =~ ^4 ]]; then
        echo "Chippy helper request failed." >&2
        echo "  observed: http_status=$http_code request='$method $url'" >&2
        echo "  meaning: helper rejected the request" >&2
      else
        echo "Chippy helper request failed." >&2
        echo "  observed: curl_exit=$code request='$method $url'" >&2
        echo "  meaning: curl failed before a successful helper response was received" >&2
      fi
      ;;
  esac
  if [[ -n "$stderr_text" ]]; then
    echo "  → curl: $stderr_text" >&2
  fi
  rm -f "$response_file" "$stderr_file"
  if [[ "$http_code" =~ ^[0-9]+$ && "$http_code" -ge 400 ]]; then
    return 22
  fi
  return "$code"
}

post_json() {
  local path="$1"
  local body="$2"
  run_curl POST "$BASE_URL$path" "$body"
}

print_probe_result_text() {
  node "$SCRIPT_DIR/format-probe-result.js" "$1"
}

get_json() {
  local path="$1"
  run_curl GET "$BASE_URL$path"
}

send_command() {
  local type="$1"
  local client_id="${2:-}"
  local extra_json="${3:-}"
  local body

  body="{"
  if [[ -n "$client_id" ]]; then
    body+="\"clientId\":$(json_escape "$client_id"),"
  fi
  body+="\"command\":{\"type\":$(json_escape "$type")"

  if [[ -n "$extra_json" ]]; then
    body+="${extra_json}"
  fi

  body+="}}"
  post_json "/api/command" "$body"
}

cmd="${1:-}"
case "$cmd" in
  ""|-h|--help|help)
    usage
    ;;
  start)
    start_helper "${@:2}"
    ;;
  stop)
    stop_helper
    ;;
  health)
    curl "${CURL_OPTS[@]}" "$BASE_URL/health"
    ;;
  inject-url)
    echo "Import integration is document-scoped: a full reload/navigation removes Chippy and requires the user or automation to inject it again." >&2
    printf '%s/inject.js\n' "$BASE_URL"
    ;;
  recipes)
    shift
    node "$SCRIPT_DIR/search-recipes.js" "$SCRIPT_DIR/../references/recipes.txt" "$@"
    ;;
  pages)
    slice="${2:-minimal}"
    curl "${CURL_OPTS[@]}" "$BASE_URL/api/pages?slice=$slice"
    ;;
  recent-pages)
    curl "${CURL_OPTS[@]}" "$BASE_URL/api/recent-pages"
    ;;
  page)
    client_id="${2:-}"
    slice="${3:-standard}"
    if [[ -z "$client_id" ]]; then
      echo "page requires <clientId>" >&2
      exit 1
    fi
    curl "${CURL_OPTS[@]}" "$BASE_URL/api/pages/$client_id?slice=$slice"
    ;;
  snapshot)
    client_id="${2:-}"
    slice="${3:-standard}"
    if [[ -z "$client_id" ]]; then
      echo "snapshot requires <clientId> [slice]" >&2
      exit 1
    fi
    get_json "/api/pages/$client_id/snapshot?slice=$slice"
    ;;
  request-snapshot)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "request-snapshot requires <clientId>" >&2
      exit 1
    fi
    post_json "/api/pages/$client_id/snapshot" '{}'
    ;;
  wait)
    client_id="${2:-}"
    timeout_seconds="${3:-300}"
    if [[ -z "$client_id" ]]; then
      echo "wait requires <clientId> [timeoutSeconds]" >&2
      exit 1
    fi
    if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || (( timeout_seconds > 1800 )); then
      echo "timeoutSeconds must be an integer from 1 through 1800" >&2
      exit 1
    fi
    get_json "/api/pages/$client_id/probe-annotations/wait?timeoutMs=$((timeout_seconds * 1000))"
    ;;
  activate)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "activate requires <clientId>" >&2
      exit 1
    fi
    send_command "activate" "$client_id"
    ;;
  deactivate)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "deactivate requires <clientId>" >&2
      exit 1
    fi
    send_command "deactivate" "$client_id"
    ;;
  context-ui)
    command_name="$1"
    client_id="${2:-}"
    mode="${3:-}"
    if [[ -z "$client_id" || -z "$mode" ]]; then
      echo "$command_name requires <clientId> <on|off>" >&2
      exit 1
    fi
    case "$mode" in
      on|true|1) enabled=true ;;
      off|false|0) enabled=false ;;
      *)
        echo "$command_name mode must be on or off" >&2
        exit 1
        ;;
    esac
    send_command "set-context-ui" "$client_id" ",\"enabled\":$enabled"
    ;;
  ensure-probes)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "ensure-probes requires <clientId>" >&2
      exit 1
    fi
    send_command "ensure-probes" "$client_id"
    ;;
  clear-probes)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "clear-probes requires <clientId>" >&2
      exit 1
    fi
    send_command "clear-probes" "$client_id"
    ;;
  show-status)
    client_id="${2:-}"
    text="${3:-}"
    if [[ -z "$client_id" || -z "$text" ]]; then
      echo "show-status requires <clientId> <text>" >&2
      exit 1
    fi
    send_command "show-status" "$client_id" ",\"text\":$(json_escape "$text")"
    ;;
  hide-status)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "hide-status requires <clientId>" >&2
      exit 1
    fi
    send_command "hide-status" "$client_id"
    ;;
  command)
    type="${2:-}"
    client_id="${3:-}"
    if [[ -z "$type" ]]; then
      echo "command requires <type> [clientId]" >&2
      exit 1
    fi
    send_command "$type" "$client_id"
    ;;
  get-computed-style)
    client_id="${2:-}"
    probe_id="${3:-}"
    parent_level="${4:-0}"
    selector="${5:-}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "get-computed-style requires <clientId> <probeId> [parentLevel] [selector]" >&2
      exit 1
    fi
    if [[ -n "$selector" ]]; then
      body="{\"probeId\":$(json_escape "$probe_id"),\"parentLevel\":$parent_level,\"selector\":$(json_escape "$selector")}"
    else
      body="{\"probeId\":$(json_escape "$probe_id"),\"parentLevel\":$parent_level}"
    fi
    post_json "/api/pages/$client_id/computed-style" "$body"
    ;;
  probe-dom)
    # Usage: probe-dom <clientId> <probeId> [parentLevel]
    client_id="${2:-}"
    probe_id="${3:-}"
    parent_level="${4:-0}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-dom requires <clientId> <probeId> [parentLevel]" >&2
      exit 1
    fi
    body="{\"command\":\"eval-probe-dom\",\"probeId\":$(json_escape "$probe_id"),\"parentLevel\":$parent_level}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  probe-parents)
    client_id="${2:-}"
    probe_id="${3:-}"
    max="${4:-50}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-parents requires <clientId> <probeId> [max]" >&2
      exit 1
    fi
    if [[ ! "$max" =~ ^[0-9]+$ ]]; then
      echo "max must be a non-negative integer" >&2
      exit 1
    fi
    body="{\"command\":\"eval-probe-parents\",\"probeId\":$(json_escape "$probe_id"),\"max\":$max}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  probe-boundaries)
    client_id="${2:-}"
    probe_id="${3:-}"
    max="${4:-100}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-boundaries requires <clientId> <probeId> [max]" >&2
      exit 1
    fi
    if [[ ! "$max" =~ ^[1-9][0-9]*$ ]]; then
      echo "max must be a positive integer" >&2
      exit 1
    fi
    body="{\"command\":\"eval-probe-boundaries\",\"probeId\":$(json_escape "$probe_id"),\"max\":$max}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  probe-owners)
    client_id="${2:-}"
    probe_id="${3:-}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-owners requires <clientId> <probeId>" >&2
      exit 1
    fi
    get_json "/api/pages/$client_id/probe/$probe_id/owners"
    ;;
  probe-owner)
    client_id="${2:-}"
    probe_id="${3:-}"
    owner_index="${4:-}"
    if [[ -z "$client_id" || -z "$probe_id" || -z "$owner_index" ]]; then
      echo "probe-owner requires <clientId> <probeId> <ownerIndex>" >&2
      exit 1
    fi
    get_json "/api/pages/$client_id/probe/$probe_id/owners/$owner_index"
    ;;
  probe-props)
    # Usage: probe-props <clientId> <probeId> [ownerIndex]
    # ownerIndex: 0 = immediate owner, 1 = next owner up, etc.
    client_id="${2:-}"
    probe_id="${3:-}"
    owner_index="${4:-}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-props requires <clientId> <probeId> [ownerIndex]" >&2
      exit 1
    fi
    if [[ -n "$owner_index" && ! "$owner_index" =~ ^-?[0-9]+$ ]]; then
      echo "ownerIndex must be an integer" >&2
      exit 1
    fi
    if [[ -n "$owner_index" ]]; then
      body="{\"command\":\"eval-probe-props\",\"probeId\":$(json_escape "$probe_id"),\"ownerIndex\":$owner_index}"
    else
      body="{\"command\":\"eval-probe-props\",\"probeId\":$(json_escape "$probe_id")}"
    fi
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  probe-prop-value)
    # Usage: probe-prop-value <clientId> <probeId> <propName> [ownerIndex]
    # ownerIndex: 0 = immediate owner, 1 = next owner up, etc.
    client_id="${2:-}"
    probe_id="${3:-}"
    prop_name="${4:-}"
    owner_index="${5:-}"
    if [[ -z "$client_id" || -z "$probe_id" || -z "$prop_name" ]]; then
      echo "probe-prop-value requires <clientId> <probeId> <propName> [ownerIndex]" >&2
      exit 1
    fi
    if [[ -n "$owner_index" && ! "$owner_index" =~ ^-?[0-9]+$ ]]; then
      echo "ownerIndex must be an integer" >&2
      exit 1
    fi
    if [[ -n "$owner_index" ]]; then
      body="{\"command\":\"eval-prop-value\",\"probeId\":$(json_escape "$probe_id"),\"prop\":$(json_escape "$prop_name"),\"ownerIndex\":$owner_index}"
    else
      body="{\"command\":\"eval-prop-value\",\"probeId\":$(json_escape "$probe_id"),\"prop\":$(json_escape "$prop_name")}"
    fi
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  probe-hooks)
    client_id="${2:-}"
    probe_id="${3:-}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-hooks requires <clientId> <probeId>" >&2
      exit 1
    fi
    body="{\"command\":\"eval-probe-hooks\",\"probeId\":$(json_escape "$probe_id")}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  probe-hooks-summary)
    client_id="${2:-}"
    probe_id="${3:-}"
    if [[ -z "$client_id" || -z "$probe_id" ]]; then
      echo "probe-hooks-summary requires <clientId> <probeId>" >&2
      exit 1
    fi
    body="{\"command\":\"eval-probe-hooks-summary\",\"probeId\":$(json_escape "$probe_id")}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  page-click)
    client_id="${2:-}"
    target_raw="${3:-}"
    shift 3 || true
    if [[ -z "$client_id" || -z "$target_raw" ]]; then
      echo "page-click requires <clientId> <selector|probeId|fiberId>" >&2
      exit 1
    fi
    if [[ $# -gt 0 ]]; then
      echo "page-click does not support extra options; selector must resolve to exactly one target" >&2
      exit 1
    fi
    if [[ "$target_raw" =~ ^[Pp]?[123]$ ]]; then
      probe_id="${target_raw#[Pp]}"
      body='{"probeId":'"$(json_escape "$probe_id")"'}'
    elif [[ "$target_raw" =~ ^fiber:[0-9]+$ ]]; then
      body='{"fiberId":'"${target_raw#fiber:}"'}'
    elif [[ "$target_raw" =~ ^[0-9]+$ ]]; then
      body='{"fiberId":'"$target_raw"'}'
    else
      body='{"selector":'"$(json_escape "$target_raw")"'}'
    fi
    post_json "/api/pages/$client_id/page-click" "$body"
    ;;
  fiber-prop-contract)
    client_id="${2:-}"
    fiber_id="${3:-}"
    fiber_id="${fiber_id#fiber:}"
    prop_name="${4:-}"
    shift 4 || true
    if [[ -z "$client_id" || -z "$fiber_id" || -z "$prop_name" ]]; then
      echo "fiber-prop-contract requires <clientId> <fiberId> <propName>" >&2
      exit 1
    fi
    if [[ $# -gt 0 ]]; then
      echo "fiber-prop-contract does not support extra options" >&2
      exit 1
    fi
    post_json "/api/pages/$client_id/fiber-prop-contract" '{"fiberId":'"$fiber_id"',"propName":'"$(json_escape "$prop_name")"'}'
    ;;
  fiber-invoke)
    client_id="${2:-}"
    fiber_id="${3:-}"
    fiber_id="${fiber_id#fiber:}"
    prop_name="${4:-}"
    shift 4 || true
    if [[ -z "$client_id" || -z "$fiber_id" || -z "$prop_name" ]]; then
      echo "fiber-invoke requires <clientId> <fiberId> <propName> [--args JSON]" >&2
      exit 1
    fi
    args='[]'
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --args)
          if [[ $# -lt 2 ]]; then
            echo "missing value for --args" >&2
            exit 1
          fi
          args="$2"
          shift
          ;;
        *) echo "unknown option for fiber-invoke: $1" >&2; exit 1 ;;
      esac
      shift
    done
    post_json "/api/pages/$client_id/fiber-invoke" '{"fiberId":'"$fiber_id"',"propName":'"$(json_escape "$prop_name")"',"args":'"$args"'}'
    ;;
  fiber-schedule-update)
    client_id="${2:-}"
    fiber_id="${3:-}"
    fiber_id="${fiber_id#fiber:}"
    shift 3 || true
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "fiber-schedule-update requires <clientId> <fiberId> [--ownerIndex N]" >&2
      exit 1
    fi
    owner_index=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --ownerIndex)
          if [[ $# -lt 2 ]]; then
            echo "missing value for --ownerIndex" >&2
            exit 1
          fi
          owner_index="$2"
          shift
          ;;
        *) echo "unknown option for fiber-schedule-update: $1" >&2; exit 1 ;;
      esac
      shift
    done
    post_json "/api/pages/$client_id/fiber-schedule-update" '{"fiberId":'"$(json_escape "$fiber_id")"',"ownerIndex":'"$owner_index"'}'
    ;;
  find-fibers)
    client_id="${2:-}"
    shift 2 || true
    if [[ -z "$client_id" ]]; then
      echo "find-fibers requires <clientId> [--name regex] [--file regex] [--prop name] [--testid regex] [--text regex] [--max N]" >&2
      exit 1
    fi
    filters='{}'
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == --* ]]; then
        k="${1#--}"; v="${2:-}"; shift 2
        filters=$(node -e 'const o=JSON.parse(process.argv[1]);o[process.argv[2]]=process.argv[3];process.stdout.write(JSON.stringify(o));' "$filters" "$k" "$v") || exit 1
      else shift; fi
    done
    body=$(node -e 'process.stdout.write(JSON.stringify({command:"find-fibers",filters:JSON.parse(process.argv[1])}))' "$filters") || exit 1
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  fiber-state-capture)
    client_id="${2:-}"
    label="${3:-}"
    max_fibers="${4:-100000}"
    if [[ -z "$client_id" ]]; then
      echo "fiber-state-capture requires <clientId> [label] [maxFibers]" >&2
      exit 1
    fi
    if [[ ! "$max_fibers" =~ ^[1-9][0-9]*$ ]]; then
      echo "maxFibers must be a positive integer" >&2
      exit 1
    fi
    body="{\"label\":$(json_escape "$label"),\"maxFibers\":$max_fibers}"
    post_json "/api/pages/$client_id/fiber-state-captures" "$body"
    ;;
  fiber-state-list)
    get_json "/api/fiber-state-captures"
    ;;
  fiber-state-compare)
    before_capture_id="${2:-}"
    after_capture_id="${3:-}"
    max_changes="${4:-200}"
    if [[ -z "$before_capture_id" || -z "$after_capture_id" ]]; then
      echo "fiber-state-compare requires <beforeCaptureId> <afterCaptureId> [maxChanges]" >&2
      exit 1
    fi
    if [[ ! "$max_changes" =~ ^[1-9][0-9]*$ ]]; then
      echo "maxChanges must be a positive integer" >&2
      exit 1
    fi
    body="{\"before\":$(json_escape "$before_capture_id"),\"after\":$(json_escape "$after_capture_id"),\"maxChanges\":$max_changes}"
    post_json "/api/fiber-state-comparisons" "$body"
    ;;
  page-boundaries)
    client_id="${2:-}"
    max="${3:-1000}"
    if [[ -z "$client_id" ]]; then
      echo "page-boundaries requires <clientId> [max]" >&2
      exit 1
    fi
    if [[ ! "$max" =~ ^[1-9][0-9]*$ ]]; then
      echo "max must be a positive integer" >&2
      exit 1
    fi
    body="{\"command\":\"page-boundaries\",\"max\":$max}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-hooks)
    client_id="${2:-}"
    fiber_id="${3:-}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-hooks requires <clientId> <fiberId>" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-hooks\",\"fiberId\":$(json_escape "$fiber_id")}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-hooks-summary)
    client_id="${2:-}"
    fiber_id="${3:-}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-hooks-summary requires <clientId> <fiberId>" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-hooks-summary\",\"fiberId\":$(json_escape "$fiber_id")}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-props)
    client_id="${2:-}"
    fiber_id="${3:-}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-props requires <clientId> <fiberId>" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-props\",\"fiberId\":$(json_escape "$fiber_id")}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-owners)
    client_id="${2:-}"
    fiber_id="${3:-}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-owners requires <clientId> <fiberId>" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-owners\",\"fiberId\":$(json_escape "$fiber_id")}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-parents)
    client_id="${2:-}"
    fiber_id="${3:-}"
    max="${4:-50}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-parents requires <clientId> <fiberId> [max]" >&2
      exit 1
    fi
    if [[ ! "$max" =~ ^[0-9]+$ ]]; then
      echo "max must be a non-negative integer" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-parents\",\"fiberId\":$(json_escape "$fiber_id"),\"max\":$max}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-boundaries)
    client_id="${2:-}"
    fiber_id="${3:-}"
    max="${4:-100}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-boundaries requires <clientId> <fiberId> [max]" >&2
      exit 1
    fi
    if [[ ! "$max" =~ ^[1-9][0-9]*$ ]]; then
      echo "max must be a positive integer" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-boundaries\",\"fiberId\":$(json_escape "$fiber_id"),\"max\":$max}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  inspect-fiber-structure)
    client_id="${2:-}"
    fiber_id="${3:-}"
    hook_index="${4:-0}"
    window_size="${5:-3}"
    if [[ -z "$client_id" || -z "$fiber_id" ]]; then
      echo "inspect-fiber-structure requires <clientId> <fiberId> <hookIndex> [windowSize]" >&2
      exit 1
    fi
    body="{\"command\":\"inspect-fiber-structure\",\"fiberId\":$(json_escape "$fiber_id"),\"hookIndex\":$hook_index,\"windowSize\":$window_size}"
    post_json "/api/pages/$client_id/eval-probe" "$body"
    ;;
  describe-component)
    # Usage: describe-component <clientId> <fiberIdOrName> [--text|--json]
    # If arg starts with "fiber:" → resolve from registry; else treat as component name.
    client_id="${2:-}"
    target="${3:-}"
    view="${4:---text}"
    if [[ -z "$client_id" || -z "$target" ]]; then
      echo "describe-component requires <clientId> <fiberIdOrName> [--text|--json]" >&2
      exit 1
    fi
    if [[ "$view" != "--text" && "$view" != "--json" ]]; then
      echo "describe-component view must be --text or --json" >&2
      exit 1
    fi
    if [[ "$target" == fiber:* ]]; then
      body="{\"command\":\"describe-component\",\"fiberId\":$(json_escape "$target")}"
    else
      body="{\"command\":\"describe-component\",\"name\":$(json_escape "$target")}"
    fi
    response=$(post_json "/api/pages/$client_id/eval-probe" "$body")
    print_probe_result_text "${view#--}" <<<"$response"
    ;;
  explain-component)
    # Usage: explain-component <clientId> <probeId|fiberId|name> [--text|--json|--complexity]
    # Default --text prints semantic sections as plain text; --json preserves the full raw payload.
    client_id="${2:-}"
    target="${3:-}"
    view="${4:---text}"
    if [[ -z "$client_id" || -z "$target" ]]; then
      echo "explain-component requires <clientId> <probeId|fiberId|name> [--text|--json|--complexity]" >&2
      exit 1
    fi
    if [[ "$view" != "--text" && "$view" != "--json" && "$view" != "--complexity" ]]; then
      echo "explain-component view must be --text, --json, or --complexity" >&2
      exit 1
    fi
    if [[ "$target" =~ ^[0-9]+$ ]]; then
      body="{\"command\":\"explain-component\",\"probeId\":$(json_escape "$target")}"
    elif [[ "$target" == fiber:* ]]; then
      body="{\"command\":\"explain-component\",\"fiberId\":$(json_escape "$target")}"
    else
      body="{\"command\":\"explain-component\",\"name\":$(json_escape "$target")}"
    fi
    response=$(post_json "/api/pages/$client_id/eval-probe" "$body")
    print_probe_result_text "${view#--}" <<<"$response"
    ;;
  # NOTE: avalanche-start / avalanche-stop are removed in the upstream-shape bridge.
  # The detector auto-installs on bundle eval; there is no pause/resume API. Use
  # avalanche-clear (alias to upstream reset) to drop history.
  avalanche-clear)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-clear requires <clientId>" >&2
      exit 1
    fi
    post_avalanche "$client_id" '{"action":"clear"}'
    ;;
  avalanche-status)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-status requires <clientId>" >&2
      exit 1
    fi
    post_avalanche "$client_id" '{"action":"status"}'
    ;;
  avalanche-export)
    client_id="${2:-}"
    last_n="${3:-}"
    out_file="${4:-}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-export requires <clientId> [lastN] [outFile]" >&2
      exit 1
    fi
    if [[ -n "$last_n" ]]; then
      payload=$(post_avalanche "$client_id" "{\"action\":\"export-last\",\"count\":$last_n}")
    else
      payload=$(post_avalanche "$client_id" '{"action":"export"}')
    fi
    if [[ -n "$out_file" ]]; then
      printf '%s' "$payload" > "$out_file"
      echo "avalanche export written to $out_file" >&2
    else
      printf '%s' "$payload"
    fi
    ;;
  # NOTE: avalanche-metrics / avalanche-help are removed. Upstream surface does
  # not have these. Use avalanche-status for installed/commitCount overview.
  avalanche-hot-sources)
    client_id="${2:-}"
    limit="${3:-}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-hot-sources requires <clientId> [limit]" >&2
      exit 1
    fi
    if [[ -n "$limit" ]]; then
      post_avalanche "$client_id" "{\"action\":\"hot-sources\",\"limit\":$limit}"
    else
      post_avalanche "$client_id" '{"action":"hot-sources"}'
    fi
    ;;
  avalanche-commit-list)
    client_id="${2:-}"
    top="${3:-20}"
    by="${4:-collateral}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-commit-list requires <clientId> [top] [by]" >&2
      echo "  live by ∈ collateral | sources | restarts | performedWork | effects | memos | callbacks | contextUpdates" >&2
      echo "  offline by additionally supports restartProxy | amplifiers | componentRenders | externalStoreRestarts | priorityInterruptions | fiberInterruptions | repeats" >&2
      exit 1
    fi
    post_avalanche "$client_id" "{\"action\":\"commit-list\",\"top\":$top,\"by\":\"$by\"}"
    ;;
  avalanche-commit-peek)
    client_id="${2:-}"
    commit_id="${3:-}"
    include="${4:-stats,sources,timing,metrics}"
    depth="${5:-3}"
    max_items="${6:-20}"
    if [[ -z "$client_id" || -z "$commit_id" ]]; then
      echo "avalanche-commit-peek requires <clientId> <commitId> [include] [depth] [maxItems]" >&2
      echo "  live include csv ⊆ stats,sources,timing,metrics,unmounts,actions,rendered (atl: alias of metrics)" >&2
      echo "  note: \"rendered\" requires arming with detectionMode=full" >&2
      echo "  offline include csv ⊆ stats,sources,collaterals,context,amplifiers,metrics" >&2
      exit 1
    fi
    include_json="["
    first=1
    IFS=',' read -ra parts <<< "$include"
    for p in "${parts[@]}"; do
      p_trim=$(echo "$p" | tr -d ' ')
      [[ -z "$p_trim" ]] && continue
      if [[ $first -eq 0 ]]; then include_json+=","; fi
      include_json+="\"$p_trim\""
      first=0
    done
    include_json+="]"
    post_avalanche "$client_id" "{\"action\":\"commit-peek\",\"commitId\":$commit_id,\"include\":$include_json,\"depth\":$depth,\"maxItems\":$max_items}"
    ;;
  avalanche-describe-action)
    client_id="${2:-}"
    action_id="${3:-}"
    if [[ -z "$client_id" || -z "$action_id" ]]; then
      echo "avalanche-describe-action requires <clientId> <actionId>" >&2
      exit 1
    fi
    post_avalanche "$client_id" "{\"action\":\"describe-action\",\"actionId\":$action_id}"
    ;;
  avalanche-install)
    client_id="${2:-}"
    detection_mode="${3:-sources}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-install requires <clientId> [detectionMode]" >&2
      exit 1
    fi
    body="{\"action\":\"install\",\"options\":{\"captureFibers\":true,\"detectionMode\":\"$detection_mode\",\"historySize\":1000}}"
    post_avalanche "$client_id" "$body"
    ;;
  avalanche-recapture)
    client_id="${2:-}"
    detection_mode="${3:-sources}"
    if [[ -z "$client_id" ]]; then
      echo "avalanche-recapture requires <clientId> [detectionMode]" >&2
      exit 1
    fi
    body="{\"action\":\"install\",\"options\":{\"captureFibers\":true,\"detectionMode\":\"$detection_mode\",\"historySize\":1000}}"
    post_avalanche "$client_id" "$body" >/dev/null
    post_avalanche "$client_id" '{"action":"clear"}' >/dev/null
    post_avalanche "$client_id" '{"action":"status"}'
    ;;
  avalanche-debug-hook)
    client_id="${2:-}"
    source_id="${3:-}"
    hook_index="${4:-}"
    window_size="${5:-3}"
    if [[ -z "$client_id" || -z "$source_id" || -z "$hook_index" ]]; then
      echo "avalanche-debug-hook requires <clientId> <sourceId> <hookIndex> [window]" >&2
      exit 1
    fi
    source_json=$(json_escape "$source_id")
    post_avalanche "$client_id" "{\"action\":\"debug-hook\",\"sourceId\":$source_json,\"hookIndex\":$hook_index,\"window\":$window_size}"
    ;;
  avalanche-save)
    client_id="${2:-}"
    out_file="${3:-}"
    count="${4:-0}"
    if [[ -z "$client_id" || -z "$out_file" ]]; then
      echo "avalanche-save requires <clientId> <file> [count]" >&2
      echo "  count=0 → full export, count=N → last N commits" >&2
      exit 1
    fi
    if [[ "$count" -gt 0 ]]; then
      body="{\"action\":\"export-last\",\"count\":$count}"
    else
      body='{"action":"export"}'
    fi
    response=$(post_avalanche "$client_id" "$body")
    if [[ -z "$response" ]]; then
      echo "avalanche-save: empty response from helper" >&2
      exit 1
    fi
    payload=$(node "$SCRIPT_DIR/avalanche-analyze.cjs" normalize "$count" <<<"$response") || exit 1
    printf '%s' "$payload" > "$out_file"
    bytes=$(wc -c < "$out_file" | tr -d ' ')
    commits=$(node "$SCRIPT_DIR/avalanche-analyze.cjs" "$out_file" summary | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).commits))')
    echo "{\"ok\":true,\"file\":\"$out_file\",\"bytes\":$bytes,\"commits\":$commits}"
    ;;
  avalanche-offline)
    shift
    if [[ $# -lt 2 ]]; then
      echo "avalanche-offline requires <file> <summary|commit-list|commit-peek|hot-sources|describe-action|source-search> [args...]" >&2
      exit 1
    fi
    node "$SCRIPT_DIR/avalanche-analyze.cjs" "$@"
    ;;
  eval-snippets)
    snip_dir="$SCRIPT_DIR/../snippets"
    if [[ ! -d "$snip_dir" ]]; then echo "no snippets dir at $snip_dir" >&2; exit 1; fi
    ( cd "$snip_dir" && ls -1 *.js 2>/dev/null )
    ;;
  eval-page)
    client_id="${2:-}"
    snippet="${3:-}"
    shift 3 || true
    if [[ -z "$client_id" || -z "$snippet" ]]; then
      echo "eval-page requires <clientId> <snippet-file-or-name> [--key value ...]" >&2
      echo "  snippet may be an absolute path, a path relative to cwd, or a name resolved against $SCRIPT_DIR/../snippets/<name>.js" >&2
      exit 1
    fi
    snip_path=""
    if [[ -f "$snippet" ]]; then snip_path="$snippet"; fi
    if [[ -z "$snip_path" && -f "$SCRIPT_DIR/../snippets/$snippet" ]]; then snip_path="$SCRIPT_DIR/../snippets/$snippet"; fi
    if [[ -z "$snip_path" && -f "$SCRIPT_DIR/../snippets/$snippet.js" ]]; then snip_path="$SCRIPT_DIR/../snippets/$snippet.js"; fi
    if [[ -z "$snip_path" ]]; then echo "snippet not found: $snippet" >&2; exit 1; fi
    # Build args object from --key value pairs.
    args_json='{}'
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == --* ]]; then
        k="${1#--}"; v="${2:-}"; shift 2
        args_json=$(node -e '
          const o = JSON.parse(process.argv[1]);
          const k = process.argv[2];
          let v = process.argv[3];
          if (v === "true") v = true;
          else if (v === "false") v = false;
          else if (!Number.isNaN(Number(v)) && v !== "") v = Number(v);
          o[k] = v;
          process.stdout.write(JSON.stringify(o));
        ' "$args_json" "$k" "$v") || exit 1
      else shift; fi
    done
    src=$(cat "$snip_path")
    body=$(node -e '
      const src = require("fs").readFileSync(process.argv[1], "utf8");
      const args = JSON.parse(process.argv[2]);
      process.stdout.write(JSON.stringify({ source: src, args }));
    ' "$snip_path" "$args_json") || exit 1
    run_curl POST "$BASE_URL/api/pages/$client_id/eval-script" "$body"
    ;;
  avalanche-arm)
    client_id="${2:-}"
    origin="${3:-}"
    max_commits="${4:-}"
    capture_fibers="${5:-true}"
    detection_mode="${6:-sources}"
    if [[ -z "$client_id" || -z "$origin" ]]; then
      echo "avalanche-arm requires <clientId> <origin> [maxCommits] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]" >&2
      exit 1
    fi
    max_commits="${max_commits:-0}"
    if [[ "$capture_fibers" != "true" && "$capture_fibers" != "false" ]]; then
      echo "avalanche-arm captureFibers must be true or false" >&2
      exit 1
    fi
    if [[ "$detection_mode" != "sources" && "$detection_mode" != "full" && "$detection_mode" != "stats" && "$detection_mode" != "amplifiers" ]]; then
      echo "avalanche-arm detectionMode must be sources, full, stats, or amplifiers" >&2
      exit 1
    fi
    body="{\"clientId\":$(json_escape "$client_id"),\"origin\":$(json_escape "$origin"),\"autoStart\":true,\"max\":$max_commits,\"options\":{\"captureFibers\":$capture_fibers,\"detectionMode\":\"$detection_mode\"}}"
    post_json "/api/avalanche-arm" "$body" >/dev/null
    # Reset first (clear prior capture), then install detector — no reload needed
    reset_body="{\"action\":\"reset\"}"
    post_json "/api/pages/$client_id/avalanche" "$reset_body" >/dev/null
    install_body="{\"action\":\"install\",\"options\":{\"captureFibers\":$capture_fibers,\"detectionMode\":\"$detection_mode\"}}"
    post_json "/api/pages/$client_id/avalanche" "$install_body"
    ;;
  avalanche-disarm)
    client_id="${2:-}"
    origin="${3:-}"
    if [[ -z "$client_id" || -z "$origin" ]]; then
      echo "avalanche-disarm requires <clientId> <origin>" >&2
      exit 1
    fi
    body="{\"clientId\":$(json_escape "$client_id"),\"origin\":$(json_escape "$origin"),\"autoStart\":false}"
    post_json "/api/avalanche-arm" "$body"
    ;;
  page-reload)
    client_id="${2:-}"
    if [[ -z "$client_id" ]]; then
      echo "page-reload requires <clientId>" >&2
      exit 1
    fi
    post_json "/api/pages/$client_id/reload" '{}'
    ;;
  page-wait-reload)
    client_id="${2:-}"
    timeout_ms="${3:-5000}"
    if [[ -z "$client_id" ]]; then
      echo "page-wait-reload requires <clientId> [timeoutMs]" >&2
      exit 1
    fi
    body="{\"timeoutMs\":$timeout_ms}"
    post_json "/api/pages/$client_id/wait-reload" "$body"
    ;;
  reload-with-avalanche)
    client_id="${2:-}"
    origin="${3:-}"
    max_commits="${4:-0}"
    timeout_ms="${5:-5000}"
    settle_ms="${6:-3000}"
    capture_fibers="${7:-true}"
    detection_mode="${8:-sources}"
    if [[ -z "$client_id" || -z "$origin" ]]; then
      echo "reload-with-avalanche requires <clientId> <origin> [maxCommits] [timeoutMs] [settleMs] [captureFibers=true|false] [detectionMode=sources|full|stats|amplifiers]" >&2
      exit 1
    fi
    echo "== arm ==" >&2
    "$0" avalanche-arm "$client_id" "$origin" "$max_commits" "$capture_fibers" "$detection_mode"
    echo >&2
    echo "== reload ==" >&2
    "$0" page-reload "$client_id"
    echo >&2
    echo "== wait ==" >&2
    "$0" page-wait-reload "$client_id" "$timeout_ms"
    if [[ "$settle_ms" -gt 0 ]]; then
      echo >&2
      echo "== settle (${settle_ms}ms) ==" >&2
      sleep "$(awk "BEGIN { printf \"%.3f\", ${settle_ms}/1000 }")"
    fi
    # Upstream IIFE has no stop/pause; capture continues. We just sample status
    # and hot-sources after the settle window.
    echo >&2
    echo "== status ==" >&2
    "$0" avalanche-status "$client_id"
    echo >&2
    echo "== hot sources ==" >&2
    "$0" avalanche-hot-sources "$client_id" 12
    ;;
  handoff-to-playwright)
    client_id="${2:-}"
    url="${3:-}"
    probe_ids_csv="${4:-1,2}"
    browser_name="${5:-chromium}"
    headless="${6:-true}"
    if [[ -z "$client_id" ]]; then
      echo "handoff-to-playwright requires <clientId> [url] [probeIdsCsv] [browserName] [headless]" >&2
      exit 1
    fi
    IFS=',' read -ra probe_parts <<< "$probe_ids_csv"
    probe_json="["
    first=1
    for probe_id in "${probe_parts[@]}"; do
      probe_trim=$(echo "$probe_id" | tr -d ' ')
      [[ -z "$probe_trim" ]] && continue
      if [[ $first -eq 0 ]]; then probe_json+=","; fi
      probe_json+="\"$probe_trim\""
      first=0
    done
    probe_json+="]"
    body=$(node -e '
      const body = {
        url: process.argv[1] || undefined,
        probeIds: JSON.parse(process.argv[2]),
        browserName: process.argv[3] || "chromium",
        headless: process.argv[4] !== "false",
      };
      process.stdout.write(JSON.stringify(body));
    ' "$url" "$probe_json" "$browser_name" "$headless") || exit 1
    curl -fsSL ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} -X POST -H 'content-type: application/json' \
      "$BASE_URL/api/pages/$client_id/handoff-to-playwright" --data-binary "$body"
    ;;
  proxy-state)
    curl "${CURL_OPTS[@]}" "$BASE_URL/api/proxy/state"
    ;;
  proxy-start)
    target_port="${2:-}"
    original_url="${3:-}"
    if [[ -z "$target_port" ]]; then
      echo "proxy-start requires <targetPort> [originalUrl]" >&2
      exit 1
    fi
    if [[ -n "$original_url" ]]; then
      body="{\"targetPort\":$target_port,\"originalUrl\":$(json_escape "$original_url")}"
    else
      body="{\"targetPort\":$target_port}"
    fi
    post_json "/api/proxy/start" "$body"
    ;;
  proxy-stop)
    post_json "/api/proxy/stop" '{}'
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
