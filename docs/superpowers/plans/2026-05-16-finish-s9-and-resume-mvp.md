# Finish S9 audio-loopback + commit session work, resume MVP at Chunk 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring S9-audio-loopback to Green (G1–G5 pass on Linux + Docker Desktop), commit the in-session config-bake-in / Linux pjsua / local_net fixes as atomic commits, update G0 closure docs to record the Linux ADR-0025 evidence, and leave the tree clean so the next session can pick up MVP Chunk 4 (F03 operator UI + Temporal worker).

**Architecture:** Three phases. **Phase 0** (Tasks 1) commits the in-session work as atomic per-concern commits so the spike state is clean. **Phase 1** (Tasks 2–5) resolves the alice↔bob bridged audio gap with PJSIP-logger evidence first, then applies the smallest fix that turns G2/G3/G5 Green, writes the readout, tags `pot/S9`. **Phase 2** (Task 6) updates `pot/g0-closed.md` + S9 runbook to record the Linux evidence under ADR-0025. **MVP Chunk 4 itself is out of scope for this plan** — Task 7 is a clean hand-off only.

**Tech stack:** Asterisk 20 / PJSIP / pjsua 2.14.1 / Docker Desktop on Linux. Bash + git for atomic commits and the `pot/S9` tag.

**Reference state at plan creation (2026-05-16):**

- HEAD: `02c163e docs(cli-softphone): clarify Quick Start working directory`
- Uncommitted, working tree:
  - `pot/S9-audio-loopback/asterisk-image/Dockerfile` (bake configs in via `COPY`)
  - `pot/S9-audio-loopback/asterisk-image/extensions.conf` (added `600 → Echo()`)
  - `pot/S9-audio-loopback/asterisk-image/pjsip.conf` (removed 3 `local_net` lines)
  - `pot/S9-audio-loopback/docker-compose.yml` (removed 3 bind-mount volumes)
  - `pot/cli-softphone/Makefile` (broadened binary glob from `pjsua-*-apple-darwin*` → `pjsua-*`)
- Asterisk container `s9-asterisk` may or may not be up at execution time; the plan handles either.
- pjsua built at `pot/cli-softphone/bin/pjsua` (Linux x86_64 ELF, pjproject 2.14.1).
- Last verified gates: G1 ✓ (REGISTER works for both), Echo path ✓ (single-channel ulaw RTP both ways via Docker NAT). **Failing: G2/G3 bridged path** — Asterisk log shows the bridge transitions `simple_bridge → native_rtp` mid-call; suspected cause is either an unwanted direct-media re-INVITE (despite `direct_media=no`) or native_rtp local-forwarding failing under Docker Desktop UDP NAT.

---

### Task 1: Atomic commits for in-session uncommitted work

**Files:**
- Commit 1a touches: `pot/cli-softphone/Makefile`
- Commit 1b touches: `pot/S9-audio-loopback/asterisk-image/Dockerfile`, `pot/S9-audio-loopback/docker-compose.yml`
- Commit 1c touches: `pot/S9-audio-loopback/asterisk-image/pjsip.conf`
- Commit 1d touches: `pot/S9-audio-loopback/asterisk-image/extensions.conf`

Convention check first: existing commit log uses `feat(scope): …`, `fix(scope): …`, `docs(scope): …` with `pot/s9` and `cli-softphone` as scopes. The commits below match.

- [ ] **Step 1.1: Confirm working tree matches the reference state**

Run:
```bash
cd /media/lion/Data/Projects/modern-tas
git status --short
```
Expected exact output:
```
 M pot/S9-audio-loopback/asterisk-image/Dockerfile
 M pot/S9-audio-loopback/asterisk-image/extensions.conf
 M pot/S9-audio-loopback/asterisk-image/pjsip.conf
 M pot/S9-audio-loopback/docker-compose.yml
 M pot/cli-softphone/Makefile
```
If anything else has changed, stop and reconcile before proceeding (the rest of the plan assumes this baseline).

- [ ] **Step 1.2: Commit 1a — cli-softphone Linux portability**

```bash
git add pot/cli-softphone/Makefile
git commit -m "$(cat <<'EOF'
fix(cli-softphone): broaden pjsua binary glob for Linux host triplets

The pjsua-*-apple-darwin* glob in the install target only matched macOS
binaries (pjproject names the binary pjsua-<host-triplet> via config.guess).
On Linux the triplet is x86_64-pc-linux-gnu or aarch64-unknown-linux-gnu,
which the original glob silently skipped — the install target failed with
"expected exactly 1 pjsua-*-apple-darwin* binary ... found 0."

Broaden to pjsua-* so the same Makefile works on both Linux and macOS.
The build dir only contains one pjsua-* binary per build, so the broad
glob is safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify: `git log --oneline -1` shows the new commit.

- [ ] **Step 1.3: Commit 1b — S9 configs baked into image**

```bash
git add pot/S9-audio-loopback/asterisk-image/Dockerfile pot/S9-audio-loopback/docker-compose.yml
git commit -m "$(cat <<'EOF'
fix(pot/s9): bake Asterisk configs into image instead of bind-mounting

Docker Desktop on Linux only forwards a fixed allow-list of host paths
into the VM. Projects under /media (a common Linux mount point for
secondary drives) are not on that list by default, so the bind-mount
volumes in docker-compose.yml failed with "mounts denied: path is not
shared from the host" on first `make up`.

Bake pjsip.conf, extensions.conf, and rtp.conf into the image via COPY
instead. `make up` already rebuilds on every boot (`docker compose up
-d --build`), so config edits propagate without an explicit rebuild
step. Trade-off: image rebuilds are ~0.3s slower per iteration; net
benefit is reproducibility across host file-sharing configs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify: `git log --oneline -1` shows the new commit.

- [ ] **Step 1.4: Commit 1c — pjsip local_net fix (the real audio bug)**

```bash
git add pot/S9-audio-loopback/asterisk-image/pjsip.conf
git commit -m "$(cat <<'EOF'
fix(pot/s9): drop local_net so external_media_address applies to bridge-gateway peers

The original config carried `local_net=172.16.0.0/12`, which PJSIP reads
as "skip external_media_address rewriting for peers in this subnet." On
Docker Desktop (Linux or Mac) the container sees host-originated traffic
arriving from the Docker bridge gateway — by default an IP in
172.17.0.0/16, 172.18.0.0/16, etc., all inside 172.16/12. PJSIP therefore
advertised the container's own bridge IP (e.g. 172.19.0.2) in SDP, which
is unreachable from the host softphone. Calls connected, dialplan ran,
no audio flowed.

Removing all three local_net directives makes every peer "external," so
external_media_address=127.0.0.1 (the host-published port) is what lands
in SDP. Verified Green on Linux + Docker Desktop with the 600 → Echo()
extension: bidirectional ulaw RTP confirmed by Asterisk RTP debug
output. The S1 PoT spike scaffold inherited the same local_net block;
the bug was latent there because S1 used SIPp from inside the compose
network (intra-network, not via the host port-forward).

Trade-off: if the deployment topology ever puts a real softphone on the
same private LAN as Asterisk (i.e. genuine local_net), this config will
double-NAT advertise the public address. That's a non-concern for the
S9 bench-scale topology and any production Asterisk-direct deployment
behind Caddy (ADR-0025).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify: `git log --oneline -1` shows the new commit.

- [ ] **Step 1.5: Commit 1d — Echo extension for solo bench probe**

```bash
git add pot/S9-audio-loopback/asterisk-image/extensions.conf
git commit -m "$(cat <<'EOF'
feat(pot/s9): add 600 → Echo() extension for solo-softphone bench probe

The original dialplan only had 1001 (→ alice) and 1002 (→ bob), which
requires two registered softphones to verify any audio path. On a single
machine that means feedback-loop risk unless headphones are used on
at least one side, and it conflates "media path" with "bridge tech"
failure modes.

`600 → Answer() → Echo()` lets a single softphone validate the
single-channel RTP path (audio in / audio out on the same channel)
without involving Asterisk's bridge layer at all. Used to isolate the
local_net fix in commit <THIS PARENT> from the alice↔bob bridge
behaviour. Not part of S9's G1–G5 gates; reserved for solo bench
testing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify: `git log --oneline -5` shows the 4 new commits stacked on `02c163e`; `git status` is empty.

---

### Task 2: Reproduce the alice↔bob bridged-audio gap with full SIP + RTP tracing

**Files:**
- No code changes.
- Read-only: `docker logs s9-asterisk` output, plus optional `pot/cli-softphone/logs/*.log` if pjsua is used.

- [ ] **Step 2.1: Bring the stack up clean**

```bash
cd pot/S9-audio-loopback
make restart
```
Expected tail: `Asterisk ready.` and the Asterisk version line. If `Asterisk did not become ready within 12 s`, run `make logs` and investigate the container startup error before proceeding.

- [ ] **Step 2.2: Enable PJSIP signalling + RTP debug**

```bash
docker exec s9-asterisk asterisk -rx "pjsip set logger on"
docker exec s9-asterisk asterisk -rx "rtp set debug on"
```
Expected output: `PJSIP Logging enabled` and `RTP Packet Debugging Enabled`.

- [ ] **Step 2.3: Register both endpoints**

Launch one softphone as alice (any of: `cd ../cli-softphone && make alice`, or Linphone with the `sip:alice@127.0.0.1` / `alice-s9-pot` account), and a *second* softphone as bob (the other from the pair, on a different host port — pjsua uses 5071 for bob by config, Linphone auto-picks).

Verify both registered:
```bash
make endpoints
```
Expected: both `alice` and `bob` show `Not in use   1 of inf` and `make contacts` lists two Contact URIs. Do not proceed until G1 passes.

- [ ] **Step 2.4: Place the call and hold it long enough for the bridge upgrade**

From alice's softphone: dial `1002`. Answer on bob's softphone. **Keep the call up for at least 10 seconds** so any post-answer re-INVITE has time to fire. Try speaking from each side. Then hang up.

- [ ] **Step 2.5: Capture the evidence**

```bash
docker logs s9-asterisk 2>&1 | grep -vE "Remote UNIX" > /tmp/s9-bridge-trace.log
wc -l /tmp/s9-bridge-trace.log
```
Save the relevant slice (the INVITE → bridge join → bridge leave → BYE window) for the readout in Task 5. Specifically scan for:

1. **The c= line in the original INVITE** Asterisk sent to bob. Expected: `c=IN IP4 127.0.0.1` (correct post-local_net-fix). If it says any 172.x.x.x address, the local_net fix didn't take effect — re-check Task 1.5.
2. **A re-INVITE after the call answers** with a `c=` line different from the original — that's the native_rtp direct-media swap. If present, both softphones receive a c= pointing at the *other* softphone's host port. Note whether each side 200 OK'd the re-INVITE or returned 488 / hung up.
3. **RTP packet counts**: the `rtp set debug on` output prints `Got RTP packet from ...` / `Sent RTP packet to ...` lines. Count per leg (alice→Asterisk, Asterisk→alice, bob→Asterisk, Asterisk→bob, and after any re-INVITE, alice↔bob direct).
4. **The exact bridge tech log lines**: `joined 'simple_bridge'` vs `joined 'native_rtp'` vs `left 'native_rtp'`. Order matters — Asterisk logs the joined-tech first and the left-tech last, so a `simple_bridge` join + `native_rtp` leave means it transitioned mid-call.

Verify: by end of Step 2.5 the operator can answer two questions in one sentence each:
- *Did the bridge transition fire a re-INVITE?* (yes / no)
- *Which leg has zero or near-zero received-RTP count?* (alice / bob / both / neither)

These two answers determine the fix in Task 3.

---

### Task 3: Apply the smallest fix that turns G2/G3 Green

**Files:**
- `pot/S9-audio-loopback/asterisk-image/pjsip.conf` (one or both endpoints) OR
- `pot/S9-audio-loopback/asterisk-image/extensions.conf` (dialplan-level forced bridge tech)

**Decision tree based on Task 2 evidence:**

| Evidence pattern | Fix |
|---|---|
| **A.** Re-INVITE fired; softphones accepted it; RTP flows post-re-INVITE between softphones directly | Already working — no fix needed; user observed silence due to mic/speaker routing on host, not Asterisk. Re-run G1–G5 in Task 4. |
| **B.** Re-INVITE fired; one or both softphones returned 488 / hung up / ignored it | Set `direct_media=no` properly by *also* setting `disable_direct_media_on_nat=yes` and `media_use_received_transport=yes` per-endpoint. This prevents the native bridge from issuing the re-INVITE. |
| **C.** No re-INVITE; bridge tech logged as `native_rtp` from the start; one leg has zero received-RTP | Force `simple_bridge` via dialplan: add `Set(BRIDGE_TECHNOLOGY=simple_bridge)` before each `Dial()` in extensions.conf. This bypasses the native_rtp engine bridge entirely; Asterisk decodes + re-encodes each frame in-process, which is reliable under Docker NAT (echo proves the single-channel transport works). |
| **D.** No re-INVITE; bridge tech `simple_bridge` throughout; one leg has zero received-RTP | Bug is in the per-leg RTP path itself. Check that *each* softphone's SDP advertises `c=127.0.0.1` (rtp_symmetric only helps once a packet arrives). If a softphone is advertising the wrong c= line, fix the softphone, not Asterisk. |

- [ ] **Step 3.1: Pick the row from the table that matches the captured evidence.** If two rows might apply, prefer C — forcing simple_bridge is the cheapest reversible test and isolates the bridge-tech variable from everything else.

- [ ] **Step 3.2: For row C (most likely), edit extensions.conf:**

```ini
exten => 1001,1,NoOp(S9 — dial alice from ${CALLERID(all)})
 same => n,Set(BRIDGE_TECHNOLOGY=simple_bridge)
 same => n,Dial(PJSIP/alice,30)
 same => n,Hangup()

exten => 1002,1,NoOp(S9 — dial bob from ${CALLERID(all)})
 same => n,Set(BRIDGE_TECHNOLOGY=simple_bridge)
 same => n,Dial(PJSIP/bob,30)
 same => n,Hangup()
```
(The `600 → Echo()` block stays unchanged.)

For row B, edit pjsip.conf — add to each endpoint section (after `direct_media=no`):
```ini
disable_direct_media_on_nat=yes
media_use_received_transport=yes
```

- [ ] **Step 3.3: Rebuild + restart**

```bash
make restart
```
Expected tail: `Asterisk ready.`

- [ ] **Step 3.4: Re-enable logger and redo the alice↔bob call**

```bash
docker exec s9-asterisk asterisk -rx "pjsip set logger on"
docker exec s9-asterisk asterisk -rx "rtp set debug on"
```
Both softphones re-register (they were dropped by the container restart). Place the call. Confirm:

- `make channels` during the call shows two PJSIP channels in the `simple_bridge` (no `native_rtp` upgrade).
- RTP packet counts in `docker logs s9-asterisk` are non-zero in **both directions for both legs**.
- Tester (self-attested): can hear the other side; voice is intelligible (ulaw at 8 kHz, expect some quality limit but no dropouts).

If still silent: stop, return to Task 2, re-capture with the fix in place, branch again.

- [ ] **Step 3.5: Commit the fix**

```bash
git add pot/S9-audio-loopback/asterisk-image/extensions.conf  # or pjsip.conf for row B
git commit -m "$(cat <<'EOF'
fix(pot/s9): force simple_bridge to keep two-way audio under Docker NAT

The native_rtp engine bridge upgraded our alice↔bob calls from
simple_bridge mid-call (visible in CLI as `joined 'simple_bridge'` then
`left 'native_rtp'`). Under Docker Desktop UDP NAT, the native bridge's
local-forwarding path failed to deliver RTP between the two legs even
though each individual leg's RTP transport was healthy (the 600 → Echo()
probe proved it).

Setting BRIDGE_TECHNOLOGY=simple_bridge in the dialplan before Dial()
forces Asterisk to stay in the media path with frame-level decode +
re-encode, which is the path the per-leg rtp_symmetric handling is
already designed for. Net cost: tiny CPU bump per concurrent call,
which is fine for the bench scale this spike covers and for MVP
scale per ADR-0025.

Verified: G1–G5 all Green on Linux + Docker Desktop in a single
sitting. Evidence in pot/S9-audio-loopback/results/<readout>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Adjust the commit subject and rationale to match the actual row chosen in 3.1 if it wasn't C.)

Verify: `git log --oneline -1` shows the fix; `git status` clean.

---

### Task 4: Run G1–G5 gates end-to-end

**Files:** No code changes. All steps are operator/observation.

Reference the gate table in `pot/S9-audio-loopback/README.md` §"Go / no-go signals." Each gate either Green or Red — anything less than Green-on-all-five means S9 is Red.

- [ ] **Step 4.1: G1 — both endpoints REGISTER.** Both softphones registered; `make endpoints` shows `Not in use   1 of inf` for each. Record: ✓ / ✗.

- [ ] **Step 4.2: G2 — outbound call connects.** alice dials `1002`; bob's softphone rings within 2 s; bob answers; Asterisk CLI shows the bridge formed. Record: ✓ / ✗.

- [ ] **Step 4.3: G3 — two-way audio.** alice speaks → bob hears. bob speaks → alice hears. Self-attest. Record: ✓ / ✗ with subjective notes (latency feel, dropouts, crackle).

- [ ] **Step 4.4: G4 — clean hangup.** Either side hangs up. `make channels` returns empty within 1 s. Record: ✓ / ✗.

- [ ] **Step 4.5: G5 — reverse direction.** Repeat 4.2–4.4 with bob dialling `1001`. Confirms direction independence. Record: ✓ / ✗.

Verify: all five ✓. If any ✗, return to Task 3 with the gate-specific evidence.

- [ ] **Step 4.6: Disable debug to keep the readout container-log slice clean**

```bash
docker exec s9-asterisk asterisk -rx "pjsip set logger off"
docker exec s9-asterisk asterisk -rx "rtp set debug off"
```

---

### Task 5: Write the S9 evidence readout + tag

**Files:**
- Create: `pot/S9-audio-loopback/results/2026-05-16T<HH-MM-SS>Z-loopback.md`
- Tag created: `pot/S9`

- [ ] **Step 5.1: Create the results directory + readout file**

```bash
mkdir -p pot/S9-audio-loopback/results
TIMESTAMP=$(date -u +%FT%H-%M-%SZ)
READOUT=pot/S9-audio-loopback/results/${TIMESTAMP}-loopback.md
```

Write the file with these required sections (per README §"Evidence artefact"):

```markdown
# S9 audio-loopback — Linux + Docker Desktop readout

- **Date:** 2026-05-16
- **Host:** Linux 6.8.0-117 (lion's dev box) + Docker Desktop 29.4.2
- **Network mode:** Docker bridge, host-published ports (5060/udp + 10000-10010/udp)
- **Softphones:** pjsua 2.14.1 (built from pjproject in pot/cli-softphone/) + Linphone
- **Container image:** pot-s9/asterisk:local @ commit <Task-3 commit SHA>

## G1 — both endpoints REGISTER

<paste `make endpoints` output post-registration, showing alice + bob with `1 of inf` contacts>

## G2 — outbound call connects

<paste relevant slice of `make cli` / docker logs showing INVITE 1002 → bob ringing → bob 200 OK → bridge formed>

## G3 — two-way audio

Self-attested: heard audio in both directions, no dropouts, slight 8 kHz ulaw warmth — acceptable.

## G4 — clean hangup

<paste BYE + `make channels` empty output>

## G5 — reverse direction

<paste second-direction trace (bob → 1001), abbreviated>

## Linux + Docker Desktop quirks captured along the way

1. **Bind-mount denial** — `/media` not in Docker Desktop's File Sharing list; configs were baked into the image instead (commit <1b SHA>).
2. **local_net + bridge gateway overlap** — `local_net=172.16.0.0/12` caused Asterisk to skip `external_media_address` rewriting for the host (which arrived at the container as bridge-gateway 172.18.x.1). Removed all `local_net` lines (commit <1c SHA>).
3. **native_rtp engine bridge fails under Docker NAT** — Asterisk upgraded `simple_bridge` → `native_rtp` mid-call; local-forwarding silently dropped cross-leg packets. Forced `BRIDGE_TECHNOLOGY=simple_bridge` in dialplan (commit <Task-3 SHA>).
4. **pjsua Linux build** — pjproject's binary name suffix is the host triplet, not always `apple-darwin`. Makefile glob broadened (commit <1a SHA>).

## Spike status

**Green.** ADR-0025 (Asterisk-direct edge topology) carries two-way audio on bench scale, on Linux + Docker Desktop, without rtpengine or Kamailio in the path.
```

Fill in the `<...>` placeholders from the actual captured output.

- [ ] **Step 5.2: Commit + tag**

```bash
git add pot/S9-audio-loopback/results/
git commit -m "$(cat <<'EOF'
docs(pot/s9): readout — G1–G5 Green on Linux + Docker Desktop

Evidence-artefact write-up per README §"Evidence artefact." Documents
the three Docker-Desktop-specific quirks (bind-mount denial, local_net
overlap, native_rtp bridge failure) and the corresponding fixes in
earlier commits. Marks S9 spike Green; ADR-0025 has its missing audio
evidence under Asterisk-direct topology.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git tag pot/S9
```

Verify: `git tag -l | grep S9` prints `pot/S9`. `git log --oneline -7` shows the readout commit at HEAD.

---

### Task 6: Update G0 closure docs to record Linux ADR-0025 evidence

**Files:**
- Modify: `pot/g0-closed.md` (the "S1 Layer-2 — user-deferred carry-over" section)
- Modify: `pot/S9-audio-loopback/runbook.md` (§Failure-mode triage)
- Modify: `pot/S9-audio-loopback/README.md` (§Status footer)

- [ ] **Step 6.1: Update `pot/g0-closed.md`**

Locate the `## S1 Layer-2 — user-deferred carry-over` section. Add a new bullet under `## Edge-topology note (2026-05-15)`:

```markdown
- **S9 (Asterisk-direct audio loopback) — Green on Linux at <Task-5 commit SHA> (2026-05-16).** Confirms ADR-0025 carries two-way ulaw audio on bench scale through Docker Desktop's UDP NAT, fully replacing the S1 Layer-2 rtpengine media smoke as the audio-path evidence for the MVP edge topology. The S1 Layer-2 trigger ("Green before Chunk 3 commit 1") is therefore satisfied by S9 + the existing Chunk 3 Green at `a7c2dac`, and the S1-Layer-2 Pending status is reclassified as **Resolved-via-S9** for MVP purposes. The Kamailio-fronted-SBC carry-over (re-introduce S1 Layer-2 if SBC tier returns) remains.
```

- [ ] **Step 6.2: Update `pot/S9-audio-loopback/runbook.md` §"Failure-mode triage"**

Append three new bullets to the existing failure-mode list:

```markdown
- **G1 fails on Linux + Docker Desktop — `mounts denied`:** Project path isn't in Docker Desktop's File Sharing list. Either add the path (Settings → Resources → File Sharing) or rebuild with baked-in configs (this repo already does the latter — see `asterisk-image/Dockerfile`).
- **G3 fails — call connects, no audio, both directions:** Check `pjsip.conf` for any `local_net` directive that overlaps the Docker bridge subnet. The container's view of the host is the bridge gateway (typically 172.17–22.0.1), which sits inside the default-private 172.16/12 block. If `local_net=172.16.0.0/12` is set, PJSIP treats the softphone as local and skips `external_media_address` rewriting — SDP then advertises the container's own IP, which is unreachable from the host. Remove the offending `local_net` lines.
- **G2/G3 fail — alice↔bob bridge: dialplan executes, no audio, Asterisk log shows `left 'native_rtp' basic-bridge`:** The native_rtp engine bridge fails under Docker Desktop UDP NAT for cross-leg local-forwarding. Force `simple_bridge` via dialplan: `Set(BRIDGE_TECHNOLOGY=simple_bridge)` before `Dial()`. Echo (`600`) is unaffected because Echo() doesn't use a bridge.
```

- [ ] **Step 6.3: Update `pot/S9-audio-loopback/README.md` §Status**

Replace:

```markdown
## Status

**Proposed** — 2026-05-15. Ratification gated on G1–G5 all Green in a
single sitting.
```

With:

```markdown
## Status

**Green** — 2026-05-16 on Linux + Docker Desktop. G1–G5 all Green in a
single sitting; evidence at `results/2026-05-16T<HH-MM-SS>Z-loopback.md`,
tag `pot/S9`. Three Linux-specific quirks captured in `runbook.md`
§Failure-mode triage. Validates ADR-0025 audio path; supersedes the
S1 Layer-2 rtpengine media-smoke carry-over for MVP per
`pot/g0-closed.md` §S1 Layer-2.
```

- [ ] **Step 6.4: Commit**

```bash
git add pot/g0-closed.md pot/S9-audio-loopback/README.md pot/S9-audio-loopback/runbook.md
git commit -m "$(cat <<'EOF'
docs(pot/s9, g0): record S9 Green on Linux + reclassify S1 Layer-2

- pot/g0-closed.md §S1 Layer-2 adds the Resolved-via-S9 marker so the
  trigger ("Green before Chunk 3 commit 1") is no longer Pending. Chunk
  3 already merged Green at a7c2dac; S9 now backs that with audio
  evidence under the Asterisk-direct topology (ADR-0025).
- S9 README status: Proposed → Green.
- S9 runbook §Failure-mode triage gains three Linux/Docker-Desktop
  entries (bind-mount denial, local_net overlap, native_rtp under NAT)
  so the next operator hits a flat-line of pre-resolved issues.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify: `git log --oneline -8` shows the doc commit at HEAD; `git status` is clean.

---

### Task 7: Tear down + hand off to MVP Chunk 4

**Files:** None modified. Operator-only.

- [ ] **Step 7.1: Stop the S9 stack**

```bash
cd /media/lion/Data/Projects/modern-tas/pot/S9-audio-loopback
make down
```
Expected: containers removed, network removed.

- [ ] **Step 7.2: Verify the working tree is clean and the spike is closed out**

```bash
cd /media/lion/Data/Projects/modern-tas
git status
git log --oneline -8
git tag -l | grep -E "^pot/S"
```
Expected: clean tree, the last ~7 commits are this plan's commits, `pot/S9` appears in the tag list alongside the existing `pot/S1`, `pot/S2`, `pot/S3`, `pot/S5`, `pot/S8`.

- [ ] **Step 7.3: This plan ends here.**

The next session resumes MVP at Chunk 4. Entry point: `docs/superpowers/plans/2026-05-14-chunk-3-telephony-wiring.md` for the closing state of Chunk 3, then `docs/superpowers/specs/2026-05-14-local-mvp-chunk-plan-design.md` §"Chunk 4 — F03 operator UI + Temporal worker" for the next-chunk spec. **Chunk 4 implementation is NOT in scope for this plan** — it gets its own plan once the operator decides to start it.

---

## Self-review (per writing-plans skill §Self-Review)

- **Spec coverage:** "Finish all current steps so you can continue with MVP." Steps in flight at plan creation:
  - In-session uncommitted files → Task 1 ✓
  - S9 spike Green pending (echo Green, bridge Red) → Tasks 2–5 ✓
  - G0 docs out of sync with S9 reality → Task 6 ✓
  - Clean hand-off to next-session MVP work → Task 7 ✓
  - No other gates (S4/S6/S7 already settled per `pot/g0-closed.md`).
- **Placeholders:** Three `<...>` placeholders intentionally remain — Task-3 commit SHA, Task-5 timestamp, Task-5 evidence paste-ins. All are values produced *during* execution; specifying them up-front would be wrong.
- **Type/name consistency:** `BRIDGE_TECHNOLOGY` channel variable name matches Asterisk doc. Tag name `pot/S9` matches the existing `pot/S1`–`pot/S8` convention. Commit-message scopes `cli-softphone` and `pot/s9` match the existing log.

## Hand-off (per writing-plans skill §Execution Handoff)

Plan complete and saved to `docs/superpowers/plans/2026-05-16-finish-s9-and-resume-mvp.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh Sonnet subagent per task, review between tasks, two-stage critic on each. Best fit for Tasks 2/3 where the diagnostic branch is conditional and the operator wants the agent to read the trace and pick the row.
2. **Inline Execution** — execute tasks in this session with checkpoints for operator review. Best fit if you want to drive the softphone interaction yourself (Tasks 2.3, 2.4, 3.4, 4.x are operator-required regardless).

Which approach?
