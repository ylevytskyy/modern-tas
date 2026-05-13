import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseUrl, fingerprint, extractV1Entries, runScrape } from './scrape.mjs';

describe('parseUrl', () => {
  test('returns null for non-v1 paths', () => {
    assert.equal(parseUrl('https://x.example.com/api/v2/calls'), null);
    assert.equal(parseUrl('https://x.example.com/v3/foo.xml'), null);
    assert.equal(parseUrl('https://x.example.com/foo.xml'), null);
  });

  test('parses resource-only URLs (no op)', () => {
    assert.deepEqual(parseUrl('https://x.example.com/v1/me.xml'), {
      resource: 'me', op: null, query: '', ext: 'xml',
    });
    assert.deepEqual(parseUrl('https://x.example.com/v1/time.xml'), {
      resource: 'time', op: null, query: '', ext: 'xml',
    });
  });

  test('parses resource + op URLs', () => {
    assert.deepEqual(parseUrl('https://x.example.com/v1/Calls/find.xml'), {
      resource: 'Calls', op: 'find', query: '', ext: 'xml',
    });
    assert.deepEqual(parseUrl('https://x.example.com/v1/Calls/field_names.xml'), {
      resource: 'Calls', op: 'field_names', query: '', ext: 'xml',
    });
  });

  test('parses query strings and sorts params for stability', () => {
    const a = parseUrl('https://x.example.com/v1/Calls/find.xml?today=true&output_fields=CallID');
    const b = parseUrl('https://x.example.com/v1/Calls/find.xml?output_fields=CallID&today=true');
    assert.equal(a.query, b.query, 'query order should not change fingerprint');
    assert.equal(a.query, 'output_fields=CallID&today=true');
  });

  test('preserves json ext distinct from xml', () => {
    assert.equal(parseUrl('https://x.example.com/v1/Calls/find.json').ext, 'json');
    assert.equal(parseUrl('https://x.example.com/v1/Calls/find.xml').ext, 'xml');
  });

  test('handles per-client billing pattern /v1/Clients/<id>/billing.xml', () => {
    // Per crm-api-compat memory, "per-client billing" is in the resource list.
    // Treat the numeric id segment as part of the op so the fingerprint stays stable per-client.
    const parsed = parseUrl('https://x.example.com/v1/Clients/42/billing.xml');
    assert.equal(parsed.resource, 'Clients');
    assert.match(parsed.op, /42/);
    assert.equal(parsed.ext, 'xml');
  });
});

describe('fingerprint', () => {
  test('resource-only URL fingerprints to <resource>/_self.xml', () => {
    const { dir, file } = fingerprint({ resource: 'me', op: null, query: '', ext: 'xml' });
    assert.equal(dir, 'me');
    assert.equal(file, '_self.xml');
  });

  test('resource + op fingerprints to <resource>/<op>.xml', () => {
    const { dir, file } = fingerprint({ resource: 'Calls', op: 'find', query: '', ext: 'xml' });
    assert.equal(dir, 'Calls');
    assert.equal(file, 'find.xml');
  });

  test('query params join with double-dash and key-value with single-dash', () => {
    const { file } = fingerprint({
      resource: 'Calls', op: 'find', query: 'today=true', ext: 'xml',
    });
    assert.equal(file, 'find--today-true.xml');
  });

  test('multiple query params join in order', () => {
    const { file } = fingerprint({
      resource: 'Calls', op: 'find',
      query: 'output_fields=CallID,CallTime&today=true',
      ext: 'xml',
    });
    assert.equal(file, 'find--output_fields-CallID_CallTime--today-true.xml');
  });

  test('sanitises filesystem-unsafe characters in query values', () => {
    const { file } = fingerprint({
      resource: 'Calls', op: 'find',
      query: 'note=hello/world:foo*bar?baz',
      ext: 'xml',
    });
    // Replace /, :, *, ? with underscore. The `--` separator should not appear in a single value.
    assert.match(file, /^find--note-hello_world_foo_bar_baz\.xml$/);
  });

  test('extension follows ext field', () => {
    const xml = fingerprint({ resource: 'Calls', op: 'find', query: '', ext: 'xml' });
    const json = fingerprint({ resource: 'Calls', op: 'find', query: '', ext: 'json' });
    assert.equal(xml.file, 'find.xml');
    assert.equal(json.file, 'find.json');
  });

  test('caps very long fingerprints by hashing the query tail', () => {
    // Filesystems generally cap filenames around 255 bytes. A query with many params
    // can blow past that. Cap at a reasonable length and append a hash suffix to
    // preserve uniqueness.
    const longQuery = Array.from({ length: 30 }, (_, i) => `field${i}=value${i}`).join('&');
    const { file } = fingerprint({ resource: 'Calls', op: 'find', query: longQuery, ext: 'xml' });
    assert.ok(file.length <= 200, `expected file <= 200 chars, got ${file.length}`);
    assert.match(file, /^find--.*\.xml$/);
  });
});

describe('extractV1Entries', () => {
  const makeEntry = (url, status = 200, body = '<r/>', mime = 'application/xml') => ({
    request: { method: 'GET', url },
    response: { status, content: { mimeType: mime, text: body } },
  });

  test('filters to /v1/...{.xml,.json} URLs only', () => {
    const harLog = {
      entries: [
        makeEntry('https://x.example.com/v1/Calls/find.xml'),
        makeEntry('https://x.example.com/api/v2/calls'),
        makeEntry('https://x.example.com/v1/Users/find.xml'),
        makeEntry('https://x.example.com/static/app.js'),
      ],
    };
    const out = extractV1Entries(harLog);
    assert.equal(out.length, 2);
    assert.ok(out.every((e) => e.url.includes('/v1/')));
  });

  test('skips non-200 responses by default', () => {
    const harLog = {
      entries: [
        makeEntry('https://x.example.com/v1/Calls/find.xml', 200),
        makeEntry('https://x.example.com/v1/Users/find.xml', 401),
        makeEntry('https://x.example.com/v1/Calls/find.xml?bad', 500),
      ],
    };
    const out = extractV1Entries(harLog);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, 200);
  });

  test('includes non-200 when includeAllStatuses is true', () => {
    const harLog = {
      entries: [
        makeEntry('https://x.example.com/v1/Calls/find.xml', 200),
        makeEntry('https://x.example.com/v1/Users/find.xml', 401),
      ],
    };
    const out = extractV1Entries(harLog, { includeAllStatuses: true });
    assert.equal(out.length, 2);
  });

  test('preserves response body and URL', () => {
    const harLog = {
      entries: [makeEntry('https://x.example.com/v1/me.xml', 200, '<me id="1"/>', 'application/xml')],
    };
    const out = extractV1Entries(harLog);
    assert.equal(out[0].url, 'https://x.example.com/v1/me.xml');
    assert.equal(out[0].body, '<me id="1"/>');
  });

  test('handles missing response body gracefully (HAR entries with no content.text)', () => {
    const harLog = {
      entries: [{
        request: { method: 'GET', url: 'https://x.example.com/v1/me.xml' },
        response: { status: 200, content: { mimeType: 'application/xml' } },
      }],
    };
    const out = extractV1Entries(harLog);
    // Entry should be excluded because there's no body to write.
    assert.equal(out.length, 0);
  });
});

describe('runScrape (end-to-end)', () => {
  let workDir;

  function setup() {
    workDir = mkdtempSync(join(tmpdir(), 'crm-har-test-'));
    return workDir;
  }

  function cleanup() {
    if (workDir && existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  test('writes fixtures to <outDir>/v1-xml/<resource>/<fingerprint> from a tiny HAR', () => {
    setup();
    try {
      const har = {
        log: {
          version: '1.2',
          entries: [
            {
              request: { method: 'GET', url: 'https://nctest.example.com/v1/me.xml' },
              response: {
                status: 200,
                content: { mimeType: 'application/xml', text: '<me id="42"/>' },
              },
            },
            {
              request: {
                method: 'GET',
                url: 'https://nctest.example.com/v1/Calls/find.xml?today=true&output_fields=CallID',
              },
              response: {
                status: 200,
                content: { mimeType: 'application/xml', text: '<calls><call id="7"/></calls>' },
              },
            },
            {
              request: { method: 'GET', url: 'https://nctest.example.com/api/v2/foo' },
              response: { status: 200, content: { mimeType: 'application/json', text: '{}' } },
            },
          ],
        },
      };

      const harPath = join(workDir, 'input.har');
      writeFileSync(harPath, JSON.stringify(har));

      const outDir = join(workDir, 'out');
      const result = runScrape({ harPath, outDir });

      assert.equal(result.totalEntries, 3);
      assert.equal(result.matched, 2);
      assert.equal(result.written, 2);

      const meFile = join(outDir, 'v1-xml', 'me', '_self.xml');
      const callsFile = join(outDir, 'v1-xml', 'Calls', 'find--output_fields-CallID--today-true.xml');
      assert.ok(existsSync(meFile), `expected ${meFile} to exist`);
      assert.ok(existsSync(callsFile), `expected ${callsFile} to exist`);
      assert.equal(readFileSync(meFile, 'utf8'), '<me id="42"/>');
      assert.equal(readFileSync(callsFile, 'utf8'), '<calls><call id="7"/></calls>');

      // No fixture written for /api/v2/foo
      const v2Listing = readdirSync(join(outDir, 'v1-xml'));
      assert.ok(!v2Listing.includes('foo'));
    } finally {
      cleanup();
    }
  });

  test('reports distinct resources observed', () => {
    setup();
    try {
      const har = {
        log: {
          entries: [
            { request: { method: 'GET', url: 'https://x/v1/Calls/find.xml' },
              response: { status: 200, content: { mimeType: 'application/xml', text: '<a/>' } } },
            { request: { method: 'GET', url: 'https://x/v1/Users/find.xml' },
              response: { status: 200, content: { mimeType: 'application/xml', text: '<a/>' } } },
            { request: { method: 'GET', url: 'https://x/v1/Calls/field_names.xml' },
              response: { status: 200, content: { mimeType: 'application/xml', text: '<a/>' } } },
          ],
        },
      };
      const harPath = join(workDir, 'input.har');
      writeFileSync(harPath, JSON.stringify(har));
      const result = runScrape({ harPath, outDir: join(workDir, 'out') });
      assert.deepEqual(result.resourcesSeen.sort(), ['Calls', 'Users']);
    } finally {
      cleanup();
    }
  });
});
