# CLI Softphone (pjsua) — design

**Date:** 2026-05-15
**Author:** brainstorming session
**Status:** draft → awaiting review

## Goal

Provide a scriptable, log-rich CLI alternative to Linphone / Zoiper for
testing REGISTER, INVITE, and call flows against the S9 Asterisk
container (and any future telephony spike). Built on the pjproject
reference softphone (`pjsua`). Every session writes a full SIP + media
+ diagnostic trace to a dedicated logs folder for offline inspection.

## Why

The S9 runbook depends on two GUI softphones (Linphone, Zoiper). That
works for visual acceptance but is painful for:

- Repeated REGISTER attempts with tweaked credentials / transports.
- Capturing the exact SIP wire format for a failing INVITE.
- Driving the phone from a script or a test harness.
- Diffing two runs of the same scenario.

A pjsua CLI gives us: scriptable launch, full SIP/SDP/RTP trace in a
file we can grep, and a reference implementation that matches what
Asterisk's `chan_pjsip` and Kamailio's PJSIP-derived stacks expect on
the wire — so when it disagrees with our infra, the infra is the bug.

## Non-goals

- Not a replacement for Linphone/Zoiper for human-audible acceptance
  testing — pjsua's audio plumbing on Mac is fine but the GUIs remain
  the canonical "does it sound right" tool for the S9 readout.
- Not a load-test tool — that's sipp's job.
- Not a SIP library wrapper. We use pjsua's binary as-is; we are not
  writing C/Python/Node bindings.

## Scope

In: native macOS build of `pjsua`, two pre-baked account configs
(alice/bob) matching the S9 endpoints, Makefile to drive build +
launch, per-session timestamped logs in a dedicated folder.

Out: TLS/TCP transports (UDP only — matches S9); video; presence;
call recording; multi-tenant config sprawl. All trivially addable
later if a future spike needs them.

## Layout

```
pot/cli-softphone/
├── README.md             # usage + failure-mode triage
├── Makefile              # install, alice, bob, clean, uninstall, tail-*
├── .gitignore            # bin/, build/, logs/
├── bin/pjsua             # built binary (gitignored)
├── build/pjproject/      # source tree (gitignored)
├── accounts/
│   ├── alice.cfg         # pjsua --config-file content
│   └── bob.cfg
└── logs/                 # per-session timestamped traces (gitignored)
```

## Build pipeline (`make install`)

1. Clone pjproject at a pinned tag (`2.14.1` is the target — current
   stable as of late 2024; revisit if a later tag is GA at build time).
   Clone goes to `build/pjproject/`.
2. `./configure --prefix=$PWD/install --disable-video
   --disable-libwebrtc --disable-opencore-amr` with
   `CFLAGS="-fPIC -O2"`. The disables keep the build slim and avoid
   known macOS-Apple-Silicon snags in the video/webrtc paths.
3. `make dep && make` (no install step needed — we copy the binary
   manually).
4. Copy `pjsip-apps/bin/pjsua-*-apple-darwin*` → `bin/pjsua`.
5. Idempotency: re-running `make install` is a no-op when
   `bin/pjsua` already exists. `make uninstall` deletes `bin/` and
   `build/` for a clean rebuild.

Expected build time: 5–10 min the first time on Apple Silicon; cached
incremental rebuilds are seconds. The Makefile prints the binary path
on success.

## Account configs

`accounts/alice.cfg`:

```
--id=sip:alice@127.0.0.1
--registrar=sip:127.0.0.1:5060
--realm=*
--username=alice
--password=alice-s9-pot
--local-port=5070
--auto-update-nat=1
--add-codec=PCMU
--log-level=5
--app-log-level=5
--no-tcp
```

`accounts/bob.cfg` is identical with `alice` → `bob`,
`alice-s9-pot` → `bob-s9-pot`, and `--local-port=5071`. The local
port is the pjsua SIP listener — must not collide with the Asterisk
5060 bind. 5070/5071 keeps the two CLI accounts disjoint as well.

`--realm=*` lets pjsua respond to any auth challenge realm Asterisk
sends, which matters because Asterisk's challenge realm is configurable
and not pinned in the S9 config.

Log level 5 is the highest practical setting: SIP messages with
bodies, transport-layer events, transaction state, RTP statistics, and
registration lifecycle — exactly what's needed when REGISTER or INVITE
misbehaves.

## Make targets

| Target | Action |
|--------|--------|
| `make install` | One-time build of pjsua. Idempotent. |
| `make alice` | Launch pjsua TUI as alice. Writes `logs/alice-<ISO-ts>.log`. |
| `make bob` | Same as alice but for bob. |
| `make tail-alice` | `tail -f` the most-recent alice log. Run in a second pane. |
| `make tail-bob` | Same for bob. |
| `make clean` | Remove `logs/`. |
| `make uninstall` | Remove `bin/` and `build/`. |

The launch targets look like:

```
bin/pjsua \
  --config-file=accounts/alice.cfg \
  --log-file=logs/alice-$(date -u +%FT%H-%M-%SZ).log
```

CLI flags override config-file flags in pjsua, so the per-session log
path can be injected at invocation while keeping everything else in
the static config.

## Day-to-day flow

1. Boot S9 Asterisk: `cd pot/S9-audio-loopback && make up`.
2. Terminal A: `cd pot/cli-softphone && make install` (first time only).
3. Terminal A: `make alice`. pjsua's TUI launches, sends REGISTER,
   shows "registration success" within ~1 s. Verify from the S9
   container side: `cd pot/S9-audio-loopback && make endpoints` —
   alice should be `Not in use` with `1 of inf` contacts.
4. Terminal B (split or new): `cd pot/cli-softphone && make bob`.
5. In Terminal A's pjsua TUI: `m` → enter `sip:1002@127.0.0.1` →
   INVITE leaves; in Terminal B (bob's pjsua) the call is offered —
   answer with `a` 200 / decline with `h`.
6. End the call with `h`, quit with `q`.
7. Inspect: every byte of SIP/SDP plus RTP stats and registration
   lifecycle is in `logs/alice-<ts>.log` and `logs/bob-<ts>.log`.

## Logs

- Path: `pot/cli-softphone/logs/<account>-<ISO-8601-UTC>.log`.
- ISO timestamp uses `%FT%H-%M-%SZ` (colons replaced with hyphens for
  Mac filename safety, matching the S9 evidence convention).
- Level 5 includes: every SIP message in/out (full headers + body),
  transport selection, transaction state changes, registration timer,
  ICE candidates (if NAT helper is active), RTP send/receive counters,
  codec negotiation. Lossy events (out-of-order RTP, decoder underrun)
  are also captured.
- The logs folder is gitignored — these are throwaway debug artifacts,
  not committed evidence. (Evidence readouts for spike Greens live in
  the spike's own `results/` folder as before.)

## Risks and mitigations

- **pjproject macOS build flakiness.** Documented failure modes in
  `README.md`: configure detecting wrong host on Apple Silicon,
  missing pkg-config dependency, Xcode CLT not installed. Each has
  a one-line fix. If the build still fails after the documented
  fixes, fall back to `brew install pjsip` from a community tap and
  document the version skew.
- **Port collisions.** alice 5070, bob 5071, Asterisk 5060 — all
  distinct. The configs hard-code these; if a future spike needs
  more accounts the convention is "5070 + N".
- **macOS mic permission.** First call prompts the system permission
  dialog. README warns about this and notes that REGISTER + INVITE
  work without mic access — only the actual audio path needs it.
- **Realm wildcard auth.** `--realm=*` is convenient but also
  permissive: pjsua will answer any challenge. Acceptable for a spike
  tool targeting localhost; flagged here so it isn't reused verbatim
  in production-leaning artefacts.

## Testing this tool

Verification is hands-on at the spike level: run `make alice`, see
REGISTER succeed in both the pjsua TUI and `make endpoints` on the
Asterisk side, place a call to bob, confirm the SIP trace in the log
file shows a clean INVITE → 200 OK → ACK → BYE sequence. No
automated test — this is a debugging instrument, not a production
component. (If it later becomes load-bearing for a CI flow, sipp +
scripted dialplan are the correct primitives, not this tool.)

## Open questions

None at design time. All forks resolved during brainstorming:

- Native build (not Docker, not hybrid).
- pjsua interactive TUI (not Make-target-per-action, not custom wrapper).
- Log level 5 with everything (not configurable, not SIP-only).
- Location `pot/cli-softphone/` (not nested in S9, not under `tools/`).
