NGROK ?= ngrok
NGROK_DOMAIN ?= $(shell grep '^N8N_WEBHOOK_URL=' .env.local 2>/dev/null | sed 's|^N8N_WEBHOOK_URL=https\?://||')

.PHONY: up down dev tunnel tunnel-stop status

# Start everything: Docker app + ngrok tunnel
up: tunnel
	@echo "▶ Starting ChainThings..."
	@docker compose up -d --build
	@$(MAKE) -s status

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
	@if [ -n "$(NGROK_DOMAIN)" ]; then \
		echo "ngrok: https://$(NGROK_DOMAIN)"; \
		curl -s -o /dev/null -w "  n8n tunnel: %{http_code}\n" https://$(NGROK_DOMAIN)/healthz 2>/dev/null || echo "  n8n tunnel: offline"; \
	else \
		echo "ngrok: not configured (set N8N_WEBHOOK_URL in .env.local)"; \
	fi
