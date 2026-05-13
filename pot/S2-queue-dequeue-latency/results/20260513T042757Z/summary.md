# S2 dequeue latency summary

- **Samples:** 5539 successful ring events
- **Failed rings:** 146
- **Latency (ms):** min=1  mean=3.70  p50=4  p95=6  p99=9  max=99
- **Verdict:** GREEN (p95 ≤ 200 ms)

## Hazard-exercise proof

Compare Redis commandstats and NATS varz growth from t0 → t10 (in this directory):

```
--- results/20260513T042757Z/redis-cmdstats-t0.txt	2026-05-13 07:27:58
+++ results/20260513T042757Z/redis-cmdstats-t10.txt	2026-05-13 07:38:00
@@ -1,9 +1,9 @@
 # Commandstats
 cmdstat_keys:calls=1,usec=8,usec_per_call=8.00,rejected_calls=0,failed_calls=0
-cmdstat_ping:calls=72,usec=75,usec_per_call=1.04,rejected_calls=0,failed_calls=0
-cmdstat_info:calls=3,usec=328,usec_per_call=109.33,rejected_calls=0,failed_calls=0
-cmdstat_get:calls=10,usec=40,usec_per_call=4.00,rejected_calls=0,failed_calls=0
+cmdstat_ping:calls=192,usec=204,usec_per_call=1.06,rejected_calls=0,failed_calls=0
+cmdstat_info:calls=5,usec=625,usec_per_call=125.00,rejected_calls=0,failed_calls=0
+cmdstat_get:calls=12,usec=46,usec_per_call=3.83,rejected_calls=0,failed_calls=0
 cmdstat_del:calls=1,usec=12,usec_per_call=12.00,rejected_calls=0,failed_calls=0
-cmdstat_set:calls=118,usec=2899,usec_per_call=24.57,rejected_calls=0,failed_calls=0
+cmdstat_set:calls=5983,usec=49330,usec_per_call=8.25,rejected_calls=0,failed_calls=0
 cmdstat_flushall:calls=1,usec=4332,usec_per_call=4332.00,rejected_calls=0,failed_calls=0
 cmdstat_client|setinfo:calls=4,usec=19,usec_per_call=4.75,rejected_calls=0,failed_calls=0
redis diff unavailable
```

NATS varz t0 → t10 in_msgs / out_msgs:

```
t0:    "in_msgs": 22,  "out_msgs": 0,
t10:   "in_msgs": 11532,  "out_msgs": 0,
```

If Redis cmdstats and NATS in_msgs/out_msgs are flat across the window, the probe did not exercise the hazard and the verdict is invalid regardless of the latency numbers (see [[feedback-pot-scaffolds]]).
