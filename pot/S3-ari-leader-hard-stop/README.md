# S3 — ARI leader 100 ms hard-stop

## Hypothesis

The ADR-0016 design (close WS within 100 ms of missed Redis heartbeat) is implementable on Asterisk 22.9 LTS with `@ipcom/asterisk-ari` (or equivalent ari-client lib).

## Go/no-go signal

- **Green:** Chaos test pauses leader process for 5 s. WS observed closed at the Asterisk side within 100 ms of heartbeat miss (verified via Asterisk `WebSocketEvent` log + tcpdump). Replacement leader closes orphaned channels within 7 s.
- **Yellow:** Close window 100–250 ms or replacement reconciliation 7–15 s. Document tunable target for the production design.
- **Red:** Close window > 250 ms or replacement leaves channels open > 15 s. ADR-0016 design renegotiated before MVP.

## Owner role

Telephony engineer.

## Prereqs

- Docker 24+, Docker Compose v2.
- Host: 4 GB RAM.
- `tcpdump` available on host (to capture FIN at the Asterisk side).
- No external accounts.

## Runbook

```
make up && make smoke && make test
```

`make smoke` shows the current lease holder + tail of each leader's log so you can confirm the election settled before launching chaos. `make test` runs `scripts/run-test.sh`, which writes everything below into a fresh `results/<TS>/` directory. Step-by-step in [`runbook.md`](./runbook.md).

## Recording protocol

`results/<timestamp>/`:
- `pause.pcap` — tcpdump of port 8088 across the chaos window (captured inside the asterisk container)
- `leader-a.log` / `leader-b.log` — structured JSON logs from each leader (heartbeat lost, ws-close-called, ws-open-success, reconcile-*)
- `channels-pre.txt` / `channels-post.txt` — `core show channels` snapshots either side of the chaos
- `chaos-meta.json` — chaos start/end epoch timestamps + which leader was deposed
- `summary.md` — wire close-latency, reconcile latency, hazard-exercise proof, verdicts

## Yellow remediation

If close window 100–250 ms: tune the heartbeat interval (currently 1 s) downward to 500 ms. Document new total worst-case window (heartbeat-miss + close = ~750 ms) and update ADR-0016 Decision section.

## ADR linkage

Primary evidence for [ADR-0016 (ARI leader hard-stop)](../../docs/adr/0016-ari-leader-design.md). If Red, ADR-0016 Decision section is rewritten before Sprint 0 closes.

## Implementation notes (carry forward)

- **Asterisk image:** built from `asterisk-image/Dockerfile` (Ubuntu 24.04 + `asterisk` + `tcpdump`). `andrius/asterisk:22.9-current` doesn't exist on Docker Hub and the andrius family has no arm64 builds — see also `pot/S2-queue-dequeue-latency/README.md`.
- **`/var/lib/asterisk` ownership:** the Dockerfile re-`chown`s `/var/lib/asterisk` to `root:root`. Compose's `cap_add: [NET_RAW, NET_ADMIN]` interacts with the Ubuntu asterisk package's capability handling such that DAC_OVERRIDE gets dropped, so Asterisk running as root can't open its sqlite ASTdb in the package-default `asterisk:asterisk`-owned directory. Re-chowning to root sidesteps it.
- **Local channel originate needs `Answer()`:** the dialplan extension that the Local pair dials must call `Answer()` before any `Wait()`/blocking app, otherwise the `;2` half never completes entering Stasis and `/ari/applications/<app>` reports zero channels even though `core show channels` shows the pair alive.
- **`channels.list()` filter is wrong:** in ari-client v2, `channel.dialplan.app_name` is the *dialplan* app currently executing (Wait, AppDial2, …), not the Stasis app. Use `GET /ari/applications/<app>` and read `channel_ids` to find channels in your Stasis app.
- **Heartbeat + TTL ratio:** ADR-0016's literal "1 s heartbeat, 1 s TTL" is racy — the heartbeat fires *at* the TTL boundary so `GET key` returns nil and leadership flaps. This spike uses 500 ms heartbeat with 1500 ms TTL (3:1) and stays stable. ADR-0016 wording needs revision.
- **Asterisk accepts multiple WS for the same Stasis app:** ADR-0016 Consequences claims "the second connection rejects" — but on Asterisk 20.6 the standby's WS opens successfully while the deposed leader's WS is still alive, so the standby reconciles during the chaos pause, well before the FIN. This is *better* than ADR-0016 assumed; the Decision text can be tightened accordingly.
