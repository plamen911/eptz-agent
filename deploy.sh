#!/usr/bin/env bash
#
# deploy.sh — deploy eptz-agent to the fire-expert.uk box over SSH. Run from this Mac.
#
# Deploys a commit that is already on GitHub, NOT the working tree: the server
# checks it out itself, so uncommitted edits can never reach production.
#
# Runs on the SERVER, as the app's user: git checkout, npm ci, vendor:plugin and
# build, then a restart of the eptz-agent service, then checks over HTTPS.
#
# THE RESTART TRAP: a restart stops a running case (it comes back "interrupted"),
# so this refuses to deploy while one is reading or writing, unless --force.
#
# THE /etc/hosts TRAP: the agent's sandbox refuses a domain that resolves to one
# of the host's own addresses, and n8n runs on this box. /etc/hosts therefore
# points n8n.fire-expert.uk at the laravel_rag_nginx container, whose address can
# change when it is recreated. The preflight compares the two (see CLAUDE.md).
#
# Requires: SSH key access to the box as the deploy user (passwordless sudo), and
# a first-time setup there: /opt/eptz-agent, /opt/node-22, the systemd unit, .env.
# .env and runs/ are server-owned; this script never transfers or changes them.
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------- configuration
DEPLOY_SSH_USER="${DEPLOY_SSH_USER:-deploy}"
DEPLOY_SSH_HOST="${DEPLOY_SSH_HOST:-46.224.114.108}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/eptz-agent}"
SERVICE="${SERVICE:-eptz-agent}"
SITE_URL="${SITE_URL:-https://eptz.fire-expert.uk}"
NODE_BIN="${NODE_BIN:-/opt/node-22/bin}"

REF="HEAD"
DRY_RUN=0
ASSUME_YES=0
RUN_TESTS=1
FORCE=0

usage() {
    cat <<'USAGE'
Usage: ./deploy.sh [options]

Deploys a pushed commit to the fire-expert.uk box: checkout, npm ci, vendor:plugin,
build, restart the service, then verify over HTTPS.

Options:
      --ref <git-ref>  Commit/branch/tag to deploy (default: HEAD). Must be pushed.
  -n, --dry-run        Run the checks and show what would change, then stop.
  -y, --yes            Skip the confirmation prompt.
      --no-tests       Skip the local typecheck and tests.
      --force          Deploy even while a case is reading or writing (it stops it).
  -h, --help           Show this help.

Environment overrides:
  DEPLOY_SSH_USER (deploy)   DEPLOY_SSH_HOST (46.224.114.108)
  DEPLOY_PATH (/opt/eptz-agent)   SERVICE (eptz-agent)
  SITE_URL (https://eptz.fire-expert.uk)   NODE_BIN (/opt/node-22/bin)

Notes:
  The tests run on this working tree, so they need it clean and --ref at HEAD.
  Roll back with --ref <older-ref>.
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --ref)         shift; [ $# -gt 0 ] || { echo "--ref needs a value" >&2; exit 2; }; REF="$1" ;;
        --ref=*)       REF="${1#*=}" ;;
        -n|--dry-run)  DRY_RUN=1 ;;
        -y|--yes)      ASSUME_YES=1 ;;
        --no-tests)    RUN_TESTS=0 ;;
        --force)       FORCE=1 ;;
        -h|--help)     usage; exit 0 ;;
        *)             echo "Unknown option: $1" >&2; echo >&2; usage >&2; exit 2 ;;
    esac
    shift
done

# ---------------------------------------------------------------------- helpers
step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

REMOTE="${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

remote() { ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"; }
# A script on stdin, as the app's user: remote_app <<'SCRIPT' … SCRIPT
remote_app() { remote "sudo -n -u eptz -H bash -s -- $*"; }

# --------------------------------------------------------------------- preflight
step "Preflight checks"

command -v git >/dev/null 2>&1 || die "git is not installed or not on PATH."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a git work tree."

REF_SHA="$(git rev-parse --verify "${REF}^{commit}" 2>/dev/null)" || die "Unknown git ref: ${REF}"
SHORT="${REF_SHA:0:7}"
REF_SUBJECT="$(git log -1 --format=%s "$REF_SHA")"
info "Deploying ${REF} -> ${SHORT} on branch $(git rev-parse --abbrev-ref HEAD)"
info "  ${REF_SUBJECT}"

# The server checks the commit out from GitHub, so it has to be there.
git fetch -q origin || die "git fetch failed."
[ -n "$(git branch -r --contains "$REF_SHA" 2>/dev/null)" ] \
    || die "${SHORT} is not on GitHub. Push it first: the server fetches it from there."

# The deploy ignores the working tree. Say so, rather than let someone believe it was included.
DIRTY=0
if ! git diff --quiet || ! git diff --cached --quiet; then
    DIRTY=1
    warn "Uncommitted changes in the working tree are NOT part of this deploy."
fi

# BatchMode so a missing key fails fast instead of hanging on a password prompt.
remote true >/dev/null 2>&1 \
    || die "Cannot reach ${REMOTE} with key auth. Check the box is up and your
    SSH key is in its authorized_keys."
remote "sudo -n true" >/dev/null 2>&1 || die "${DEPLOY_SSH_USER} has no passwordless sudo on the box."
remote "sudo -n test -d '${DEPLOY_PATH}/.git'" || die "Not set up on the box: ${DEPLOY_PATH} is not a clone."
# Without the token the service refuses to start on the gateway address.
remote "sudo -n grep -qE '^APP_TOKEN=.{24,}' '${DEPLOY_PATH}/.env'" \
    || die "${DEPLOY_PATH}/.env is missing or has no APP_TOKEN. Create it on the box first."
[ "$(remote "sudo -n stat -c %a '${DEPLOY_PATH}/.env'")" = "600" ] || die "${DEPLOY_PATH}/.env must be chmod 600."
info "SSH OK, ${DEPLOY_PATH} present, .env has an APP_TOKEN and is 600."

# See THE /etc/hosts TRAP at the top of this file.
N8N_NOW="$(remote "getent ahostsv4 n8n.fire-expert.uk | awk 'NR==1{print \$1}'")"
NGINX_IP="$(remote "docker inspect laravel_rag_nginx --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'")"
[ -n "$NGINX_IP" ] && [ "$N8N_NOW" = "$NGINX_IP" ] \
    || die "/etc/hosts sends n8n.fire-expert.uk to '${N8N_NOW}', but laravel_rag_nginx is at '${NGINX_IP}'.
    The agent cannot reach n8n until the line is updated (see Production in CLAUDE.md)."
info "n8n.fire-expert.uk points at laravel_rag_nginx (${NGINX_IP})."

# See THE RESTART TRAP at the top of this file. A case still marked as running after a
# crash looks the same on disk: if the service was not running it, --force is safe.
RUNNING="$(remote_app "'${DEPLOY_PATH}'" <<'SCRIPT'
cd "$1" && [ -d runs ] || exit 0
grep -lE '"status": "(reading|writing)"' runs/*/state.json 2>/dev/null | cut -d/ -f2 || true
SCRIPT
)"
if [ -n "$RUNNING" ]; then
    printf '%s\n' "$RUNNING" | sed 's/^/    running: /'
    if [ "$FORCE" -eq 1 ]; then
        warn "--force: the restart stops these cases."
    elif [ "$DRY_RUN" -eq 1 ]; then
        warn "A real deploy would stop here: these cases are running (--force overrides)."
    else
        die "A case is running, and the restart would stop it. Wait, or pass --force."
    fi
fi

# ------------------------------------------------------------------------ tests
if [ "$RUN_TESTS" -eq 1 ]; then
    step "Typecheck and tests"
    [ "$REF_SHA" = "$(git rev-parse HEAD)" ] && [ "$DIRTY" -eq 0 ] \
        || die "The tests run on this working tree, so it must be clean and at ${REF}.
    Commit or stash first, or pass --no-tests (a rollback usually does)."
    TEST_LOG="$(mktemp "${TMPDIR:-/tmp}/eptz-deploy.XXXXXX")"
    trap 'rm -f "$TEST_LOG"' EXIT
    if npm run typecheck >"$TEST_LOG" 2>&1 && npm test >>"$TEST_LOG" 2>&1; then
        grep -E 'Tests +[0-9]+ passed' "$TEST_LOG" | sed -E 's/^ +/    /' || true
    else
        tail -40 "$TEST_LOG" >&2
        die "Typecheck or tests failed (last 40 lines above). Nothing was deployed."
    fi
else
    warn "Skipping the typecheck and tests (--no-tests)."
fi

# ---------------------------------------------------------------------- preview
step "Preview — what would change on production"
info "(nothing is written)"

CURRENT="$(remote "sudo -n -u eptz git -C '${DEPLOY_PATH}' rev-parse HEAD")"
info "On the box now: ${CURRENT:0:7}"
if [ "$CURRENT" = "$REF_SHA" ]; then
    info "No code changes — the box already has ${SHORT}. The service is rebuilt and restarted anyway."
elif git cat-file -e "${CURRENT}^{commit}" 2>/dev/null; then
    echo
    git diff --stat "$CURRENT" "$REF_SHA" | sed 's/^/    /'
    echo
    git log --format='%h %s' "${CURRENT}..${REF_SHA}" | cut -c1-100 | sed 's/^/    /'
else
    warn "This clone does not have ${CURRENT:0:7}, so the changes cannot be listed."
fi

if [ "$DRY_RUN" -eq 1 ]; then
    echo
    info "Dry run only (-n). Nothing was changed."
    exit 0
fi

if [ "$ASSUME_YES" -eq 0 ]; then
    printf '\n\033[1;33mDeploy %s to %s:%s and restart %s?\033[0m\n' "$SHORT" "$REMOTE" "$DEPLOY_PATH" "$SERVICE"
    printf 'Type "yes" to continue: '
    read -r REPLY
    [ "$REPLY" = "yes" ] || die "Aborted."
fi

# ------------------------------------------------------------------------ build
step "Checking out and building on the box"

BUILD_LOG="$(mktemp "${TMPDIR:-/tmp}/eptz-deploy.XXXXXX")"
if remote_app "'${DEPLOY_PATH}'" "'${NODE_BIN}'" "'${REF_SHA}'" >"$BUILD_LOG" 2>&1 <<'SCRIPT'
set -euo pipefail
cd "$1"
export PATH="$2:$PATH"
git fetch -q origin
git checkout -q --detach "$3"
npm ci
npm run vendor:plugin
npm run build
SCRIPT
then
    grep -E 'fire-service |built in' "$BUILD_LOG" | sed -E 's/^.*(fire-service )/\1/; s/^/    /' || true
    rm -f "$BUILD_LOG"
else
    tail -40 "$BUILD_LOG" >&2
    rm -f "$BUILD_LOG"
    die "The build failed (last 40 lines above). The service was NOT restarted, so it still
    runs the old code from memory, but the files on the box have changed. Fix it, or
    roll back with: ./deploy.sh --ref ${CURRENT:0:7} --no-tests"
fi

step "Restarting ${SERVICE}"
remote "sudo -n systemctl restart '${SERVICE}'" \
    || die "The restart failed. Inspect with: ssh ${REMOTE} 'sudo journalctl -u ${SERVICE} -n 50'"
info "Restarted."

# ----------------------------------------------------------------- verification
step "Verifying ${SITE_URL}"

# A crash-looping service is "active" between restarts, so poll /api/health itself.
HEALTH=""
for _ in $(seq 1 20); do
    HEALTH="$(curl -s --max-time 10 "$SITE_URL/api/health" || true)"
    case "$HEALTH" in *'"ok":true'*) break ;; esac
    sleep 3
done

FAILED=0
case "$HEALTH" in
    *'"ok":true'*) info "OK   /api/health: ${HEALTH}" ;;
    *) warn "FAIL /api/health did not answer ok within 60 s: ${HEALTH:-no response}"; FAILED=1 ;;
esac

# The plugin this commit pins must be the one the service loaded.
PLUGIN_REF="$(git show "${REF_SHA}:plugin.lock" | sed -n 's/^ref=//p')"
case "$HEALTH" in
    *"$PLUGIN_REF"*) info "OK   the plugin matches plugin.lock (${PLUGIN_REF:0:7})" ;;
    *) warn "FAIL the service did not report the plugin in plugin.lock (${PLUGIN_REF:0:7})"; FAILED=1 ;;
esac

check() {
    local label="$1" url="$2" want="$3" code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)"
    if [ "$code" = "$want" ]; then
        info "OK   ${label} (${code})"
    else
        warn "FAIL ${label} — HTTP ${code}, expected ${want}, at ${url}"
        FAILED=1
    fi
}
check "the app page" "$SITE_URL/" 200
check "a request without the token is refused" "$SITE_URL/api/cases" 401

DEPLOYED="$(remote "sudo -n -u eptz git -C '${DEPLOY_PATH}' rev-parse HEAD")"
if [ "$DEPLOYED" = "$REF_SHA" ]; then
    info "OK   the box is on ${SHORT}"
else
    warn "FAIL the box is on ${DEPLOYED:0:7}, expected ${SHORT}"
    FAILED=1
fi

[ "$FAILED" -eq 0 ] || die "Deployed, but verification failed — see the FAIL lines above.
    Logs: ssh ${REMOTE} 'sudo journalctl -u ${SERVICE} -n 50'
    Roll back: ./deploy.sh --ref ${CURRENT:0:7} --no-tests"

step "Done"
info "Deployed ${SHORT} (${REF_SUBJECT}) to ${DEPLOY_PATH}."
