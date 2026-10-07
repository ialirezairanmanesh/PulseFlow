# PulseFlow — developer entry points
#
#   make run     start the dashboard + Dart bridge (auto-installs deps)
#   make help    list every target
SHELL := /bin/bash
.DEFAULT_GOAL := help

ROOT   := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
DASH   := $(ROOT)/docs/pulseflow
BRIDGE := $(ROOT)/pulseflow_bridge
# Sibling clone of https://github.com/ialirezairanmanesh/pulseflow_flutter
PKG    := $(or $(PULSEFLOW_FLUTTER),$(ROOT)/../pulseflow_flutter)

.PHONY: help run setup install stop dashboard bridge test test-bridge test-flutter test-dashboard analyze analyze-bridge analyze-flutter lint check clean

define require_flutter_pkg
	@if [[ ! -d "$(PKG)" ]]; then \
		echo "pulseflow_flutter not found at $(PKG)" >&2; \
		echo "Clone it next to this repo, or set PULSEFLOW_FLUTTER=/path/to/pulseflow_flutter" >&2; \
		echo "  git clone https://github.com/ialirezairanmanesh/pulseflow_flutter.git $(ROOT)/../pulseflow_flutter" >&2; \
		exit 1; \
	fi
endef

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
	$(require_flutter_pkg)
	@cd $(PKG) && flutter pub get
	@echo "==> device mirror (ws-scrcpy)"
	@$(DASH)/device-mirror/setup.sh || echo "(device mirror setup skipped)"

stop: ## Free the PulseFlow ports (3846/3847/3848)
	@-if command -v ss >/dev/null 2>&1; then \
		pids="$$(ss -ltnp 2>/dev/null | awk '$$4 ~ /:(3846|3847|3848)$$/ {print}' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)"; \
		[ -n "$$pids" ] && kill $$pids 2>/dev/null || true; \
	elif command -v lsof >/dev/null 2>&1; then \
		lsof -ti tcp:3846 -ti tcp:3847 -ti tcp:3848 2>/dev/null | xargs -r kill 2>/dev/null || true; \
	fi
	@echo "Ports 3846/3847/3848 are free."

dashboard: ## Run only the Next.js dashboard
	@cd $(DASH) && npx next dev -p 3846 -H 0.0.0.0 --webpack

bridge: ## Run only the Dart bridge
	@cd $(BRIDGE) && dart run bin/pulseflow_bridge.dart

test: test-bridge test-flutter test-dashboard ## Run all test suites

test-bridge: ## Run the Dart bridge tests
	@cd $(BRIDGE) && dart test

test-flutter: ## Run the pulseflow_flutter package tests
	$(require_flutter_pkg)
	@cd $(PKG) && flutter test

test-dashboard: ## Run the dashboard unit tests
	@cd $(DASH) && npm run test

analyze: analyze-bridge analyze-flutter ## Analyze all Dart code

analyze-bridge: ## Analyze the Dart bridge
	@cd $(BRIDGE) && dart analyze

analyze-flutter: ## Analyze the pulseflow_flutter package
	$(require_flutter_pkg)
	@cd $(PKG) && flutter analyze

lint: ## Lint the dashboard
	@cd $(DASH) && npm run lint

check: ## Headless budget check (make check VM=ws://... ARGS="--max-p95-build 8")
	@cd $(BRIDGE) && dart run bin/pulseflow_check.dart --vm "$(VM)" $(ARGS)

redroid-start: ## Start a redroid (Android-in-Docker) container for testing
	@./redroid.sh start debug

redroid-stop: ## Stop all redroid containers
	@./redroid.sh stop all

redroid-list: ## List redroid containers and ADB devices
	@./redroid.sh list

redroid-run-debug: ## Run the example app in debug mode on redroid
	@./redroid.sh run debug debug

redroid-run-profile: ## Run the example app in profile mode on redroid
	@./redroid.sh run profile profile

redroid-run-release: ## Run the example app in release mode on redroid
	@./redroid.sh run release release

clean: ## Remove build artifacts (keeps installed dependencies)
	@rm -rf $(DASH)/.next $(BRIDGE)/.dart_tool
	@if [[ -d "$(PKG)" ]]; then rm -rf "$(PKG)/.dart_tool"; fi
	@echo "Cleaned build artifacts."
