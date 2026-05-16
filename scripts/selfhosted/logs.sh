#!/usr/bin/env bash
# Tails docker compose logs on the remote self-hosted stack.
#
# Usage:
#   yarn selfhosted:logs                          # all services
#   yarn selfhosted:logs --name wellington
#   yarn selfhosted:logs -- api worker            # specific services
#   yarn selfhosted:logs --tail 200 -- api        # custom tail count

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_common.sh"

NAME_RAW="default"
TAIL="50"
SERVICES=""
while [ $# -gt 0 ]; do
    case "$1" in
        --name) NAME_RAW="$2"; shift 2 ;;
        --name=*) NAME_RAW="${1#--name=}"; shift ;;
        --tail) TAIL="$2"; shift 2 ;;
        --tail=*) TAIL="${1#--tail=}"; shift ;;
        --) shift; SERVICES="$*"; break ;;
        -h|--help)
            grep -E '^#( |$)' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            # Yarn 1 eats the first `--`, so positional args (service names)
            # arrive here directly. Treat them as the service list.
            SERVICES="$*"; break
            ;;
    esac
done
NAME=$(normalize_name "$NAME_RAW")
state_exists "$NAME" || { err "No instance named '$NAME'."; exit 1; }

CMD="cd /opt/kodus-installer && docker compose logs --tail $TAIL --no-color -f $SERVICES"
log "Tailing logs from '$NAME' (Ctrl-C to stop). Services: ${SERVICES:-all}"
exec ssh_to "$NAME" "$CMD"
