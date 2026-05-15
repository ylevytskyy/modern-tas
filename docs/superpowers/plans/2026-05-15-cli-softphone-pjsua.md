# CLI Softphone (pjsua) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `pot/cli-softphone/` — a native macOS build of pjproject's `pjsua` reference softphone, with pre-baked alice/bob configs matching the S9 Asterisk endpoints and a Makefile that launches the TUI while writing a per-session level-5 SIP+media trace to `logs/`.

**Architecture:** Single-tool tree at `pot/cli-softphone/`. `make install` clones and builds pjproject `2.14.1` into `build/`, copies the resulting `pjsua` to `bin/`. `make alice` / `make bob` launch the TUI with `--config-file=accounts/<id>.cfg` plus a `--log-file` injected at invocation time so each session is its own artifact. `bin/`, `build/`, and `logs/` are gitignored; `accounts/` and the Makefile are committed.

**Tech Stack:** pjproject 2.14.1 (C, autotools, built natively); GNU make; bash; POSIX coreutils.

**TDD exception noted (per CLAUDE.md §4a):** This is a tooling spike. No production code, no application-level behaviour to assert with unit tests. Verification is build-output checks ("the binary exists and prints a version") and live integration against the S9 Asterisk container ("REGISTER succeeds; INVITE round-trips; log file has the expected SIP messages"). Each task lists an explicit verify step per §6 — the platform's debug environment is the Mac shell plus the S9 stack.

---

### Task 1: Scaffold directory + .gitignore + placeholder README

**Files:**
- Create: `pot/cli-softphone/.gitignore`
- Create: `pot/cli-softphone/README.md` (placeholder, full content in Task 11)

- [ ] **Step 1: Create the directory + .gitignore**

```bash
mkdir -p pot/cli-softphone
```

Write `pot/cli-softphone/.gitignore`:

```
# Built pjsua binary and source tree
bin/
build/

# Per-session SIP traces (regenerated on each launch)
logs/
```

- [ ] **Step 2: Create placeholder README**

Write `pot/cli-softphone/README.md`:

```markdown
# pot/cli-softphone — pjsua-based SIP CLI softphone

Native macOS build of pjproject's `pjsua` reference softphone, configured
for the S9 audio-loopback endpoints (alice/bob). Used to script REGISTER,
INVITE, and call-flow tests with full SIP+media+diagnostic traces.

See `docs/superpowers/specs/2026-05-15-cli-softphone-pjsua-design.md` for
the full design. Full usage instructions land in Task 11.
```

- [ ] **Step 3: Verify**

```bash
ls -la pot/cli-softphone/
```

Expected: shows `.gitignore` and `README.md`. `git status` shows both as new.

- [ ] **Step 4: Commit**

```bash
git add pot/cli-softphone/.gitignore pot/cli-softphone/README.md
git commit -m "scaffold(cli-softphone): directory + gitignore + placeholder README"
```

---

### Task 2: Makefile skeleton with `help` target

**Files:**
- Create: `pot/cli-softphone/Makefile`

- [ ] **Step 1: Write the Makefile skeleton**

Write `pot/cli-softphone/Makefile`:

```make
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
```

- [ ] **Step 2: Verify**

```bash
cd pot/cli-softphone && make help
```

Expected: prints the seven-target usage block.

- [ ] **Step 3: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): Makefile skeleton with help target"
```

---

### Task 3: Clone pjproject (build dependency)

**Files:**
- Modify: `pot/cli-softphone/Makefile` (add `$(BUILD_DIR)` target)

- [ ] **Step 1: Append the clone target**

Append to `pot/cli-softphone/Makefile`:

```make
# Shallow clone of pjproject pinned to the tag. Idempotent: presence of
# the directory is enough to skip.
$(BUILD_DIR):
	@mkdir -p build
	git clone --depth 1 --branch $(PJPROJECT_TAG) $(PJPROJECT_URL) $(BUILD_DIR)
```

- [ ] **Step 2: Run it and verify**

```bash
cd pot/cli-softphone && make build/pjproject
```

Expected: `git clone` runs once, produces `build/pjproject/configure`,
`build/pjproject/pjsip-apps/`, etc. ~30 s on a healthy connection.

```bash
ls build/pjproject/configure build/pjproject/pjsip-apps/src/pjsua/pjsua_app.c
```

Both should exist.

- [ ] **Step 3: Re-run to confirm idempotency**

```bash
make build/pjproject
```

Expected: prints nothing (target is up to date — make sees the directory
exists). No clone attempt.

- [ ] **Step 4: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): pjproject clone target"
```

---

### Task 4: Configure + build pjsua + copy to `bin/`

**Files:**
- Modify: `pot/cli-softphone/Makefile` (add `$(BIN)` target)

- [ ] **Step 1: Append the build target**

Append to `pot/cli-softphone/Makefile`:

```make
# Build pjsua from the cloned source. The configure flags strip features
# we don't need (video, webrtc, OpenCore AMR) and keep the binary lean.
# The built binary lands in pjsip-apps/bin/ with a triplet-suffixed name
# (e.g. pjsua-aarch64-apple-darwin23.6.0). We glob and copy to bin/pjsua.
$(BIN): $(BUILD_DIR)
	cd $(BUILD_DIR) && CFLAGS="-fPIC -O2" ./configure \
	  --prefix=$(PWD)/$(BUILD_DIR)/install \
	  --disable-video \
	  --disable-libwebrtc \
	  --disable-opencore-amr
	cd $(BUILD_DIR) && $(MAKE) dep
	cd $(BUILD_DIR) && $(MAKE)
	@mkdir -p bin
	cp $(BUILD_DIR)/pjsip-apps/bin/pjsua-*-apple-darwin* $(BIN)
	@echo ""
	@echo "Built $(BIN). Verify with: $(BIN) --version"
```

- [ ] **Step 2: Run the build**

```bash
cd pot/cli-softphone && make bin/pjsua
```

Expected: configure + dep + main build run sequentially. First run takes
5–10 min on Apple Silicon. Final lines include the copy and the success
banner with the binary path.

If `configure` fails on Apple Silicon with "checking host system type… unable":
re-run with an explicit `--host`:

```bash
cd build/pjproject && ./configure --host=aarch64-apple-darwin \
  CFLAGS="-fPIC -O2" --disable-video --disable-libwebrtc --disable-opencore-amr
```

Then re-run `make bin/pjsua` from `pot/cli-softphone/`.

- [ ] **Step 3: Verify the binary works**

```bash
bin/pjsua --version
```

Expected: prints a pjsua banner showing version `2.14.1` and a list of
compiled-in features (codecs, transports). Should include `pcmu`,
`udp`, `ipv4`. Should **not** include `H.263`, `H.264`, `vpx` (video is
disabled).

- [ ] **Step 4: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): configure + build pjsua, copy to bin/"
```

---

### Task 5: Idempotent `make install` wrapper

**Files:**
- Modify: `pot/cli-softphone/Makefile` (add `install` phony target)

- [ ] **Step 1: Append the install target**

Append to `pot/cli-softphone/Makefile`:

```make
# Idempotent wrapper around the binary build. Re-runs are instant when
# bin/pjsua already exists.
install: $(BIN)
	@echo "pjsua ready at $(BIN)"
```

- [ ] **Step 2: Verify idempotency**

```bash
cd pot/cli-softphone && make install
```

Expected: since `bin/pjsua` already exists from Task 4, make sees the
target is up to date and only prints the `pjsua ready at bin/pjsua`
banner. Total runtime under one second.

- [ ] **Step 3: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): idempotent make install wrapper"
```

---

### Task 6: alice account config

**Files:**
- Create: `pot/cli-softphone/accounts/alice.cfg`

- [ ] **Step 1: Write alice.cfg**

```bash
mkdir -p pot/cli-softphone/accounts
```

Write `pot/cli-softphone/accounts/alice.cfg`:

```
# pjsua config — alice (extension 1001 in pot/S9-audio-loopback)
# Matches the [alice] endpoint/auth/aor in
# pot/S9-audio-loopback/asterisk-image/pjsip.conf

--id=sip:alice@127.0.0.1
--registrar=sip:127.0.0.1:5060
--realm=*
--username=alice
--password=alice-s9-pot

# pjsua's SIP listener — must not collide with Asterisk on 5060.
# Convention: alice 5070, bob 5071, future accounts 5072+.
--local-port=5070

# UDP only — matches S9 transport-udp.
--no-tcp

# rport/Via-derived NAT detection (no STUN needed on loopback).
--auto-update-nat=1

# PCMU is what the S9 Asterisk endpoints allow (allow=ulaw).
--add-codec=PCMU

# Highest practical log verbosity — every SIP message in/out with bodies,
# transport events, RTP stats, transaction state, registration timer.
--log-level=5
--app-log-level=5
```

- [ ] **Step 2: Smoke-test the config parses**

Prerequisite: the S9 Asterisk container should be running for this to
register successfully. If it's not:

```bash
cd pot/S9-audio-loopback && make up
```

Then from `pot/cli-softphone/`:

```bash
mkdir -p logs
bin/pjsua --config-file=accounts/alice.cfg --log-file=logs/smoke-alice.log
```

Expected within ~2 s of launch: pjsua TUI shows
`*** Press 'h' to hangup all calls, 'm' to make a new call ***` and
the status line includes `1 registered`. Press `q` and Enter to quit.

```bash
grep -E '(REGISTER|200 OK|registration success)' logs/smoke-alice.log | head -20
```

Expected: see the outgoing REGISTER, the 401 challenge, the
REGISTER with Authorization, the 200 OK, and a "registration success"
log line. Delete the smoke log: `rm logs/smoke-alice.log`.

If REGISTER fails: confirm the S9 stack is up
(`cd pot/S9-audio-loopback && make endpoints` should list `alice`
endpoint as `Unavailable 0 of inf` before registration, `Not in use 1 of inf` after).

- [ ] **Step 3: Commit**

```bash
git add pot/cli-softphone/accounts/alice.cfg
git commit -m "feat(cli-softphone): alice account config (ext 1001, port 5070)"
```

---

### Task 7: bob account config

**Files:**
- Create: `pot/cli-softphone/accounts/bob.cfg`

- [ ] **Step 1: Write bob.cfg**

Write `pot/cli-softphone/accounts/bob.cfg`:

```
# pjsua config — bob (extension 1002 in pot/S9-audio-loopback)
# Matches the [bob] endpoint/auth/aor in
# pot/S9-audio-loopback/asterisk-image/pjsip.conf

--id=sip:bob@127.0.0.1
--registrar=sip:127.0.0.1:5060
--realm=*
--username=bob
--password=bob-s9-pot

# pjsua's SIP listener. 5071 to stay clear of Asterisk (5060) and alice (5070).
--local-port=5071

--no-tcp
--auto-update-nat=1
--add-codec=PCMU

--log-level=5
--app-log-level=5
```

- [ ] **Step 2: Smoke-test**

S9 stack must be up (as in Task 6).

```bash
cd pot/cli-softphone
bin/pjsua --config-file=accounts/bob.cfg --log-file=logs/smoke-bob.log
```

Expected: TUI launches, `1 registered`. Quit with `q` + Enter.

```bash
grep -E '(REGISTER|200 OK|registration success)' logs/smoke-bob.log | head -20
```

Same expected output as alice. Cleanup: `rm logs/smoke-bob.log`.

Now run S9-side verification:

```bash
cd ../S9-audio-loopback && make endpoints
```

Expected (when the bob smoke test is still running): `bob` shows
`Not in use 1 of inf`. After quitting pjsua, `bob` returns to
`Unavailable`. (This is also a useful S9 sanity-check: confirms the
container's view of registrations is current.)

- [ ] **Step 3: Commit**

```bash
git add pot/cli-softphone/accounts/bob.cfg
git commit -m "feat(cli-softphone): bob account config (ext 1002, port 5071)"
```

---

### Task 8: `make alice` and `make bob` launch targets

**Files:**
- Modify: `pot/cli-softphone/Makefile` (add `alice`, `bob`, `$(LOGS)` targets)

- [ ] **Step 1: Append launch targets**

Append to `pot/cli-softphone/Makefile`:

```make
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
```

- [ ] **Step 2: Verify alice launches and logs**

S9 stack must be up.

```bash
cd pot/cli-softphone && make alice
```

Expected: pjsua TUI banner appears, status shows `1 registered`. A new
file `logs/alice-<ISO-UTC>.log` exists. Press `q` + Enter to quit.

```bash
ls -lt logs/alice-*.log | head -3
```

Expected: newest file is from the last few seconds, named per the
`%FT%H-%M-%SZ` UTC convention (e.g.
`logs/alice-2026-05-15T18-30-45Z.log`).

```bash
tail -50 logs/alice-*.log | head -50
```

Expected: includes the REGISTER request body, the 200 OK response, and
a `registration success` line. Verify the file is non-trivial:

```bash
wc -l logs/alice-*.log
```

Expected: at least 200 lines (level 5 is verbose).

- [ ] **Step 3: Verify bob launches and logs**

```bash
make bob
```

Same expected shape. Quit with `q`. Confirm `logs/bob-<ISO>.log` exists
with REGISTER + 200 OK.

- [ ] **Step 4: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): make alice / make bob launch targets with per-session logs"
```

---

### Task 9: `make tail-alice` and `make tail-bob`

**Files:**
- Modify: `pot/cli-softphone/Makefile` (add `tail-alice`, `tail-bob` targets)

- [ ] **Step 1: Append tail targets**

Append to `pot/cli-softphone/Makefile`:

```make
# Tail the most-recent log for the given account. Intended for a second
# terminal pane while pjsua's TUI runs in the first. `ls -t` sorts newest
# first; we take the first match.
tail-alice:
	@latest=$$(ls -t $(LOGS)/alice-*.log 2>/dev/null | head -1); \
	  if [ -z "$$latest" ]; then \
	    echo "No alice logs yet — run 'make alice' first."; exit 1; \
	  fi; \
	  echo "Tailing $$latest"; \
	  tail -f "$$latest"

tail-bob:
	@latest=$$(ls -t $(LOGS)/bob-*.log 2>/dev/null | head -1); \
	  if [ -z "$$latest" ]; then \
	    echo "No bob logs yet — run 'make bob' first."; exit 1; \
	  fi; \
	  echo "Tailing $$latest"; \
	  tail -f "$$latest"
```

- [ ] **Step 2: Verify when no log exists**

```bash
cd pot/cli-softphone && make clean 2>/dev/null; rm -f logs/alice-*.log
make tail-alice
```

Expected: exits with `No alice logs yet — run 'make alice' first.` and
non-zero status.

- [ ] **Step 3: Verify with a real log**

In one terminal:

```bash
make alice
```

In a second terminal:

```bash
cd pot/cli-softphone && make tail-alice
```

Expected: prints `Tailing logs/alice-<ISO>.log` and streams the live
SIP trace. Ctrl-C to stop the tail; `q` + Enter in the first terminal
to quit pjsua.

- [ ] **Step 4: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): tail-alice / tail-bob helpers"
```

---

### Task 10: `make clean` and `make uninstall`

**Files:**
- Modify: `pot/cli-softphone/Makefile` (add `clean`, `uninstall`)

- [ ] **Step 1: Append cleanup targets**

Append to `pot/cli-softphone/Makefile`:

```make
# Delete per-session logs only. Preserves the built binary and source tree.
clean:
	rm -rf $(LOGS)

# Full reset: remove built binary and pjproject source. After this, the
# next `make install` will re-clone and re-build (~5-10 min).
uninstall:
	rm -rf bin build
```

- [ ] **Step 2: Verify clean**

```bash
cd pot/cli-softphone && make alice    # generate at least one log
# (quit pjsua immediately with q + Enter)
ls logs/                              # confirm logs exist
make clean
ls logs/ 2>&1                         # expected: "No such file or directory"
```

- [ ] **Step 3: Verify uninstall (do NOT run during the build session — it removes the binary)**

This is a destructive smoke test. Skip it during initial implementation
unless you're prepared to wait for a re-build. The verification is
mechanical: confirm the recipe is correct by reading it. The full
end-to-end uninstall → re-install cycle can be left for the user to
exercise on demand.

- [ ] **Step 4: Commit**

```bash
git add pot/cli-softphone/Makefile
git commit -m "feat(cli-softphone): clean + uninstall targets"
```

---

### Task 11: Full README with usage + failure-mode triage

**Files:**
- Modify: `pot/cli-softphone/README.md` (replace placeholder with full content)

- [ ] **Step 1: Replace README content**

Write `pot/cli-softphone/README.md` (full overwrite):

````markdown
# pot/cli-softphone — pjsua-based SIP CLI softphone

Native macOS build of [pjproject](https://github.com/pjsip/pjproject)'s
`pjsua` reference softphone, pre-configured for the S9 audio-loopback
endpoints (alice / bob). Used to script REGISTER, INVITE, and call-flow
tests with full SIP+media+diagnostic traces written to `logs/`.

Design spec:
`docs/superpowers/specs/2026-05-15-cli-softphone-pjsua-design.md`.

## Quick start

```bash
# 1. Build pjsua (one-time, ~5-10 min on Apple Silicon)
make install

# 2. Boot the S9 Asterisk stack in a separate terminal
cd ../S9-audio-loopback && make up && cd -

# 3. Launch alice (Terminal A)
make alice

# 4. Launch bob (Terminal B, new terminal)
cd pot/cli-softphone && make bob

# 5. In alice's TUI: `m` then `sip:1002@127.0.0.1` to dial bob
# 6. In bob's TUI: `a` to answer, `h` to hang up, `q` to quit
```

Logs land in `logs/<account>-<ISO-UTC>.log`. Each launch is a new file.

## pjsua TUI cheatsheet

Once registered, the prompt accepts:

| Key | Action |
|-----|--------|
| `m` | Make a call (prompts for SIP URI) |
| `a` | Answer the incoming call |
| `h` | Hang up the current call |
| `H` | Hold the current call |
| `dq` | Dump current call quality / RTP stats |
| `du` | Dump signalling URI of the current account |
| `i` | Send IM (in-dialog SIP MESSAGE) |
| `s` | Subscribe to remote presence |
| `q` | Quit pjsua |
| `?` / `h` | Built-in help |

The TUI is line-oriented — type the key, press Enter.

## Targets

| Target | Action |
|--------|--------|
| `make install` | Idempotent build of `bin/pjsua` from pjproject 2.14.1. |
| `make alice` | Launch pjsua TUI as alice (ext 1001, port 5070). |
| `make bob` | Launch pjsua TUI as bob (ext 1002, port 5071). |
| `make tail-alice` | `tail -f` the most-recent alice log. |
| `make tail-bob` | `tail -f` the most-recent bob log. |
| `make clean` | Remove `logs/`. |
| `make uninstall` | Remove `bin/` and `build/` (forces re-build on next install). |
| `make help` | Print this list. |

## Log format

`logs/<account>-YYYY-MM-DDTHH-MM-SSZ.log` (UTC; colons replaced with
hyphens for Mac filename safety, matching the S9 evidence convention).

Level 5 includes:

- Every SIP message in/out (full headers + body).
- Transport selection and transaction state changes.
- Registration timer + refresh lifecycle.
- RTP send/receive counters and codec negotiation.
- Lossy events (out-of-order RTP, decoder underrun).

These files are gitignored. They're debug artefacts — not committed
evidence. Spike-Green readouts continue to live in
`pot/S9-audio-loopback/results/`.

## Failure modes

### `make install` fails at `./configure`

**Symptom:** `checking host system type... unable to guess host type`.

**Cause:** pjproject's `config.guess` predates Apple Silicon in some
release branches.

**Fix:** Re-run configure manually with an explicit host:

```bash
cd build/pjproject && ./configure --host=aarch64-apple-darwin \
  CFLAGS="-fPIC -O2" --disable-video --disable-libwebrtc --disable-opencore-amr
cd ../.. && make bin/pjsua
```

### `make install` fails with `xcrun: error: invalid active developer path`

**Cause:** Xcode Command Line Tools missing.

**Fix:** `xcode-select --install`, then re-run `make install`.

### `make alice` hangs at "starting..." for >30 s

**Cause:** S9 Asterisk container isn't running, or 5060 isn't reachable
from the host.

**Check:**

```bash
nc -uvz 127.0.0.1 5060
cd ../S9-audio-loopback && make endpoints
```

If the port is unreachable, restart Docker Desktop and re-run
`make up` in the S9 directory.

### `make alice` shows TUI but never reaches "1 registered"

**Cause:** auth mismatch or wrong registrar URL.

**Check the log file:**

```bash
grep -E '(REGISTER|401|403|404|registration failed)' logs/alice-*.log | tail -20
```

A 401 followed by a second REGISTER and 200 OK is the happy path. A 401
loop or 403 usually means a credential typo in `accounts/alice.cfg` —
re-check `--username` / `--password` against
`pot/S9-audio-loopback/asterisk-image/pjsip.conf`.

### macOS prompts for microphone permission

Expected on first call. REGISTER and INVITE both work without mic
permission — only the audio path (RTP send) needs it. If you decline
the prompt, the call still connects and you'll receive bob's audio;
sending audio fails silently.

### Port collision on 5070 / 5071

If another local SIP client is bound to alice's 5070 or bob's 5071,
pjsua exits with `bind() error` early in the log. Pick a different
free port in `accounts/<account>.cfg` (`--local-port=507N`).

## Limitations

- UDP transport only (matches S9; spec excludes TLS/TCP).
- No video, no presence, no recording (spec out-of-scope).
- `--realm=*` accepts any auth challenge realm — fine for a localhost
  spike tool, not safe to reuse verbatim in production-leaning code.
- Build is not committed; first `make install` on a fresh checkout
  takes 5–10 min.
````

- [ ] **Step 2: Verify**

```bash
cd pot/cli-softphone && make help    # still works
wc -l README.md                       # ~140 lines
```

Read the README top-to-bottom; the Quick Start commands should match
the Makefile targets exactly.

- [ ] **Step 3: Commit**

```bash
git add pot/cli-softphone/README.md
git commit -m "docs(cli-softphone): full README with usage + failure-mode triage"
```

---

### Task 12: End-to-end verification — REGISTER + INVITE between alice and bob

**Files:** (no source changes; this is the live integration test)

**Pre-flight:** S9 Asterisk stack running (`cd pot/S9-audio-loopback && make up`).

- [ ] **Step 1: Both accounts register**

Terminal A:

```bash
cd pot/cli-softphone && make alice
```

Expected: TUI banner, `1 registered`.

Terminal B:

```bash
cd pot/cli-softphone && make bob
```

Expected: TUI banner, `1 registered`.

Terminal C (verification):

```bash
cd pot/S9-audio-loopback && make endpoints
```

Expected: both `alice` and `bob` show `Not in use 1 of inf`.

- [ ] **Step 2: alice dials bob**

In Terminal A's pjsua TUI: press `m`, Enter. When prompted for the SIP
URL, type `sip:1002@127.0.0.1`, Enter.

Expected: Terminal A shows `INVITE sent`. Terminal B shows an incoming
call from `sip:alice@127.0.0.1`.

In Terminal B: press `a`, Enter to answer.

Expected: both TUIs show `media transport state: ACTIVE`. Call connects.

- [ ] **Step 3: Hang up**

In Terminal A: press `h`, Enter.

Expected: both TUIs show the call ending and return to the `1 registered`
prompt.

- [ ] **Step 4: Inspect the alice log**

In Terminal C:

```bash
cd pot/cli-softphone
latest=$(ls -t logs/alice-*.log | head -1)
echo "Reading $latest"
grep -E '^(.{20})? (INVITE|ACK|BYE|200 OK|180 Ringing|REGISTER)' "$latest" | head -40
```

Expected to see in order:

1. Outgoing `REGISTER` and 401 challenge + auth REGISTER + `200 OK`.
2. Outgoing `INVITE` with SDP offer.
3. Incoming `180 Ringing`.
4. Incoming `200 OK` with SDP answer.
5. Outgoing `ACK`.
6. Outgoing `BYE`.
7. Incoming `200 OK` (for the BYE).

This is the canonical SIP call flow. If any step is missing, the spike
is incomplete — diagnose using the per-message detail in the log.

- [ ] **Step 5: Inspect the bob log**

```bash
latest=$(ls -t logs/bob-*.log | head -1)
grep -E '^(.{20})? (INVITE|ACK|BYE|200 OK|180 Ringing|REGISTER)' "$latest" | head -40
```

Expected: mirror image — incoming INVITE, outgoing 180 Ringing,
outgoing 200 OK, incoming ACK, incoming BYE, outgoing 200 OK.

- [ ] **Step 6: Quit both pjsua sessions**

Both terminals: `q` + Enter.

- [ ] **Step 7: No commit**

This task verifies behaviour. No source changes; the logs themselves
are gitignored. If everything passed, the implementation is complete.

If any step failed, fix the underlying issue (per the
"Failure modes" section in `README.md`), then re-run Task 12 in full.

---

## Self-review notes

- **Spec coverage:** all sections of the design doc map to a task —
  layout (Task 1), build pipeline (Tasks 3–5), account configs
  (Tasks 6–7), Make targets (Tasks 8–10), README incl. failure modes
  (Task 11), and the day-to-day flow itself is the verification harness
  (Task 12). Logging conventions (`%FT%H-%M-%SZ` UTC, level 5, gitignored)
  are wired in Tasks 8 and 11.
- **Placeholders:** none. Every config file, Makefile fragment, and
  command is concrete.
- **Type/name consistency:** `PJPROJECT_TAG=2.14.1`, `BIN=bin/pjsua`,
  `LOGS=logs`, `BUILD_DIR=build/pjproject` are defined once in Task 2
  and reused unchanged across all subsequent tasks. Per-account ports
  (alice 5070, bob 5071) match between configs (Tasks 6–7), README
  (Task 11), and the failure-mode triage.
- **TDD exception:** marked explicitly at the top of the plan — this is
  a tooling spike, verified via build-output + live integration.
