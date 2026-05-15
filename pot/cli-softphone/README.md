# pot/cli-softphone — pjsua-based SIP CLI softphone

Native macOS build of [pjproject](https://github.com/pjsip/pjproject)'s
`pjsua` reference softphone, pre-configured for the S9 audio-loopback
endpoints (alice / bob). Used to script REGISTER, INVITE, and call-flow
tests with full SIP+media+diagnostic traces written to `logs/`.

Design spec:
`docs/superpowers/specs/2026-05-15-cli-softphone-pjsua-design.md`.

## Quick start

All commands below run from `pot/cli-softphone/`.

```bash
# 1. Build pjsua (one-time, ~5-10 min on Apple Silicon)
make install

# 2. Boot the S9 Asterisk stack in a separate terminal
(cd ../S9-audio-loopback && make up)

# 3. Launch alice (Terminal A)
make alice

# 4. Launch bob (Terminal B, new terminal — also from pot/cli-softphone/)
make bob

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
