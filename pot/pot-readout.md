# PoT Readout — Phase 0 Exit Gate G0 Deliverable

This document is filled in as spikes execute and signed off at G0. One section per spike.

Status legend: **Not started** · **In progress** · **Green** (signal met) · **Yellow** (signal partially met, remediation accepted) · **Red** (signal not met, ADR renegotiation required).

---

## S1 — End-to-end telephony happy path

- **Status:** Green (Layer 1 — signalling only)
- **Run dates:** 2026-05-13
- **Owner:** Telephony engineer (Claude / lion@levytskyy)
- **Result:** 100 INVITEs/10 s through `kamailio-primary` followed by 10 INVITEs/2 s through `kamailio-standby` (with `kamailio-primary` paused mid-flight) produced **screen-pop p50 = 2 ms, p95 = 2 ms, p99 = 5 ms, max = 5 ms** (vs the 800 ms p95 budget — ≈400× margin). Failover time-to-first-OK was **573 ms** (vs 30 s budget — ≈52× margin). Zero call loss across both phases. Post-test `core show channels` showed 0 active channels (no zombies).
- **Scope note:** S1 is split into Layer 1 (signalling) and Layer 2 (media via rtpengine). Only Layer 1 was attempted because the original scaffold was structurally untestable on macOS (rtpengine `network_mode=host` is a no-op on Docker Desktop). Layer 1 validates the architectural property the spike was meant to kill — Kamailio failover routes INVITEs to either node, and StasisStart reaches an ARI subscriber within the screen-pop budget. The README documents Layer 2 as deferred; production deployment-tier work (keepalived/VRRP, rtpengine media) tracks separately.
- **Probe note:** the original scaffold was un-runnable end-to-end — 11 issues, 3 of them structural. Fixes needed before any signal:
    1. `andrius/asterisk:22.9-current` doesn't exist (same as S2/S3) and `ghcr.io/kamailio/kamailio:6.0.0-alpine` also doesn't exist on the registry. Replaced both with local Ubuntu 24.04 builds (`asterisk-image/` and `kamailio-image/`). Also added a local SIPp build (`sipp-image/`, SIPp 3.6.1 from source); the standard PoT pattern for these spikes now reliably avoids missing public images.
    2. `fixtures/` was empty — authored Asterisk config set (`asterisk.conf`, `modules.conf`, `logger.conf`, `http.conf`, `ari.conf`, `pjsip.conf`, `extensions.conf`, `rtp.conf`) and Kamailio config (`kamailio.cfg` + `dispatcher.list`).
    3. The `make test` target was `@false`, and `screen-pop-loop.sh` was promised "at execution time, not scaffold time." Authored `scripts/run-test.sh` (phase 2 100-call screen-pop loop + phase 3 10-call failover) and `scripts/summarise.sh` (joins SIPp's per-call INVITE timestamps with the subscriber's per-call StasisStart timestamps by call-number, computes percentiles, emits Green/Yellow/Red).
    4. `baresip` was the original UAC choice; `docker compose exec baresip baresip -e "/dial 9999"` doesn't actually dial (the `-e` flag is a startup arg, not a runtime command). Dropped baresip entirely and switched to SIPp scenarios — SIPp produces per-call timestamps in `-trace_msg` output that the summariser parses for the join.
    5. The compose had `rtpengine` on `network_mode=host`, which is a no-op on darwin Docker Desktop. For Layer 1 (signalling), media doesn't need to flow so rtpengine was dropped from compose. Layer 2 will need an all-bridge rtpengine with explicit RTP port publishing.
    6. The two Kamailio nodes had no shared-VIP / keepalived mechanism, so the failover hazard wasn't actually exercisable by the original topology. Replaced the test driver's failover model with SIPp re-pointing at `kamailio-standby` after `docker compose pause kamailio-primary` — this validates "either node can route to Asterisk independently," which is the architectural property; VIP/keepalived is a deployment-tier Sprint-0 concern.
    7. There was no ARI app subscriber container, so the "screen-pop = INVITE-arrival → StasisStart-fires-at-Stasis-app" hazard had no measurement target. Authored `subscriber/` (Node 22 + native WebSocket; opens ARI WS to `s1-test`, records `t_event_received_ms` on every StasisStart, joins by `args[0]` from `Stasis(s1-test,${CALLERID(num)})`).
    8. The `make up` healthcheck loop's `grep -q '"Health":"unhealthy"'` short-circuited to "healthy" when the JSON output was empty (services still starting), so the runbook could proceed before anything was actually ready. Rewrote to require every service's `Health` column to leave "starting"/"unhealthy" before declaring ready.
    9. Three iterative bugs in the probe pipeline surfaced during execution and were fixed in-flight:
       - Kamailio's `record_route()` put `Record-Route: <sip:0.0.0.0;lr>` into the 2xx (Kamailio binds to 0.0.0.0); SIPp then ACKed to `0.0.0.0` and the ACK was lost, so Asterisk retransmitted 200 OK at T1 (~500 ms), wrecking screen-pop latency. Dropped `record_route()` and added an `if (has_totag()) { if (!loose_route()) ds_select_dst(...); t_relay(); }` branch to re-dispatch in-dialog ACK/BYE to Asterisk.
       - SIPp's `To:` header used only `[peer_tag_param]`, which expanded to `;tag=...` with no URI. BYE was malformed (`To: ;tag=...`) and Asterisk couldn't match it to the dialog, so channels stayed alive after BYE — 110/110 zombie channels after the first full-volume run. Fixed by `To: <sip:9999@[remote_ip]:[remote_port]>[peer_tag_param]`.
       - **Most consequential:** Asterisk's PJSIP `Answer()` blocks the dialplan for ~500 ms before returning (waits for SDP negotiation / ACK round-trip to settle), which would have made the screen-pop measurement = `~500 ms + actual app-notification latency` and dominated the budget by 60×. Without an `Answer()` in dialplan, however, no 200 OK ever returns and SIPp times out (3-second call length with 0 successful), so naively removing it doesn't work. Solution: dialplan calls `Stasis()` on a not-yet-answered channel; the subscriber issues `POST /ari/channels/{id}/answer` from inside `StasisStart` so the 200 OK fires after the subscriber has been notified. This measures the actual architectural property (INVITE-arrival → ARI-app-notified) and matches how a real screen-pop client would behave — the ARI app, not the dialplan, owns the answer decision.
- **Evidence:** `pot/S1-telephony-happy-path/results/20260513T061347Z/` (`summary.md`, `sipp-screen-pop_*` + `sipp-failover_*` trace/CSV/stats, `subscriber-phase2.jsonl`, `subscriber-phase3.jsonl`, `pause-epoch-ms.txt`, full container logs).
- **ADR(s) updated:** none. S1 has no primary ADR; the README documents that Yellow/Red results would inform an ADR-0016 amendment if reconciliation latency dominated, which it does not (StasisStart latency is dominated by network + ARI WS push, both single-digit ms).

## S2 — NestJS-arbitrated queue dequeue latency

- **Status:** Green
- **Run dates:** 2026-05-13
- **Owner:** Telephony + backend (Claude / lion@levytskyy)
- **Result:** Under steady-state load of ~200 callers in MOH (10 calls/sec arrival × 20 s scenario hold), the arbiter's operator-WS `accept` → ARI bridge → operator-WS `ring` round-trip ran **p50 = 4 ms, p95 = 6 ms, p99 = 9 ms, max = 99 ms** over 5 539 successful dequeue samples in a 10-minute window. Verdict GREEN against the 200 ms p95 budget by ~33× margin. Failed ring rate 146 / 5 685 (2.6 %), entirely caused by callers hanging up between `waiting.shift()` and `bridge.addChannel` — a real production race (operator accepts the call as the caller drops). Hazard surfaces named in the hypothesis were genuinely exercised: Redis `SET` calls went **118 → 5 983** across the window (lock renewal + snapshot ticks; the lock renewal on every dequeue is on the hot path), and NATS `in_msgs` went **22 → 11 532** (one publish per enqueue + one per dequeue ≈ 11 600 expected).
- **Probe note:** the scaffold committed before this run was **un-runnable end-to-end**. Fixes needed before Green could be claimed:
    1. `andrius/asterisk:22.9-current` doesn't exist on Docker Hub and the andrius tags that *do* exist have no arm64 builds — replaced with a local `asterisk-image/` build (Ubuntu 24.04 + `asterisk` package, Asterisk 20.6).
    2. `ctaloi/sipp:3.7` doesn't exist on Docker Hub — replaced with a local `sipp-image/` build (Debian bookworm + `sip-tester`, SIPp 3.6.1).
    3. `fixtures/asterisk/` was empty (only `.gitkeep`) and the compose `:ro`-mounts it onto `/etc/asterisk` — wrote the full minimal config set (`asterisk.conf`, `modules.conf`, `logger.conf`, `http.conf`, `ari.conf`, `pjsip.conf`, `extensions.conf`, `rtp.conf`, `musiconhold.conf`). The PJSIP anonymous endpoint also needed `endpoint_identifier_order=ip,username,anonymous` in `[global]`; the first run rejected SIPp's INVITE with "No matching endpoint found" until that was added.
    4. `fixtures/sipp/200-callers.xml` didn't exist — authored the SIPp UAC scenario (INVITE → 100/180/200 → ACK → 20 s pause → BYE).
    5. **Most consequential:** the original arbiter connected to Redis + NATS but never used them. Measuring its dequeue latency would have produced a meaningless Green — the contention probes named in the runbook (Redis lock contention, NATS lag) had no surface area to stress. Rewrote the arbiter to acquire + renew a Redis ownership lock per ADR-0024, snapshot the waiting heap to Redis every 5 s, publish enqueue/dequeue events to NATS, and renew the lock on every accept so the dequeue critical path actually touches both Redis and NATS.
    6. `make test` was a `@false` stub — wrote `scripts/run-test.sh` (10-min orchestrated load + snapshots), `scripts/summarise.sh` (p50/p95/p99 + hazard-exercise proof), `scripts/run-contention-{redis,nats}.sh`, and a new `operator-sim/` container that drives 10 virtual operator WS accepts at 10/s and writes the per-call CSV.
- **Evidence:** `pot/S2-queue-dequeue-latency/results/20260513T042757Z/` (`dequeue-latency.csv`, `summary.md`, `redis-cmdstats-t{0,5,10}.txt`, `nats-varz-t{0,5,10}.txt`, `operator-sim-stats.json`, `sipp-stats.csv`, `arbiter.log`).
- **Not run this session:** `make test-redis-contention` and `make test-nats-lag`. Both scripts are authored and validated by inspection (they inject `tc qdisc netem` delay onto the redis/nats container and re-run a 60-second probe) but a baseline p95 of 6 ms already establishes the budget by such a wide margin that ADR-0024's Yellow fallback to Asterisk `Queue()` is not on the table. The contention probes are listed as TODO for whoever needs to characterise the latency CDF under stress.
- **ADR(s) updated:** ADR-0024 (pending Decision flip from Proposed → Accepted on user confirmation).

## S3 — ARI leader 100 ms hard-stop

- **Status:** Green
- **Run dates:** 2026-05-13
- **Owner:** Telephony engineer (Claude / lion@levytskyy)
- **Result:** Chaos pause of leader-A produced **wire close-latency = 1 ms** (Asterisk-side FIN at +1 ms after leader-A's `heartbeat lost` event), well under the 100 ms budget. Standby took over within 1.4 s of chaos start (lease acquired + WS open + reconcile-done at +1474 ms) and hung up all 20 orphan channels (10 Local pairs × 2 halves) via `GET /ari/applications/pot-leader-test`'s `channel_ids` → bulk `DELETE /ari/channels/{id}` — well under the 7 s reconciliation budget. `channels-pre` 20 → `channels-post` 0 confirmed end-to-end cleanup.
- **Probe note:** the original scaffold was un-runnable end-to-end. Fixes needed before any signal:
    1. `andrius/asterisk:22.9-current` doesn't exist (same as S2); replaced with a local `asterisk-image/` build (Ubuntu 24.04 + `asterisk` + `tcpdump` + `iproute2` + `curl`).
    2. The Asterisk image's `/var/lib/asterisk` is owned by `asterisk:asterisk` per the Ubuntu package, but compose's `cap_add: [NET_RAW, NET_ADMIN]` interacts with Asterisk's startup capability handling such that DAC_OVERRIDE gets dropped — Asterisk running as `root` (per `asterisk.conf`'s `runuser = root`) then can't open `astdb.sqlite3` and exits with "Unable to open Asterisk database". Re-chowning those dirs to `root:root` in the Dockerfile sidesteps it.
    3. `fixtures/asterisk/` was empty; authored the minimal config set (`asterisk.conf`, `modules.conf`, `logger.conf`, `http.conf`, `ari.conf`, `extensions.conf`, `rtp.conf`, `musiconhold.conf`). No PJSIP needed — channels are created via ARI `POST /channels` with a Local endpoint into a tiny `s3-test` dialplan context.
    4. The `s3-test` dialplan extension *must* call `Answer()` before `Wait(120)` — otherwise the Local pair's `;2` half never completes entering Stasis, and `/ari/applications/pot-leader-test` reports zero channels even though `core show channels` shows the pair alive. Without `Answer()` the orphan-reconciliation path is structurally unreachable.
    5. `make test` was a `@false` stub. Wrote `scripts/run-test.sh` (originates channels, captures pcap, pauses + unpauses the elected leader, copies evidence out) and `scripts/summarise.sh` (parses pcap with the asterisk container's own tcpdump, correlates with the structured JSON logs both leaders write, emits the verdict).
    6. The original leader stub connected to ARI but had no reconciliation code path, and listed channels via `client.channels.list()` filtered by `dialplan.app_name === ARI_APP`. That filter is structurally wrong — ari-client v2's `dialplan.app_name` is the *dialplan* app currently executing (Wait, AppDial2, …), not the Stasis app. Rewrote reconcile to use `applications.get({applicationName})` and walk its `channel_ids`, which is the canonical "channels in this Stasis app" source.
- **Findings against ADR-0016 to address in the ratification turn:**
    1. **Heartbeat = TTL is racy.** The ADR's literal "SET … PX 1000 once per second" + "EXPIRE to 1 s on every heartbeat" causes both leaders to flap because the heartbeat fires *at* the TTL boundary — the `GET key` in renew returns nil and leadership is spuriously lost. Stable PoT config: 500 ms heartbeat with 1500 ms TTL (3:1 ratio). ADR-0016 §Decision needs revising.
    2. **Asterisk *accepts* a second WS for the same Stasis app.** ADR-0016 §Consequences claims "the second connection rejects" — but on Asterisk 20.6 the standby's WS opens successfully while the deposed leader's WS is still alive. The standby reconciles during the chaos pause, ~3.7 s *before* the FIN ever lands. This is *better* than the ADR assumed; the Decision can be tightened (orphan window is bounded by lease TTL, not by lease TTL + close-latency + new-WS handshake).
- **Evidence:** `pot/S3-ari-leader-hard-stop/results/20260513T052041Z/` (`pause.pcap`, `leader-a.log`, `leader-b.log`, `channels-pre.txt`, `channels-post.txt`, `chaos-meta.json`, `summary.md`).
- **ADR(s) updated:** ADR-0016 (pending Decision rewrite + status flip on user confirmation).

## S4 — Two-pass redaction accuracy on 8 kHz μ-law

- **Status:** Deferred (vendor + fixtures)
- **Run dates:** —
- **Owner:** Backend + compliance (deferred to Sprint 0)
- **Result:** Phase 0 attempt skipped. Two external prereqs are unavailable and cannot be synthesised without invalidating the measurement:
    1. **AssemblyAI Universal-3 Pro Medical API key.** Gated by vendor sales (medical-tier SKU, not self-serve). No drop-in substitute: replacing it with Whisper / faster-whisper / a non-medical AssemblyAI tier produces numbers about *that* ASR's WER on 8 kHz μ-law, not about the production component the ADR commits us to. The hazard ADR-0013 names (medical-domain ASR boundary accuracy under telephony band-limiting) is the same hazard the substitution erases.
    2. **30 audio fixtures @ 8 kHz μ-law with annotated PII spans.** Real telephony recordings of medical PII are not publicly available (HIPAA reasons) and the user has not yet captured them. Synthesising the corpus (TTS scripts → 8 kHz μ-law downsample) was considered and rejected: digit-by-digit number reading, accent variation, and codec artifacts are precisely the failure modes ADR-0013 calls out, and synthetic audio loses all three. A "Green" verdict on synthetic input would echo the S5 two-`psql` trap upstream — a runnable pipeline that doesn't exercise the named hazard.
    3. (Presidio container is cheap — open-source image, not a blocker on its own.)
- **G0 implication:** ARCHITECTURE v0.4 §2.4 requires every PoT spike Green-or-accepted-Yellow before G0 closes. A Deferred S4 is not on that enum. Sprint 0 must either land the prereqs (AssemblyAI medical key + fixture capture) and execute S4 inline, or de-scope ADR-0013 from MVP (e.g. ship without recording on HIPAA tenants, or accept the operational manual-QA backlog as the redaction strategy and skip the ML pipeline). The senior architect + compliance lead need to sign which path before G0 can be declared.
- **Sprint-0 carry-over checklist (when prereqs land):**
    - Define the ground-truth JSONL schema (the spike README mentions `start_ms, end_ms, kind, value` but no formal schema or example) and commit a `fixtures/ground-truth.example.jsonl` alongside it.
    - Pin `mcr.microsoft.com/presidio-analyzer` from `:latest` to a versioned tag for reproducibility.
    - Add a health check to the Presidio service in `docker-compose.yml` so the harness has a ready signal.
    - Author the harness probe (Steps 1–5 in `runbook.md` — none of this code exists yet; the scaffold is structurally honest about being a stub).
- **Evidence:** `pot/S4-redaction-accuracy/results/` (empty — nothing run).
- **ADR(s) updated:** ADR-0013 stays Proposed; ratification gated on Sprint-0 S4 execution or ADR-0013 de-scope.

## S5 — Supavisor `SET LOCAL` parity

- **Status:** Green
- **Run dates:** 2026-05-13
- **Owner:** SRE (Claude / lion@levytskyy)
- **Result:** Supavisor 1.1.66 in transaction mode honours the `SET LOCAL` boundary across transactions on a reused server backend. Two transactions in a single psql client session (tenant `pot`, `pool_size=1`, `mode_type=transaction`, `require_user=true`) both ran on backend pid 134; transaction 1 set `app.tenant_id = 'tenant-A'` via `SET LOCAL`; transaction 2 read `current_setting('app.tenant_id', true)` and got NULL/empty. No leak across the COMMIT boundary on the shared backend.
- **Probe note:** the original scaffold's probe (two separate psql invocations) was structurally invalid — distinct client sessions land on distinct server backends even at `pool_size=1`, so any "no leak" result would have been trivially true and unrelated to the `SET LOCAL` mechanic. The probe was corrected to run both transactions in a single psql client session and assert `pid_t1 == pid_t2`; the scaffold also gained `fixtures/init.sql` (creates `_supavisor` database + schema), a `supavisor-migrate` one-shot compose service (runs `bin/supavisor eval "Supavisor.Release.migrate"`), and a JWT-minting step in `fixtures/probe.sh` (Supavisor's admin API rejects literal `Bearer dev`; it expects HS256 signed with `API_JWT_SECRET`).
- **Evidence:** `pot/S5-supavisor-set-local/results/20260513T033050Z/` (`probe-output.txt`, `summary.md`, `tenant-create.json`)
- **ADR(s) updated:** ADR-0018 (pending Decision flip from Proposed → Accepted on user confirmation)

## S6 — `/v1` byte-for-byte fixture capture

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S6-ncall-fixture-capture/results/`
- **ADR(s) updated:** —

## S7 — Temporal Cloud BAA + EU namespace

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S7-temporal-baa/results/`
- **ADR(s) updated:** ADR-0015

## S8 — Caddy 2.10+ permission + LE rate-limit

- **Status:** Not started
- **Run dates:** —
- **Owner:** —
- **Result:** —
- **Evidence:** `pot/S8-caddy-le-posture/results/`
- **ADR(s) updated:** ADR-0019

---

## G0 sign-off

- [ ] All 8 spikes Green, or written remediation for Yellow
- [ ] All spike directories tagged `pot/<spike>` in git
- [ ] Senior architect signature: ___________________ date: ____________
- [ ] Compliance lead signature: ___________________ date: ____________
