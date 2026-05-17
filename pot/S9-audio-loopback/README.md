# S9 — Audio loopback (Asterisk-direct, two softphones on Mac)

## Hypothesis

A single Asterisk container running on macOS Docker Desktop, with no
Kamailio SBC and no rtpengine, can register two SIP softphones on the
host, route a call between them via static dialplan, and carry two-way
audio over RTP on the Mac loopback / host-bridge network — validating
ADR-0025 (Asterisk-direct edge topology) at bench scale.

## Why this spike

ADR-0025 was ratified at commit `ed17f74` (2026-05-15) on a paper
argument: the Kamailio-fronted SBC topology validated in S1 is
oversized for MVP scale, and Asterisk handles SIP signalling + RTP
forwarding in-process via `res_rtp_asterisk`. Nothing in the repo
demonstrates this end-to-end with **real audio**. S1 was Green at
Layer 1 (signalling) only; Layer 2 (rtpengine media) was deferred and
is now moot for MVP under ADR-0025. S9 is the missing audio evidence.

This is the smallest possible probe that proves the new topology
floor case works.

## Scope (in)

- **One Asterisk 22 LTS container** running in Docker Desktop on the
  Mac, with PJSIP on UDP/5060 and an RTP range of UDP/10000–10010
  bound to host ports (Docker `host.docker.internal` style
  port-mapping).
- **Two static PJSIP endpoints** — `alice` and `bob` — defined inline
  in `pjsip.conf` (no realtime DB, no auth flows beyond plain
  username/password). Each endpoint binds to extension `1001` /
  `1002` respectively.
- **Trivial dialplan** in `extensions.conf`: dial `1001` → originates
  to PJSIP endpoint `alice`; dial `1002` → originates to `bob`.
  Default context is `tas-loopback`. No queue, no MOH, no transfer.
- **One codec only:** `ulaw` (G.711μ). No codec negotiation surface
  area for this spike.
- **Two Mac softphones registered against the container's host-mapped
  5060/udp**: Linphone (alice@127.0.0.1) and Zoiper Free
  (bob@127.0.0.1).
- **Probe:** human-driven. Linphone dials `1002`; Zoiper rings; both
  answer; tester speaks into Mac mic on each end and confirms hearing
  themselves on the other side.

## Scope (out — explicitly deferred)

- **Carrier trunk leg.** Real SIP carrier (Telnyx, Twilio, etc.)
  → Asterisk → softphone is a separate spike (provisional name
  `S10-carrier-trunk-loopback`).
- **rtpengine, Kamailio, SBC tier.** Deferred per ADR-0025
  re-introduction trigger.
- **WebRTC (`wss://` + DTLS-SRTP).** Out of scope; requires
  cert + ICE/STUN work. Future spike.
- **Realtime PJSIP via Postgres.** Static `pjsip.conf` is sufficient
  to prove the topology. Realtime is an MVP module concern.
- **Recording, MixMonitor, transcoding, transfer, three-way, queue,
  MOH, IVR.** All separate concerns; not in scope here.
- **Automated SIPp-driven replay.** Manual verification is the
  primary signal. SIPp automation is a later spike or part of the
  Chunk-3 integration test.
- **HA / failover / DNS SRV.** Single-Asterisk per ADR-0025.

## Go / no-go signals

| Signal | Pass condition |
|---|---|
| **G1 — Both endpoints REGISTER** | `asterisk -rx "pjsip show endpoints"` shows both `alice` and `bob` in `Unavailable → Not in use` or similar "registered" state; `Contacts` column shows the Mac softphones' transport URIs. |
| **G2 — Outbound call connects** | Alice dials `1002`. Bob's softphone rings within 2 s. Bob answers. Asterisk CLI shows a `Bridge` between the two channels. |
| **G3 — Two-way audio** | Tester speaks into Linphone (alice) and hears it on Zoiper (bob). Tester speaks into Zoiper and hears it on Linphone. **Self-attested in the readout** — no mic-loopback automation. |
| **G4 — Clean hangup** | Either side hangs up. Both channels destroyed within 1 s. `pjsip show channels` returns empty. No zombie channels. |
| **G5 — Reverse direction** | Bob dials `1001`. Alice rings, both can hear each other, clean hangup. Confirms direction-independence. |

Spike is **Green** when all five gates pass in a single sitting.
Anything less is **Red** (file the failure mode in the readout).

## Evidence artefact

`pot/S9-audio-loopback/results/<ISO-8601>-loopback.md`, containing:

1. Container boot log (`docker compose up -d` + `make up` health
   loop output if applicable).
2. `pjsip show endpoints` output post-registration.
3. CLI trace of the test call (`asterisk -rvvvvv` while the call
   is in flight, copy-paste the relevant lines).
4. Self-attested "heard audio both ways: yes/no" with any
   subjective notes (latency feel, glitches, etc.).
5. `pjsip show channels` after hangup (should be empty).

## Risks / known unknowns

- **Docker Desktop networking on macOS.** Docker Desktop's
  `bridge` driver NATs container traffic. `host` mode is
  documented as broken on Docker Desktop for macOS. Likely path:
  publish 5060/udp + the RTP range to host ports and have the
  softphones target `127.0.0.1`. If signalling works but RTP
  fails to materialise, switch to running Asterisk directly on
  the Mac (homebrew) as a fallback — flagged in the runbook.
- **Microphone permission on macOS.** First-time launch of
  Linphone or Zoiper will prompt for mic access. Granting it is
  a manual one-time step.
- **NAT detection.** Asterisk's PJSIP `local_net` /
  `external_media_address` may need tuning for the host-bridge
  case. Probably solvable; if not, fall back to native install.
- **Codec negotiation.** Both clients default to a wider codec
  list (Opus, G.722). Pinning Asterisk to ulaw on both endpoints
  and the dialplan codec should force the match.

## Linkage

- Validates: ADR-0025 (Asterisk-direct edge topology) at bench
  scale. Provides the audio evidence missing from S1 Layer-2 deferral.
- References: `docs/adr/0025-telephony-asterisk-direct.md`.
- Does **not** validate: ADR-0026 (HIPAA-tier deferred — orthogonal,
  no audio evidence relevant); S1 Kamailio-failover (deliberately
  out of scope).

## Effort estimate

30–60 minutes once Docker is happy.

- 10 min: scaffold `docker-compose.yml`, `pjsip.conf`,
  `extensions.conf` static configs.
- 5 min: bring stack up.
- 10 min: install + configure Linphone and Zoiper accounts on the
  Mac.
- 10–30 min: actual call test + readout writing.

Stretch case (Docker networking turns out to be fussy):
+ 30–60 min to fall back to native Asterisk via homebrew.

## Status

**Green** — 2026-05-16 on Linux + Docker Desktop. G1–G5 all Green in a single sitting; evidence at `results/2026-05-16T07-48-47Z-loopback.md`, tag `pot/S9`. Three Linux-specific quirks captured in `runbook.md` §Failure-mode triage. Validates ADR-0025 audio path; supersedes the S1 Layer-2 rtpengine media-smoke carry-over for MVP per `pot/g0-closed.md` §S1 Layer-2.
