SHELL := /usr/bin/env bash

CONVEX_CLI_URL := http://convex:3210
CONVEX_CLI_RUN := docker compose -f docker-compose.dev.yml run --rm --build --no-deps

.PHONY: all dev validate-dev-env start-local-keychain stop-local-keychain down clean convex-push convex-env seed-public-datasets ensure-admin-key install-deps build-release

all: dev

install-deps:
	@cd frontend && npm install --silent
	@cd backend && npm install --silent

build-release: install-deps
	node scripts/build-release.mjs

dev: validate-dev-env install-deps start-local-keychain
	docker compose -f docker-compose.dev.yml up --build -d db convex convex-dashboard
	@echo "Waiting for Convex..."
	@for i in $$(seq 1 120); do \
		if curl -sf http://127.0.0.1:3210/version > /dev/null 2>&1; then break; fi; \
		if [ $$i -eq 120 ]; then echo "Error: Convex did not start within 120s"; exit 1; fi; \
		sleep 1; \
	done
	@echo "Convex is up."
	$(MAKE) ensure-admin-key
	$(MAKE) convex-env
	$(MAKE) convex-push
	docker compose -f docker-compose.dev.yml up --build -d
	@echo ""
	@echo "BigSet is ready!"
	@echo "  App:              http://localhost:3500"
	@echo "  Mastra Studio:    http://localhost:4111"
	@echo "  Convex Dashboard: http://localhost:6791"
	@echo ""
	docker compose -f docker-compose.dev.yml logs -f

validate-dev-env:
	@if [ ! -f .env ]; then \
		printf "# Auto-created by make dev. Leave PROD unset for local mode.\n" > .env; \
		echo "Created local .env"; \
	fi
	@prod="$$(grep '^PROD=' .env | cut -d= -f2-)"; \
	if [[ "$$prod" != "1" ]]; then \
		ensure_env_var() { \
			key="$$1"; value="$$2"; \
			if grep -q "^$$key=" .env; then \
				current="$$(grep "^$$key=" .env | tail -n1 | cut -d= -f2-)"; \
				if [[ -z "$$current" ]]; then \
					sed -i.bak "s#^$$key=.*#$$key=$$value#" .env && rm -f .env.bak; \
				fi; \
			else \
				echo "$$key=$$value" >> .env; \
			fi; \
		}; \
		workspace_id="$$(node -e 'const { createHash } = require("node:crypto"); process.stdout.write(createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16));')"; \
		token="$$(node -e 'const { randomBytes } = require("node:crypto"); process.stdout.write(randomBytes(32).toString("hex"));')"; \
		ensure_env_var LOCAL_KEYCHAIN_PORT 3502; \
		ensure_env_var LOCAL_KEYCHAIN_TIMEOUT_MS 5000; \
		ensure_env_var BIGSET_LOCAL_WORKSPACE_ID "$$workspace_id"; \
		ensure_env_var LOCAL_KEYCHAIN_TOKEN "$$token"; \
	fi
	@prod="$$(grep '^PROD=' .env | cut -d= -f2-)"; \
	if [[ "$$prod" != "1" ]]; then \
		echo "Local mode: Clerk, TinyFish, and OpenRouter env validation skipped."; \
	fi
	@prod="$$(grep '^PROD=' .env | cut -d= -f2-)"; \
	if [[ "$$prod" != "1" ]]; then exit 0; fi; \
	missing=""; \
	check_env() { \
		key="$$1"; placeholder="$$2"; \
		value="$$(grep "^$$key=" .env | cut -d= -f2-)"; \
		if [[ -z "$$value" || "$$value" == "$$placeholder" || "$$value" == *"..."* ]]; then \
			missing="$$missing $$key"; \
		fi; \
	}; \
	check_env TINYFISH_API_KEY ""; \
	check_env OPENROUTER_API_KEY sk-or-...; \
	check_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY pk_test_...; \
	check_env CLERK_SECRET_KEY sk_test_...; \
	check_env CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev; \
	if [[ -n "$$missing" ]]; then \
		echo ""; \
		echo "Missing environment variables in .env:"; \
		echo ""; \
		for key in $$missing; do \
			case $$key in \
				TINYFISH_API_KEY) \
					echo "  ✗ $$key"; \
					echo "    → Create account → API Keys → Create Key"; \
					echo "    https://agent.tinyfish.ai/api-keys?utm_source=github&utm_medium=organic&utm_campaign=bigset-developer-2026q2"; \
					echo "";; \
				OPENROUTER_API_KEY) \
					echo "  ✗ $$key"; \
					echo "    → Create account → Settings → Keys → Create Key"; \
					echo "    https://openrouter.ai/settings/keys"; \
					echo "";; \
				NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) \
					echo "  ✗ $$key"; \
					echo "    → Clerk dashboard → API Keys → Publishable Key"; \
					echo "    https://dashboard.clerk.com"; \
					echo "";; \
				CLERK_SECRET_KEY) \
					echo "  ✗ $$key"; \
					echo "    → Clerk dashboard → API Keys → Secret Key"; \
					echo "    https://dashboard.clerk.com"; \
					echo "";; \
				CLERK_JWT_ISSUER_DOMAIN) \
					echo "  ✗ $$key"; \
					echo "    → Clerk dashboard → Configure → JWT Templates → enable Convex template"; \
					echo "    → Then find Issuer URL under Settings (e.g. https://your-app.clerk.accounts.dev)"; \
					echo "    https://dashboard.clerk.com"; \
					echo "";; \
			esac; \
		done; \
		echo "Paste your keys into .env, then run make dev again."; \
		echo ""; \
		exit 1; \
	fi

start-local-keychain:
	@prod="$$(grep '^PROD=' .env | cut -d= -f2-)"; \
	if [[ "$$prod" == "1" ]]; then \
		echo "Production mode: local keychain bridge skipped."; \
		exit 0; \
	fi
	@mkdir -p .local
	@if [ -f .local/keychain.pid ]; then \
		pid="$$(cat .local/keychain.pid)"; \
		if [[ -n "$$pid" ]] && kill -0 "$$pid" > /dev/null 2>&1; then \
			kill "$$pid" > /dev/null 2>&1 || true; \
		fi; \
		rm -f .local/keychain.pid; \
	fi
	@port="$$(grep '^LOCAL_KEYCHAIN_PORT=' .env | tail -n1 | cut -d= -f2-)"; \
	echo "Starting local keychain bridge on 127.0.0.1:$$port..."; \
	LOCAL_KEYCHAIN_BIND_HOST=127.0.0.1 WITH_ROOT_ENV_CHILD_PID_FILE=.local/keychain.pid bash -lc 'cd backend && exec node ../scripts/with-root-env.mjs npx tsx src/keychain-server.ts' \
		> .local/keychain.log 2>&1 & \
	for i in $$(seq 1 30); do \
		if curl -sf "http://127.0.0.1:$$port/health" > /dev/null 2>&1; then \
			echo "Local keychain bridge is up."; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Error: local keychain bridge did not start. Last log lines:"; \
	tail -40 .local/keychain.log; \
	exit 1

stop-local-keychain:
	@if [ -f .local/keychain.pid ]; then \
		pid="$$(cat .local/keychain.pid)"; \
		if [[ -n "$$pid" ]] && kill -0 "$$pid" > /dev/null 2>&1; then \
			echo "Stopping local keychain bridge..."; \
			kill "$$pid" > /dev/null 2>&1 || true; \
		fi; \
		rm -f .local/keychain.pid; \
	fi

ensure-admin-key:
	@admin_key="$$(grep '^CONVEX_SELF_HOSTED_ADMIN_KEY=' .env | cut -d= -f2-)"; \
	needs_gen=false; \
	if [[ -z "$$admin_key" ]]; then \
		needs_gen=true; \
	else \
		echo "Validating Convex admin key..."; \
		if ! $(CONVEX_CLI_RUN) -e CONVEX_SELF_HOSTED_ADMIN_KEY="$$admin_key" frontend sh -lc \
			'npx convex env list --url $(CONVEX_CLI_URL) --admin-key "$$CONVEX_SELF_HOSTED_ADMIN_KEY"' > /dev/null 2>&1; then \
			echo "Admin key is stale (volumes were probably wiped). Regenerating..."; \
			needs_gen=true; \
		fi; \
	fi; \
	if [[ "$$needs_gen" == "true" ]]; then \
		echo "Generating Convex admin key..."; \
		generated="$$(docker compose -f docker-compose.dev.yml exec -T convex ./generate_admin_key.sh 2>/dev/null \
			| grep '^convex-self-hosted|')"; \
		if [[ -z "$$generated" ]]; then \
			echo "Error: Failed to generate admin key."; exit 1; \
		fi; \
		if grep -q '^CONVEX_SELF_HOSTED_ADMIN_KEY=' .env; then \
			sed -i.bak "s#^CONVEX_SELF_HOSTED_ADMIN_KEY=.*#CONVEX_SELF_HOSTED_ADMIN_KEY=$$generated#" .env && rm -f .env.bak; \
		else \
			echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$$generated" >> .env; \
		fi; \
		echo "Admin key saved to .env"; \
	else \
		echo "Convex admin key is valid."; \
	fi

convex-env:
	@test -f .env || { echo "Error: .env not found. Run: make dev (it auto-creates a local .env)"; exit 1; }
	@prod="$$(grep '^PROD=' .env | cut -d= -f2-)"; \
	admin_key="$$(grep '^CONVEX_SELF_HOSTED_ADMIN_KEY=' .env | cut -d= -f2-)"; \
	if [[ -z "$$admin_key" ]]; then \
		echo "Error: CONVEX_SELF_HOSTED_ADMIN_KEY is missing in root .env"; \
		echo "Run make dev to generate it automatically."; \
		exit 1; \
	fi; \
	if [[ "$$prod" != "1" ]]; then \
		$(CONVEX_CLI_RUN) -e CONVEX_SELF_HOSTED_ADMIN_KEY="$$admin_key" frontend sh -lc \
		'npx convex env set BIGSET_LOCAL_MODE 1 --url $(CONVEX_CLI_URL) --admin-key "$$CONVEX_SELF_HOSTED_ADMIN_KEY"'; \
		exit 0; \
	fi; \
	issuer="$$(grep '^CLERK_JWT_ISSUER_DOMAIN=' .env | cut -d= -f2-)"; \
	if [[ -z "$$issuer" || "$$issuer" == "https://your-app.clerk.accounts.dev" ]]; then \
		echo "Error: CLERK_JWT_ISSUER_DOMAIN must be your Clerk issuer URL in root .env"; \
		exit 1; \
	fi; \
	$(CONVEX_CLI_RUN) -e CONVEX_SELF_HOSTED_ADMIN_KEY="$$admin_key" frontend sh -lc \
	'npx convex env set BIGSET_LOCAL_MODE 0 --url $(CONVEX_CLI_URL) --admin-key "$$CONVEX_SELF_HOSTED_ADMIN_KEY"'; \
	$(CONVEX_CLI_RUN) -e CONVEX_SELF_HOSTED_ADMIN_KEY="$$admin_key" -e CLERK_JWT_ISSUER_DOMAIN="$$issuer" frontend sh -lc \
	'npx convex env set CLERK_JWT_ISSUER_DOMAIN "$$CLERK_JWT_ISSUER_DOMAIN" --url $(CONVEX_CLI_URL) --admin-key "$$CONVEX_SELF_HOSTED_ADMIN_KEY"'

convex-push:
	@test -f .env || { echo "Error: .env not found. Run: make dev (it auto-creates a local .env)"; exit 1; }
	@admin_key="$$(grep '^CONVEX_SELF_HOSTED_ADMIN_KEY=' .env | cut -d= -f2-)"; \
	if [[ -z "$$admin_key" ]]; then \
		echo "Error: CONVEX_SELF_HOSTED_ADMIN_KEY is missing in root .env"; \
		echo "Run make dev to generate it automatically."; \
		exit 1; \
	fi; \
	$(CONVEX_CLI_RUN) -e CONVEX_SELF_HOSTED_ADMIN_KEY="$$admin_key" frontend sh -lc \
	'npx convex deploy --url $(CONVEX_CLI_URL) --admin-key "$$CONVEX_SELF_HOSTED_ADMIN_KEY"'

seed-public-datasets:
	@test -f .env || { echo "Error: .env not found. Run: make dev (it auto-creates a local .env)"; exit 1; }
	@cd frontend && node ../scripts/with-root-env.mjs npx convex run publicSeed:seedPublicDatasets

down: stop-local-keychain
	docker compose -f docker-compose.dev.yml down

clean: stop-local-keychain
	docker compose -f docker-compose.dev.yml down -v --rmi local
	@if [ -f .env ]; then \
		sed -i.bak 's|^CONVEX_SELF_HOSTED_ADMIN_KEY=.*|CONVEX_SELF_HOSTED_ADMIN_KEY=|' .env && rm -f .env.bak; \
		echo "Cleared CONVEX_SELF_HOSTED_ADMIN_KEY from .env (volumes wiped)."; \
	fi
