NGROK ?= ngrok
NGROK_DOMAIN ?= $(shell grep '^N8N_WEBHOOK_URL=' .env.local 2>/dev/null | sed 's|^N8N_WEBHOOK_URL=https\?://||')

# Secrets and config that Docker Compose reads from .env
# NOTE: Do NOT include URLs that docker-compose.yml already hardcodes for
# container networking (SUPABASE_URL, N8N_API_URL, ZEROCLAW_GATEWAY_URL).
# Those are set in docker-compose.yml with correct internal hostnames.
DOCKER_ENV_KEYS = \
	NEXT_PUBLIC_SUPABASE_URL \
	NEXT_PUBLIC_SUPABASE_ANON_KEY \
	SUPABASE_SERVICE_ROLE_KEY \
	SUPABASE_COOKIE_NAME \
	ZEROCLAW_GATEWAY_TOKEN \
	ZEROCLAW_TIMEOUT_MS \
	DEFAULT_AI_PROVIDER \
	OPENCLAW_GATEWAY_URL \
	OPENCLAW_GATEWAY_TOKEN \
	OPENCLAW_TIMEOUT_MS \
	N8N_API_KEY \
	N8N_WEBHOOK_URL \
	N8N_TIMEOUT_MS \
	NEXT_PUBLIC_APP_URL \
	CHAINTHINGS_WEBHOOK_SECRET \
	CRON_SECRET

.PHONY: up down dev tunnel tunnel-stop status env-sync migrate

# Sync secrets from .env.local → .env for Docker Compose
env-sync:
	@if [ ! -f .env.local ]; then \
		echo "❌ .env.local not found. Run: cp .env.example .env.local"; \
		exit 1; \
	fi
	@echo "# Auto-generated from .env.local for Docker Compose" > .env
	@echo "# Do not edit — run 'make env-sync' to regenerate" >> .env
	@echo "# URLs like SUPABASE_URL, N8N_API_URL, ZEROCLAW_GATEWAY_URL are" >> .env
	@echo "# hardcoded in docker-compose.yml for container networking." >> .env
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

# Start everything: sync env + preflight + tunnel + build
up: env-sync preflight tunnel
	@echo "▶ Starting ChainThings..."
	@docker compose up -d --build
	@$(MAKE) -s status

# Preflight: verify external services on lab_net are reachable
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

# Stop everything
down: tunnel-stop
	@echo "⏹ Stopping ChainThings..."
	@docker compose down

# Dev server (local, not Docker)
dev:
	@npx next dev

# Start ngrok tunnel for n8n webhooks
tunnel:
	@if [ -z "$(NGROK_DOMAIN)" ]; then echo "⚠️  N8N_WEBHOOK_URL not set in .env.local, skipping tunnel"; exit 0; fi
	@if ! command -v $(NGROK) >/dev/null 2>&1; then echo "❌ ngrok not found. Install: https://ngrok.com/download"; exit 1; fi
	@pkill -f "ngrok http.*5678" 2>/dev/null || true
	@sleep 1
	@$(NGROK) http 5678 --url $(NGROK_DOMAIN) --log /tmp/ngrok.log --log-format json &
	@sleep 3
	@if curl -s -o /dev/null -w '' https://$(NGROK_DOMAIN)/healthz 2>/dev/null; then \
		echo "✅ Tunnel: https://$(NGROK_DOMAIN)"; \
	else \
		echo "⚠️  Tunnel started but health check failed — n8n may not be running"; \
	fi

# Stop ngrok tunnel
tunnel-stop:
	@pkill -f "ngrok http.*5678" 2>/dev/null || true
	@echo "⏹ Tunnel stopped"

# Status overview
status:
	@echo ""
	@echo "=== ChainThings Status ==="
	@docker ps --filter "name=chainthings" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
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
	@if [ -n "$(NGROK_DOMAIN)" ]; then \
		echo "ngrok: https://$(NGROK_DOMAIN)"; \
		curl -s -o /dev/null -w "  n8n tunnel: %{http_code}\n" https://$(NGROK_DOMAIN)/healthz 2>/dev/null || echo "  n8n tunnel: offline"; \
	else \
		echo "ngrok: not configured (set N8N_WEBHOOK_URL in .env.local)"; \
	fi
