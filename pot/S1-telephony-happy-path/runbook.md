# S1 Runbook

## Setup

```
make up
```

Boots: 2× kamailio (primary + standby), rtpengine, asterisk, baresip softphone client.

Wait for `make status` to show all 5 containers healthy. Asterisk takes ~20 s to fully load PJSIP realtime.

## Test phase 1: register softphone

The baresip container auto-registers `1001@local` against the kamailio dispatcher VIP at startup. Verify:

```
docker compose logs baresip | grep -i registered
```

Expected: `1001@local: registered`.

## Test phase 2: place an outbound call to the loopback echo extension

```
docker compose exec baresip baresip -e "/dial 9999"
```

`9999` is configured in fixtures/asterisk/extensions.conf as an Echo() loop. The call should connect within 2 s and you should see media flowing in `docker compose logs rtpengine`.

## Test phase 3: simulated kamailio primary kill

While the call is live:

```
docker compose pause kamailio-primary
```

Place a NEW outbound call from baresip:

```
docker compose exec baresip baresip -e "/dial 9999"
```

Record the time-to-200-OK. Expected: ≤ 30 s.

The original in-flight call: observe whether it drops cleanly (BYE within 60 s) or leaves a zombie channel:

```
sleep 60
docker compose exec asterisk asterisk -rx 'core show channels'
```

Expected: 0 channels (the zombie is the failure case).

## Test phase 4: screen-pop latency

Loop 100 calls through phase 2 (with kamailio healthy), measuring INVITE-received-at-asterisk → StasisStart-event-to-ari-app:

```
docker compose exec asterisk /scripts/screen-pop-loop.sh 100 > results/screen-pop-latency.csv
```

(Script lives in `fixtures/asterisk/scripts/` — write at execution time, not scaffold time.)

## Snapshot

```
make snapshot-results
```

Copies all relevant logs and the CSV into `results/<timestamp>/`.

## Teardown

```
make teardown
```
