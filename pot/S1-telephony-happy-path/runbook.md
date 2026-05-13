# S1 Runbook

## 0. Build images (one-time, ~5 min)

```
make images
```

Three local images: `pot-s1/asterisk:local` (Ubuntu 24.04 + asterisk),
`pot-s1/sipp:local` (Ubuntu + SIPp 3.6.1 built from source),
`pot-s1/subscriber:local` (node:22-slim + native WebSocket).

## 1. Bring the stack up

```
make up
```

Boots:
- `asterisk`            — PJSIP transport on 5060, ARI on 8088
- `kamailio-primary`    — listens on 5060 (internal bridge)
- `kamailio-standby`    — listens on 5060 (internal bridge)
- `subscriber`          — opens ARI WS to `s1-test` Stasis app

Wait for `make up`'s healthcheck loop to report all services healthy
(~20 s typically). The healthcheck honours the `Health` column from
`docker compose ps`; unlike the original scaffold's silent `grep` loop,
it requires every service to exit "starting"/"unhealthy" before
declaring ready.

## 2. Run the probe

```
make test
```

Executes `scripts/run-test.sh` followed by `scripts/summarise.sh`. The
test driver runs four phases (also documented inline in run-test.sh):

1. Wait for both kamailios to report the Asterisk downstream as
   `ACTIVE` in `dispatcher.list`, and confirm the subscriber's ARI WS
   logged `ws_open`.
2. Send 100 INVITEs through `kamailio-primary` at 10/s (SIPp). Each
   INVITE uses the call number in the SIP From-user so it threads to
   `Stasis(s1-test, ${CALLERID(num)})`'s arg[0]. The subscriber writes
   one JSONL line per StasisStart with the arrival timestamp.
3. `docker compose pause kamailio-primary`, then send 10 INVITEs
   through `kamailio-standby` at 5/s. Record `pause-epoch-ms.txt` so
   the summariser can compute time-to-first-OK.
4. `docker compose unpause kamailio-primary`, snapshot logs.

## 3. Interpret the result

The summariser writes `results/<timestamp>/summary.md` with a verdict
(Green/Yellow/Red) and the budget table. The full per-call latency
table is in `results/<timestamp>/sipp-screen-pop_invites.csv` joined
with `subscriber-phase2.jsonl` (same join key, the call number).

## 4. Teardown

```
make teardown
```

## Common failures and what they mean

- **No StasisStart events in JSONL.** Subscriber WS may have failed to
  open. Check `subscriber-stdout.log` for `ws_error`. Most common
  cause: ARI credentials in `fixtures/asterisk/ari.conf` don't match
  the subscriber's `ARI_USER`/`ARI_PASS` env. Less common: dialplan's
  `Stasis()` line doesn't run because PJSIP rejected the INVITE — check
  `asterisk.log` for "No matching endpoint found" (S2 lesson on
  `endpoint_identifier_order`).
- **Dispatcher target stuck in `IP` (inactive/probing).** Kamailio's
  OPTIONS pings to Asterisk are being rejected. Check Asterisk's PJSIP
  transport is listening on 5060/UDP and accepts OPTIONS.
- **SIPp times out.** Either Kamailio didn't relay (kamailio.log will
  show why) or Asterisk's INVITE handling stalled. Tail `asterisk.log`
  during the run for the smoking gun.
