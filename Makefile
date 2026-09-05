# Deploy commands for Métropolitain. Requires deploy.env (copy deploy.env.example,
# fill in your own VPS — never committed, see .gitignore).

-include deploy.env
export

.PHONY: check-env sync build build-server build-web up restart deploy deploy-server deploy-web \
        logs logs-server logs-web status health ssh build-local help

check-env:
	@if [ -z "$(VPS_HOST)" ]; then \
		echo "VPS_HOST not set — copy deploy.env.example to deploy.env and fill in your VPS" >&2; \
		exit 1; \
	fi

# Only git-tracked (or staged) files reach the VPS — see CLAUDE.md's deploy notes on why an
# untracked file silently never makes it.
sync: check-env
	git ls-files | while IFS= read -r f; do [ -e "$$f" ] && printf '%s\n' "$$f"; done | \
		rsync -av --files-from=- . $(VPS_HOST):$(VPS_PATH)/ -e "ssh -i $(SSH_KEY)"

# --no-cache always. A cached layer silently serving stale code — while the container still
# reports healthy — is exactly what happened once already; the few extra seconds this costs
# are cheap insurance against shipping a fix that was never actually built.
build: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose build --no-cache"

build-server: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose build --no-cache server"

build-web: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose build --no-cache web"

up: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose up -d"

restart: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose restart"

# Type-checks/builds both workspaces locally first — the same check Lefthook runs on push,
# run again here so a deploy never ships something that wouldn't even have built.
build-local:
	npm run build --workspace=apps/server
	npm run build --workspace=apps/web

deploy: build-local sync build up
	@echo "Deployed. Run 'make health' to verify."

deploy-server: build-local sync build-server
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose up -d server"
	@echo "Server deployed. Run 'make health' to verify."

deploy-web: build-local sync build-web
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose up -d web"
	@echo "Web deployed. Run 'make health' to verify."

logs: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose logs -f --tail=100"

logs-server: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose logs -f --tail=100 server"

logs-web: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "cd $(VPS_PATH) && docker compose logs -f --tail=100 web"

status: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST) "docker ps --format 'table {{.Names}}\t{{.Status}}'"

health:
	@echo "--- api.metropolitain.live/api/health ---"
	@curl -s https://api.metropolitain.live/api/health && echo
	@echo "--- metropolitain.live ---"
	@curl -sI https://metropolitain.live | head -1

ssh: check-env
	ssh -i $(SSH_KEY) $(VPS_HOST)

help:
	@echo "make deploy         - full deploy: local build check, sync, no-cache rebuild, restart both"
	@echo "make deploy-server  - same, server only (faster)"
	@echo "make deploy-web     - same, web only (faster)"
	@echo "make sync           - rsync git-tracked files to the VPS only"
	@echo "make build          - no-cache rebuild both images on the VPS (no restart)"
	@echo "make up             - docker compose up -d on the VPS"
	@echo "make restart        - restart containers without rebuilding"
	@echo "make status         - show container status"
	@echo "make health         - curl the live health endpoints"
	@echo "make logs           - tail both containers' logs"
	@echo "make ssh            - open an SSH session to the VPS"
