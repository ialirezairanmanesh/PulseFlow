# PulseFlow — developer entry points
#
#   make run     start the dashboard + Dart bridge (auto-installs deps)
#   make help    list every target
SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT   := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
DASH   := $(ROOT)/docs/pulseflow
BRIDGE := $(ROOT)/pulseflow_bridge
PKG    := $(ROOT)/pulseflow_flutter

.PHONY: help run setup install stop dashboard bridge test test-bridge test-flutter test-dashboard analyze analyze-bridge analyze-flutter lint check clean

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

run: ## Start the dashboard + Dart bridge (auto-installs dependencies)
	@./run.sh

setup: install ## Install all dependencies

install: ## Install Node and Dart dependencies
	@echo "==> dashboard deps"
	@cd $(DASH) && npm install
	@echo "==> bridge deps"
	@cd $(BRIDGE) && dart pub get
	@echo "==> app package deps"
	@cd $(PKG) && flutter pub get

stop: ## Free the PulseFlow ports (3846/3847)
	@-if command -v ss >/dev/null 2>&1; then \
		pids="$$(ss -ltnp 2>/dev/null | awk '$$4 ~ /:(3846|3847)$$/ {print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)"; \
		[ -n "$$pids" ] && kill $$pids 2>/dev/null || true; \
	elif command -v lsof >/dev/null 2>&1; then \
		lsof -ti tcp:3846 -ti tcp:3847 2>/dev/null | xargs -r kill 2>/dev/null || true; \
	fi
	@echo "Ports 3846/3847 are free."

dashboard: ## Run only the Next.js dashboard
	@cd $(DASH) && npx next dev -p 3846 -H 0.0.0.0 --webpack

bridge: ## Run only the Dart bridge
	@cd $(BRIDGE) && dart run bin/pulseflow_bridge.dart

test: test-bridge test-flutter test-dashboard ## Run all test suites

test-bridge: ## Run the Dart bridge tests
	@cd $(BRIDGE) && dart test

test-flutter: ## Run the pulseflow_flutter package tests
	@cd $(PKG) && flutter test

test-dashboard: ## Run the dashboard unit tests
	@cd $(DASH) && npm run test

analyze: analyze-bridge analyze-flutter ## Analyze all Dart code

analyze-bridge: ## Analyze the Dart bridge
	@cd $(BRIDGE) && dart analyze

analyze-flutter: ## Analyze the pulseflow_flutter package
	@cd $(PKG) && flutter analyze

lint: ## Lint the dashboard
	@cd $(DASH) && npm run lint

check: ## Headless budget check (make check VM=ws://... ARGS="--max-p95-build 8")
	@cd $(BRIDGE) && dart run bin/pulseflow_check.dart --vm "$(VM)" $(ARGS)

clean: ## Remove build artifacts (keeps installed dependencies)
	@rm -rf $(DASH)/.next $(BRIDGE)/.dart_tool $(PKG)/.dart_tool
	@echo "Cleaned build artifacts."
