# S1 PoT — summary

- **Verdict:** GREEN
- **Reason:** all metrics within budget

## Phase 2 — screen-pop (100 INVITEs through kamailio-primary, 10/s)

```
sent=100
received=100
loss=0
p50=2
p95=2
p99=5
max=5
min=2
```

## Phase 3 — failover (10 INVITEs through kamailio-standby after primary pause)

```
sent=10
received=10
loss=0
p50=2
p95=2
p99=2
max=2
min=1
```

## Failover wall-clock

- pause moment        : 1778652878135 (epoch ms)
- first StasisStart   : 1778652878708 (epoch ms)
- time-to-first-OK    : 573 ms

## Budget reference

| Metric            | Green     | Yellow      | Red        | Observed |
|-------------------|-----------|-------------|------------|----------|
| screen-pop p95    | ≤ 800 ms  | ≤ 1500 ms   | > 1500 ms  | 2 ms |
| failover TTFOK    | ≤ 30 s    | ≤ 120 s     | > 120 s    | 573 ms |
| call loss phase 2 | 0         | 0           | any        | 0 |
| call loss phase 3 | 0         | 0           | any        | 0 |
