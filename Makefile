NGROK ?= ngrok
NGROK_DOMAIN ?= $(shell grep '^N8N_WEBHOOK_URL=' .env.local 2>/dev/null | sed -E 's|^N8N_WEBHOOK_URL=https?://||')
APP_NGROK_DOMAIN ?= $(shell grep '^NEXT_PUBLIC_APP_URL=' .env.local 2>/dev/null | sed -E 's|^NEXT_PUBLIC_APP_URL=https?://||')
PID_DIR := /tmp/chainthings-pids

# ngrok config files — override in .env.local with NGROK_CFG_APP / NGROK_CFG_N8N
# Supports multi-account setups where each domain is on a different ngrok account
NGROK_CFG_APP ?= $(shell val=$$(grep '^NGROK_CFG_APP=' .env.local 2>/dev/null | cut -d= -f2-); [ -n "$$val" ] && eval echo "$$val" || echo "$(HOME)/.config/ngrok/ngrok.yml")
NGROK_CFG_N8N ?= $(shell val=$$(grep '^NGROK_CFG_N8N=' .env.local 2>/dev/null | cut -d= -f2-); [ -n "$$val" ] && eval echo "$$val" || echo "$(HOME)/.config/ngrok/ngrok.yml")

# Secrets and config that Docker Compose reads from .env
DOCKER_ENV_KEYS = \
	NEXT_PUBLIC_SUPABASE_URL \
	NEXT_PUBLIC_SUPABASE_ANON_KEY \
	SUPABASE_SERVICE_ROLE_KEY \
	SUPABASE_COOKIE_NAME \
	ZEROCLAW_GATEWAY_TOKEN \
	ZEROCLAW_TIMEOUT_MS \
	ZEROCLAW_CHAT_TIMEOUT_MS \
	RAG_TIMEOUT_MS \
	DEFAULT_AI_PROVIDER \
	OPENCLAW_GATEWAY_URL \
	OPENCLAW_GATEWAY_TOKEN \
	OPENCLAW_TIMEOUT_MS \
	N8N_API_KEY \
	N8N_WEBHOOK_URL \
	N8N_EDITOR_BASE_URL \
	N8N_TIMEOUT_MS \
	NEXT_PUBLIC_APP_URL \
	CHAINTHINGS_WEBHOOK_SECRET \
	CRON_SECRET \
	AI_MEMORY_EXTRACTION

.PHONY: up down dev tunnel tunnel-app tunnel-stop status env-sync migrate build

# ─── Lifecycle ────────────────────────────────────────────────────────────────

# Start everything: sync env → preflight → tunnel → build + run
# Only the app tunnel is required — n8n webhooks are proxied through /n8n-webhook/*
up: env-sync preflight tunnel-app build
	@$(MAKE) -s status

# Build and start container (without tunnels/preflight — for rebuilds)
build:
	@echo "▶ Building & starting ChainThings..."
	@docker compose up -d --build

# Stop everything
down:
	@$(MAKE) -s tunnel-stop
	@echo "⏹ Stopping ChainThings..."
	@docker compose down

# Dev server (local, not Docker)
dev:
	@npx next dev

# ─── Environment ──────────────────────────────────────────────────────────────

# Sync secrets from .env.local → .env for Docker Compose
env-sync:
	@if [ ! -f .env.local ]; then \
		echo "❌ .env.local not found. Run: cp .env.example .env.local"; \
		exit 1; \
	fi
	@echo "# Auto-generated from .env.local for Docker Compose" > .env
	@echo "# Do not edit — run 'make env-sync' to regenerate" >> .env
	@echo "" >> .env
	@count=0; for key in $(DOCKER_ENV_KEYS); do \
		val=$$(grep "^$$key=" .env.local 2>/dev/null | head -1 | cut -d= -f2-); \
		if [ -n "$$val" ]; then \
			echo "$$key=$$val" >> .env; \
			count=$$((count + 1)); \
		fi; \
	done; \
	echo "✅ .env synced ($$count variables from .env.local)"

# Apply database migrations to Supabase
migrate:
	@echo "▶ Applying database migrations..."
	@for f in supabase/migrations/*.sql; do \
		echo "  ➜ $$(basename $$f)"; \
		docker exec -i supabase-db psql -U supabase_admin -d postgres < "$$f" 2>&1 | \
			grep -E "^(CREATE|ALTER|ERROR)" || true; \
	done
	@echo "✅ Migrations complete"

# ─── Preflight ────────────────────────────────────────────────────────────────

preflight:
	@echo "▶ Preflight checks..."
	@fail=0; \
	if docker ps --format '{{.Names}}' | grep -q "^supabase-db$$"; then \
		echo "  ✅ supabase-db"; \
	else \
		echo "  ❌ supabase-db not running"; fail=1; \
	fi; \
	if docker ps --format '{{.Names}}' | grep -q "^supabase-kong$$"; then \
		echo "  ✅ supabase-kong"; \
	else \
		echo "  ❌ supabase-kong not running"; fail=1; \
	fi; \
	if docker ps --format '{{.Names}}' | grep -q "^zeroclaw$$"; then \
		zc_health=$$(docker exec zeroclaw curl -sf http://127.0.0.1:42617/health 2>/dev/null || true); \
		if echo "$$zc_health" | grep -q '"status":"ok"'; then \
			echo "  ✅ zeroclaw (healthy)"; \
		else \
			echo "  ⚠️  zeroclaw running but unhealthy"; \
		fi; \
	else \
		echo "  ❌ zeroclaw not running — AI chat will not work"; \
	fi; \
	if docker ps --format '{{.Names}}' | grep -q "n8n"; then \
		echo "  ✅ n8n"; \
	else \
		echo "  ⚠️  n8n not running — workflows will not work"; \
	fi; \
	if [ "$$fail" -eq 1 ]; then \
		echo ""; echo "  ❌ Required services missing. Start Supabase first."; exit 1; \
	fi

# ─── Tunnels (PID-file managed) ──────────────────────────────────────────────

# Helper: start an ngrok tunnel with PID file tracking
# Usage: $(call start_tunnel,PORT,DOMAIN,LABEL,PID_FILE,CONFIG_FILE)
define start_tunnel
	@mkdir -p $(PID_DIR)
	@if [ -f $(4) ] && kill -0 $$(cat $(4)) 2>/dev/null; then \
		echo "  $(3): already running (PID $$(cat $(4)))"; \
	else \
		rm -f $(4); \
		nohup $(NGROK) http $(1) --url $(2) \
			--config $(5) \
			--log /tmp/ngrok-$(3).log --log-format json \
			> /dev/null 2>&1 & echo $$! > $(4); \
		sleep 3; \
		if kill -0 $$(cat $(4)) 2>/dev/null; then \
			echo "  ✅ $(3) tunnel: https://$(2) (PID $$(cat $(4)))"; \
		else \
			echo "  ❌ $(3) tunnel failed — check /tmp/ngrok-$(3).log"; \
			rm -f $(4); \
			exit 0; \
		fi; \
	fi
endef

# Helper: stop a tunnel by PID file
# Usage: $(call stop_tunnel,PID_FILE,LABEL)
define stop_tunnel
	@if [ -f $(1) ]; then \
		pid=$$(cat $(1)); \
		if kill -0 $$pid 2>/dev/null; then \
			kill $$pid 2>/dev/null || true; \
			echo "  ⏹ $(2) tunnel stopped (PID $$pid)"; \
		fi; \
		rm -f $(1); \
	fi
endef

# n8n webhook tunnel (port 5678)
tunnel:
	@if [ -z "$(NGROK_DOMAIN)" ]; then echo "  ⚠️  N8N_WEBHOOK_URL not set, skipping n8n tunnel"; exit 0; fi
	@if ! command -v $(NGROK) >/dev/null 2>&1; then echo "  ❌ ngrok not found"; exit 1; fi
	$(call start_tunnel,5678,$(NGROK_DOMAIN),n8n,$(PID_DIR)/ngrok-n8n.pid,$(NGROK_CFG_N8N))

# App tunnel (port 3001)
tunnel-app:
	@if [ -z "$(APP_NGROK_DOMAIN)" ] || echo "$(APP_NGROK_DOMAIN)" | grep -qE "^(localhost|172\.|192\.|10\.)"; then \
		echo "  ⚠️  NEXT_PUBLIC_APP_URL is local, skipping app tunnel"; exit 0; \
	fi
	@if ! command -v $(NGROK) >/dev/null 2>&1; then echo "  ❌ ngrok not found"; exit 1; fi
	$(call start_tunnel,3001,$(APP_NGROK_DOMAIN),app,$(PID_DIR)/ngrok-app.pid,$(NGROK_CFG_APP))

# Stop all tunnels
tunnel-stop:
	$(call stop_tunnel,$(PID_DIR)/ngrok-n8n.pid,n8n)
	$(call stop_tunnel,$(PID_DIR)/ngrok-app.pid,app)

# ─── Status ───────────────────────────────────────────────────────────────────

status:
	@echo ""
	@echo "=== ChainThings Status ==="
	@docker ps --filter "name=chainthings" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  (no containers)"
	@echo ""
	@echo "--- Services (lab_net) ---"
	@zc=$$(docker exec chainthings-web wget -q -O- --timeout=3 http://zeroclaw:42617/health 2>/dev/null || true); \
	if echo "$$zc" | grep -q '"status":"ok"'; then \
		echo "  zeroclaw:  ✅ ok"; \
	else \
		echo "  zeroclaw:  ❌ unreachable"; \
	fi
	@sb=$$(docker exec chainthings-web wget --spider --timeout=3 http://supabase-kong:8000/ 2>&1); \
	if echo "$$sb" | grep -qE "HTTP/1.1 [0-9]|200|401|404"; then \
		echo "  supabase:  ✅ ok"; \
	else \
		echo "  supabase:  ❌ unreachable"; \
	fi
	@n8n=$$(docker exec chainthings-web wget -q -O- --timeout=3 http://n8n-n8n-1:5678/healthz 2>/dev/null && echo ok || true); \
	if [ -n "$$n8n" ]; then \
		echo "  n8n:       ✅ ok"; \
	else \
		echo "  n8n:       ⚠️  unreachable"; \
	fi
	@echo ""
	@echo "--- Tunnels ---"
	@if [ -f $(PID_DIR)/ngrok-app.pid ] && kill -0 $$(cat $(PID_DIR)/ngrok-app.pid) 2>/dev/null; then \
		echo "  app:  ✅ https://$(APP_NGROK_DOMAIN) (PID $$(cat $(PID_DIR)/ngrok-app.pid))"; \
	elif [ -n "$(APP_NGROK_DOMAIN)" ] && ! echo "$(APP_NGROK_DOMAIN)" | grep -qE "^(localhost|172\.|192\.|10\.)"; then \
		echo "  app:  ❌ not running"; \
	else \
		echo "  app:  local only (http://localhost:3001)"; \
	fi
	@if [ -f $(PID_DIR)/ngrok-n8n.pid ] && kill -0 $$(cat $(PID_DIR)/ngrok-n8n.pid) 2>/dev/null; then \
		echo "  n8n:  ✅ https://$(NGROK_DOMAIN) (PID $$(cat $(PID_DIR)/ngrok-n8n.pid))"; \
	elif [ -n "$(NGROK_DOMAIN)" ]; then \
		echo "  n8n:  ❌ not running"; \
	else \
		echo "  n8n:  not configured"; \
	fi
	@echo ""
