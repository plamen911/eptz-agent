#!/usr/bin/env bash
# Deploys what is pushed to main to the fire-expert.uk box. Run from this Mac; needs the deploy
# user's SSH key. The restart leaves a running case "interrupted".
set -euo pipefail
ssh -o BatchMode=yes -o ConnectTimeout=10 deploy@46.224.114.108 'sudo -u eptz -H bash -c "export PATH=/opt/node-22/bin:\$PATH; cd /opt/eptz-agent && git pull --ff-only && npm ci && npm run vendor:plugin && npm run build" && sudo systemctl restart eptz-agent'
