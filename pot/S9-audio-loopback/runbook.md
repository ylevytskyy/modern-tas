# S9 Runbook — audio loopback

Five gates (G1–G5 from `README.md`) must all pass in one sitting for **Green**.
Total time: 30–60 min if Docker is happy; +30–60 min for native-Asterisk
fallback if Docker UDP is broken.

## 0. Prerequisites

- Docker Desktop running on the Mac. Memory ≥ 4 GB recommended.
- Two Mac softphones installed:
  - **Linphone** — `brew install --cask linphone` (or
    [linphone.org](https://www.linphone.org/) download)
  - **Zoiper Free** — [zoiper.com](https://www.zoiper.com/) download (free
    tier; "Continue with free version" on first launch).
- macOS microphone permission granted to both softphones (System
  Settings → Privacy & Security → Microphone) — granted on first launch.

## 1. Build + boot the Asterisk container

```bash
cd pot/S9-audio-loopback
make up
```

`make up` builds the local image (~3 min first time, cached after) and
waits up to 12 s for Asterisk to report `core show version` Green. On
success it prints the Asterisk version.

If you see "Asterisk did not become ready" — `make logs` for the
container output; usually a port conflict on host 5060 (FaceTime / SIP
server already bound). Stop the conflicting process or change the host
port in `docker-compose.yml`.

## 2. Verify the static endpoints are loaded

```bash
make endpoints
```

Expected:

```
 Endpoint:  alice/alice                                          Unavailable   0 of inf
       Aor:  alice-aor                                              0
     Auth:  alice-auth/alice
 Endpoint:  bob/bob                                                Unavailable   0 of inf
       Aor:  bob-aor                                                0
     Auth:  bob-auth/bob
```

`Unavailable 0 of inf` is correct **before** registration: no
softphones connected yet.

```bash
make dialplan
```

Expected to list extensions `1001` (→ alice) and `1002` (→ bob) in
context `tas-loopback`.

## 3. Register Linphone as `alice`

In Linphone preferences → Accounts → Add account:

- SIP identity: `sip:alice@127.0.0.1`
- Username: `alice`
- Password: `alice-s9-pot`
- SIP server / Proxy: `sip:127.0.0.1:5060`
- Transport: UDP
- Outbound proxy: (leave blank — direct to proxy works on loopback)

Save. Linphone should show "Connected" / "Registered" within ~5 s.

Verify from the container side:

```bash
make endpoints
```

Now `alice` should show `Not in use` (or `In use` if mid-call) with
`1 of inf` contacts. Also:

```bash
make contacts
```

Should list the Linphone contact URI (something like
`sip:alice@172.17.0.1:5xxxx` — note the Docker-gateway IP).

## 4. Register Zoiper as `bob`

In Zoiper → Settings → Accounts → Add account → SIP:

- Hostname: `127.0.0.1:5060`
- Username: `bob`
- Password: `bob-s9-pot`
- Authentication username: `bob`
- Transport: UDP

Zoiper Free will probe and confirm registration. The account chip
should turn green.

Re-verify:

```bash
make endpoints
```

Both `alice` and `bob` should now show `Not in use` with `1 of inf`
contacts. **This is G1 — both endpoints REGISTER.**

## 5. Place the call alice → bob (G2 + G3 + G4)

Open the Asterisk CLI in a side terminal:

```bash
make cli
```

Leave it open. In Linphone, dial `1002`. Within ~2 s Zoiper rings.

Answer on Zoiper. The CLI should show something like:

```
    -- PJSIP/alice-00000001 is making progress passing it to PJSIP/bob-00000002
    -- Channel PJSIP/bob-00000002 joined 'simple_bridge' …
    -- Channel PJSIP/alice-00000001 joined 'simple_bridge' …
```

**G2 — call connects.** Speak into the Linphone mic (Mac mic). Listen
on Zoiper. Then speak into Zoiper's mic and listen on Linphone.

**G3 — two-way audio:** confirm both directions are audible (note any
crackle, latency feel, or dropouts in the readout).

Hang up from Linphone. CLI should show clean teardown:

```
    -- PJSIP/alice-00000001 Bye received
    -- Channel PJSIP/alice-00000001 left 'simple_bridge'
    -- Channel PJSIP/bob-00000002 left 'simple_bridge'
```

Then verify no zombies:

```bash
make channels
```

Expected output: empty / `0 contact` lines. **G4 — clean hangup.**

## 6. Reverse direction bob → alice (G5)

Repeat step 5 in the opposite direction: Zoiper dials `1001`, Linphone
rings, answer, two-way audio, hang up, channels clean.

**G5 — reverse direction works.** All five gates Green → spike is
Green.

## 7. Write the evidence readout

Create `pot/S9-audio-loopback/results/<ISO-8601>-loopback.md` with the
five required sections (see README "Evidence artefact"). ISO-8601 is
`YYYY-MM-DDTHH-MM-SS` (no colons; macOS filename-safe). Suggested
template lives next to this runbook (TODO if missing).

## 8. Tear down

```bash
make down
```

## Failure-mode triage

- **G1 fails — endpoint stays `Unavailable`:** softphone can't reach
  the Asterisk container. Check `nc -uvz 127.0.0.1 5060` from a
  terminal. If port unreachable, the published port mapping is
  broken — restart Docker Desktop. If reachable but no register:
  check `make logs` for `No matching endpoint`, `auth_type` mismatch,
  or transport errors.
- **G2 fails — Linphone says "Not found":** dialplan didn't match.
  `make dialplan` to confirm. Common cause: dialing into the wrong
  context. The context is `tas-loopback`; account config in Linphone
  shouldn't override it (Linphone sends INVITE to the registrar with
  the dialed digits as username; Asterisk routes based on the
  endpoint's `context=`).
- **G2 fails — Asterisk says "404 Not Found" / "Decline":** check that
  both endpoints registered before placing the call. Re-verify with
  `make endpoints`.
- **G3 fails — call connects, no audio one or both directions:**
  classic Docker Desktop UDP/NAT issue. Two paths:
  1. **Quick check:** confirm both softphones' selected mic + speaker
     are correct (System Settings → Sound). Restart the call.
  2. **If still broken:** Asterisk's `external_media_address` may not
     be reaching the softphone correctly. Fall back to native Asterisk
     via `brew install asterisk` and re-mount the configs at
     `/usr/local/etc/asterisk/`. Native install bypasses the
     Docker-Desktop UDP-mapping layer entirely. Document the fallback
     in the readout; this is a Mac-Docker artefact, not a topology
     concern.
- **G4 fails — channels persist after hangup:** look for `BYE` in the
  CLI trace. If absent, the hangup didn't reach Asterisk (softphone
  bug or NAT issue). If `BYE` present but channels persist, file as
  an Asterisk bug + provide repro.
- **G1 fails on Linux + Docker Desktop — `mounts denied`:** Project path isn't in Docker Desktop's File Sharing list. `/media` (a common Linux secondary-drive mount) is not on the default allow-list. Either add the path (Settings → Resources → File Sharing) or rebuild with baked-in configs (this repo's `asterisk-image/Dockerfile` already does the latter — commit `d28b1e9`).
- **G3 fails — call connects, no audio, both directions, native_rtp/Docker-Desktop combination:** Check `pjsip.conf` for any `local_net` directive that overlaps the Docker bridge subnet. The container's view of the host is the bridge gateway (typically anywhere in 172.16/12), which sits inside the default-private block. If `local_net=172.16.0.0/12` is set, PJSIP treats the softphone as local and skips `external_media_address` rewriting — SDP then advertises the container's own IP, unreachable from the host. Remove the offending `local_net` lines (commit `9814992`).
- **G3 fails with two pjsua TUIs on the same Linux host — second pjsua silent:** pjsua's default audio device (`capture=-1 playback=-2`) picks ALSA's `lavrate` plug, which opens `hw:CARD=PCH,DEV=0` exclusively. The second pjsua's log floods with `snd_pcm_hw_open ... -16: Device or resource busy`. Symptom is signalling fine (INVITE/200/ACK clean) but zero RTP TX/RX — looks like a bridge-tech failure, isn't. Fix: pin both account configs to the ALSA `pulse` plug index (commit `4af8d06` uses index 6 on this host). On macOS the indices differ.
