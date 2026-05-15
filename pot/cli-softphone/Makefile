# pot/cli-softphone — pjsua-based SIP CLI softphone
#
# Targets are documented under `make help`. Build is one-time
# (`make install`); per-session launch goes through `make alice` /
# `make bob` which drop into pjsua's interactive TUI and write a full
# SIP+media trace to logs/<account>-<ISO-UTC>.log.

PJPROJECT_TAG := 2.14.1
PJPROJECT_URL := https://github.com/pjsip/pjproject.git
BUILD_DIR     := build/pjproject
BIN           := bin/pjsua
LOGS          := logs

.PHONY: help install alice bob tail-alice tail-bob clean uninstall

help:
	@echo "pot/cli-softphone — pjsua reference softphone"
	@echo ""
	@echo "  make install     Build pjsua from pjproject $(PJPROJECT_TAG) (~5-10 min first run, idempotent)"
	@echo "  make alice       Launch pjsua TUI as alice. Logs to $(LOGS)/alice-<ISO>.log"
	@echo "  make bob         Launch pjsua TUI as bob. Logs to $(LOGS)/bob-<ISO>.log"
	@echo "  make tail-alice  Tail the most recent alice log (run in a second pane)"
	@echo "  make tail-bob    Tail the most recent bob log"
	@echo "  make clean       Remove $(LOGS)/"
	@echo "  make uninstall   Remove bin/ and build/"
