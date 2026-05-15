// S8 — SNI flood scenario.
//
// Hits HTTPS endpoints at varying SNI hostnames; the URL's hostname becomes
// the TLS SNI presented by k6. The hostname-to-IP mapping is supplied via the
// TARGET_IP env var so the same script targets HAProxy or Caddy directly
// depending on the scenario the test runner picks.
//
// ADR-0019 hazard: 1k unknown-SNI requests/sec from one source. We use 50
// distinct unknown SNIs + 1 known SNI; this is enough to exercise Caddy's
// declined-domain LRU (which has capacity in the thousands) without ballooning
// the hosts mapping. The hazard is "many distinct unknown SNIs at high
// aggregate rate" — 50 distinct >> 1 is sufficient.
//
// Env:
//   RATE_RPS         — total HTTPS req/sec across the scenario (default 1000)
//   DURATION_SECONDS — sustained-load window (default 60)
//   UNKNOWN_RATIO    — fraction of requests targeting unknown SNI (default 0.99)
//   RESULTS_PATH     — where to write summary JSON (default /results/k6-summary.json)
//   TARGET_IP        — IP address to route all spike-s8.test hostnames to

import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const RATE_RPS = parseInt(__ENV.RATE_RPS || '1000', 10);
const DURATION_SECONDS = parseInt(__ENV.DURATION_SECONDS || '60', 10);
const UNKNOWN_RATIO = parseFloat(__ENV.UNKNOWN_RATIO || '0.99');
const RESULTS_PATH = __ENV.RESULTS_PATH || '/results/k6-summary.json';
const TARGET_IP = __ENV.TARGET_IP || '172.30.8.20';

const UNKNOWN_POOL_SIZE = 50;
const KNOWN_HOSTNAME = 'tenant-known.spike-s8.test';
const unknownHosts = [];
for (let i = 0; i < UNKNOWN_POOL_SIZE; i++) {
  unknownHosts.push(`flood-${i}.spike-s8.test`);
}

// Build hosts mapping: all spike-s8.test hostnames → TARGET_IP.
// k6 v0.47+ uses the options.hosts object (--hosts CLI flag was removed).
const hostsMap = {};
hostsMap[KNOWN_HOSTNAME] = TARGET_IP;
for (let i = 0; i < UNKNOWN_POOL_SIZE; i++) {
  hostsMap[`flood-${i}.spike-s8.test`] = TARGET_IP;
}

export const options = {
  insecureSkipTLSVerify: true,
  noConnectionReuse: true,
  hosts: hostsMap,
  scenarios: {
    sni_flood: {
      executor: 'constant-arrival-rate',
      rate: RATE_RPS,
      timeUnit: '1s',
      duration: `${DURATION_SECONDS}s`,
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
  thresholds: {
    // We don't enforce assertions here — many requests are expected to fail
    // (HAProxy will reject them, Caddy will refuse handshake for declined
    // SNIs). The verdict comes from the summariser, not from k6 status codes.
    'iteration_duration': ['p(99)<5000'],
  },
};

export default function () {
  const isUnknown = Math.random() < UNKNOWN_RATIO;
  const host = isUnknown
    ? unknownHosts[Math.floor(Math.random() * unknownHosts.length)]
    : KNOWN_HOSTNAME;

  const res = http.get(`https://${host}/`, {
    timeout: '5s',
    tags: { sni_class: isUnknown ? 'unknown' : 'known' },
  });

  // We tolerate every error class (connection_reset, timeout, etc.) — for
  // unknown-SNI flood, those failures are exactly what HAProxy or Caddy
  // should produce, not a bug.
  check(res, {
    'response present': (r) => r.status !== undefined,
  });
}

export function handleSummary(data) {
  return {
    [RESULTS_PATH]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
  };
}
