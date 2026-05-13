# S3 ARI leader hard-stop — summary

- **Leader (chaos victim):** leader-a
- **Standby (replacement):** leader-b
- **Chaos start:** 1778649645.206565 (epoch s)
- **Chaos end:**   1778649650.418165 (epoch s)

## Close-latency

- heartbeat lost (leader log)         : 1778649650400 ms (epoch)
- ws-close-called (leader log)        : 1778649650400 ms (epoch)
- wire FIN at Asterisk (pcap)         : 1778649650401 ms (epoch)
- **in-process close** (called − lost) : **0 ms**
- **wire close-latency** (FIN − lost)  : **1 ms**
- **verdict:** GREEN (wire close <= 100 ms)

## Reconciliation

- standby acquired lease (standby log)  : 1778649646605 ms (epoch)
- standby ws-open-success (standby log) : 1778649646653 ms (epoch)
- standby reconcile-done   (standby log): 1778649646680 ms (epoch)
- **lease takeover** (acquired − chaos start)    : **1399 ms**
- **reconcile from chaos** (reconcile-done − chaos start) : **1474 ms**
- **reconcile from FIN** (reconcile-done − heartbeat lost) : **-3720 ms**
- **verdict:** GREEN (reconcile <= 7 s)

> The ADR-0016 "within 7 s of FIN" budget assumes Asterisk rejects a
> second WS while the deposed leader's WS is still alive, so the standby
> cannot reconcile until after the FIN. This run shows Asterisk
> *accepts* the standby's WS as soon as the lease moves — the standby
> reconciles during the chaos pause, well before the FIN. The
> reconcile-from-chaos number is the operationally relevant one;
> reconcile-from-FIN goes negative under this behaviour, which is
> better than the ADR target.

## Hazard-exercise proof

- channels-pre  (before chaos): 20 active channels
- channels-post (after chaos):  0 active channels
- pause.pcap: 55296 bytes

If channels-pre shows < 5 channels, the chaos did not exercise the orphan
path and the reconciliation verdict is invalid. If pause.pcap is empty or
the FIN didn't land in the chaos window, the close-latency verdict is
invalid.
