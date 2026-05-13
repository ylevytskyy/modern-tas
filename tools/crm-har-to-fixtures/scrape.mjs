#!/usr/bin/env node
// crm-har-to-fixtures — extract /v1 XML responses from a CRM-captured HAR file
// and write them into the contracts/fixtures/v1-xml/ layout for M25 round-trip
// tests. Sprint-0 carry-over from S6 (PoT Phase 0 Deferred); see
// pot/g0-signoff-proposal.md §S6 for context.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V1_PATH_RE = /^\/v1\/(?<rest>.+?)\.(?<ext>xml|json)$/;
const MAX_FILENAME_LEN = 200;

/**
 * Parse a captured URL into its addressable parts. Returns null if the URL is
 * not a /v1/... .xml/.json call.
 *
 * @param {string} rawUrl
 * @returns {{resource: string, op: string | null, query: string, ext: string} | null}
 */
export function parseUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const m = V1_PATH_RE.exec(u.pathname);
  if (!m) return null;

  const segments = m.groups.rest.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  let resource, op;
  if (segments.length === 1) {
    // /v1/me.xml — resource only, no op
    resource = segments[0];
    op = null;
  } else if (segments.length === 2) {
    // /v1/Calls/find.xml — resource + op
    [resource, op] = segments;
  } else {
    // /v1/Clients/42/billing.xml — per-client subresource pattern.
    // Treat the resource as the first segment; collapse the remainder into the
    // op so the fingerprint encodes the full addressing path.
    resource = segments[0];
    op = segments.slice(1).join('-');
  }

  // Canonicalise query: sort keys for stable fingerprints.
  const params = [...u.searchParams.entries()];
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');

  return { resource, op, query, ext: m.groups.ext };
}

/**
 * Compute the (directory, filename) pair for a parsed URL.
 *
 * Layout: `<resource>/<op>[--<sanitised-query>].<ext>`, or `<resource>/_self.<ext>`
 * for resource-only URLs. Long filenames are truncated with a hash suffix to
 * stay under MAX_FILENAME_LEN.
 *
 * @param {{resource: string, op: string | null, query: string, ext: string}} parsed
 * @returns {{dir: string, file: string}}
 */
export function fingerprint(parsed) {
  const { resource, op, query, ext } = parsed;
  const dir = sanitiseSegment(resource);
  const opPart = op == null ? '_self' : sanitiseSegment(op);

  let file;
  if (!query) {
    file = `${opPart}.${ext}`;
  } else {
    const querySegments = query.split('&').map((pair) => {
      const eqIdx = pair.indexOf('=');
      const k = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
      const v = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
      return `${sanitiseSegment(k)}-${sanitiseSegment(v)}`;
    });
    const queryPart = querySegments.join('--');
    file = `${opPart}--${queryPart}.${ext}`;
  }

  if (file.length > MAX_FILENAME_LEN) {
    // Hash the full file string; truncate the readable portion and append
    // the hash so the result stays unique + somewhat browsable.
    const hash = createHash('sha256').update(file).digest('hex').slice(0, 12);
    const room = MAX_FILENAME_LEN - hash.length - `.${ext}`.length - '--'.length;
    const truncated = file.slice(0, room);
    file = `${truncated}--${hash}.${ext}`;
  }

  return { dir, file };
}

/**
 * @param {string} s
 * @returns {string}
 */
function sanitiseSegment(s) {
  // Replace filesystem-unsafe + separator-conflicting characters with `_`.
  // Filesystem-unsafe: / \ : * ? " < > |
  // Separator-conflicting: - (used as kv joiner) and -- (used as pair joiner)
  // We accept single `-` from canonical query keys (e.g. `output_fields`) but
  // replace comma with underscore so multi-value queries don't break the
  // double-dash parser later.
  return s
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/,/g, '_');
}

/**
 * Filter HAR entries to /v1 calls with successful responses + non-empty bodies.
 *
 * @param {{entries: Array<any>}} harLog
 * @param {{includeAllStatuses?: boolean}} [opts]
 * @returns {Array<{url: string, body: string, status: number, mimeType: string}>}
 */
export function extractV1Entries(harLog, opts = {}) {
  const { includeAllStatuses = false } = opts;
  const out = [];
  for (const entry of harLog.entries ?? []) {
    const url = entry?.request?.url;
    if (!url) continue;
    if (parseUrl(url) === null) continue;
    const status = entry?.response?.status ?? 0;
    if (!includeAllStatuses && status !== 200) continue;
    const body = entry?.response?.content?.text;
    if (typeof body !== 'string' || body.length === 0) continue;
    out.push({
      url,
      body,
      status,
      mimeType: entry?.response?.content?.mimeType ?? '',
    });
  }
  return out;
}

/**
 * Read a HAR file from disk, extract /v1 fixtures, and write them under
 * <outDir>/v1-xml/<resource>/<fingerprint>.
 *
 * @param {{harPath: string, outDir: string, includeAllStatuses?: boolean}} opts
 * @returns {{totalEntries: number, matched: number, written: number, resourcesSeen: string[]}}
 */
export function runScrape({ harPath, outDir, includeAllStatuses = false }) {
  const har = JSON.parse(readFileSync(harPath, 'utf8'));
  const harLog = har.log ?? har;
  const totalEntries = (harLog.entries ?? []).length;
  const entries = extractV1Entries(harLog, { includeAllStatuses });
  const resourcesSeen = new Set();
  let written = 0;
  for (const entry of entries) {
    const parsed = parseUrl(entry.url);
    if (!parsed) continue;
    resourcesSeen.add(parsed.resource);
    const { dir, file } = fingerprint(parsed);
    const fullDir = join(outDir, 'v1-xml', dir);
    mkdirSync(fullDir, { recursive: true });
    writeFileSync(join(fullDir, file), entry.body, 'utf8');
    written += 1;
  }
  return {
    totalEntries,
    matched: entries.length,
    written,
    resourcesSeen: [...resourcesSeen],
  };
}

// CLI entrypoint — only runs when executed directly, not when imported.
const __filename = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && process.argv[1] === __filename;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const harPath = args[0];
  const outDir = args[1] ?? join(dirname(__filename), '..', '..', 'contracts', 'fixtures');
  const includeAllStatuses = args.includes('--all-statuses');

  if (!harPath || args.includes('-h') || args.includes('--help')) {
    console.error('Usage: node scrape.mjs <input.har> [<outDir>] [--all-statuses]');
    console.error('');
    console.error('  <input.har>     Path to HAR file captured from CRM browser DevTools');
    console.error('  <outDir>        Output root. Default: <repo>/contracts/fixtures');
    console.error('                  Fixtures land under <outDir>/v1-xml/<Resource>/<fingerprint>');
    console.error('  --all-statuses  Include non-200 responses (default: skip)');
    process.exit(harPath ? 0 : 1);
  }

  const result = runScrape({ harPath, outDir, includeAllStatuses });
  console.log(`Read ${result.totalEntries} HAR entries`);
  console.log(`Matched ${result.matched} /v1/...{.xml,.json} entries`);
  console.log(`Wrote ${result.written} fixtures to ${join(outDir, 'v1-xml')}`);
  console.log(`Resources seen: ${result.resourcesSeen.sort().join(', ') || '(none)'}`);
}
