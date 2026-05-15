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

# Shallow clone of pjproject pinned to the tag. We target .git/config
# instead of the directory itself — git writes that file only on a
# successful clone, so partial clones (network interruption mid-way)
# trigger a retry instead of being silently skipped.
$(BUILD_DIR)/.git/config:
	@mkdir -p build
	git clone --depth 1 --branch $(PJPROJECT_TAG) $(PJPROJECT_URL) $(BUILD_DIR)

# Build pjsua from the cloned source. The configure flags strip features
# we don't need (video, webrtc, OpenCore AMR) and keep the binary lean.
# The built binary lands in pjsip-apps/bin/ with a triplet-suffixed name
# (e.g. pjsua-aarch64-apple-darwin23.6.0). We glob and copy to bin/pjsua.
# Depends on the .git/config sentinel from the clone target so partial
# clones don't trigger a build against a broken tree.
$(BIN): $(BUILD_DIR)/.git/config
	cd $(BUILD_DIR) && CFLAGS="-fPIC -O2" ./configure \
	  --prefix=$(CURDIR)/$(BUILD_DIR)/install \
	  --disable-video \
	  --disable-libwebrtc \
	  --disable-opencore-amr
	cd $(BUILD_DIR) && $(MAKE) dep
	cd $(BUILD_DIR) && $(MAKE)
	@mkdir -p bin
	@count=$$(ls $(BUILD_DIR)/pjsip-apps/bin/pjsua-*-apple-darwin* 2>/dev/null | wc -l | tr -d ' '); \
	  if [ "$$count" != "1" ]; then \
	    echo "Error: expected exactly 1 pjsua-*-apple-darwin* binary in $(BUILD_DIR)/pjsip-apps/bin/, found $$count. Run 'make uninstall' and rebuild."; \
	    exit 1; \
	  fi
	cp $(BUILD_DIR)/pjsip-apps/bin/pjsua-*-apple-darwin* $(BIN)
	@echo ""
	@echo "Built $(BIN). Verify with: $(BIN) --version"

# Idempotent wrapper around the binary build. Re-runs are instant when
# bin/pjsua already exists.
install: $(BIN)
	@echo "pjsua ready at $(BIN)"

# Logs directory is created on demand. Gitignored — not committed.
$(LOGS):
	@mkdir -p $(LOGS)

# Launch pjsua as alice. Drops into the interactive TUI. The log filename
# is generated per invocation via shell ($$(date)) so each session is its
# own artifact. CLI flags override config-file flags in pjsua, which is
# why --log-file works even though it's not in accounts/alice.cfg.
alice: $(BIN) $(LOGS)
	$(BIN) --config-file=accounts/alice.cfg \
	  --log-file=$(LOGS)/alice-$$(date -u +%FT%H-%M-%SZ).log

bob: $(BIN) $(LOGS)
	$(BIN) --config-file=accounts/bob.cfg \
	  --log-file=$(LOGS)/bob-$$(date -u +%FT%H-%M-%SZ).log
