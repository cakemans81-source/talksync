import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseManifest, loadManifest, ManifestError } from '../lib/manifest.mjs';

const good = {
  id: 'a-1', set: 's', lang: 'en', audio: 'sample/a.wav', startSec: null, endSec: null,
  refText: 'hi', refTranslations: { ko: '안녕' }, license: 'CC0', source: 'x',
};
const line = (o) => JSON.stringify({ ...good, ...o });

function errorsOf(text) {
  try {
    parseManifest(text, 'm.jsonl');
  } catch (err) {
    assert.ok(err instanceof ManifestError);
    return err.errors;
  }
  return assert.fail('expected ManifestError');
}

test('parses valid manifest and fills defaults', () => {
  const rest = { ...good };
  delete rest.startSec;
  delete rest.endSec;
  const [e] = parseManifest(JSON.stringify(rest) + '\n\n');
  assert.equal(e.startSec, null);
  assert.equal(e.endSec, null);
});

test('shipped sample.jsonl is valid', () => {
  const e = loadManifest(fileURLToPath(new URL('../manifests/sample.jsonl', import.meta.url)));
  assert.equal(e.length, 3);
});

test('reports line numbers for invalid JSON and bad fields', () => {
  const errs = errorsOf([line({}), '{oops', line({ id: 'b', lang: '' }), line({ id: 'c', startSec: 'x' })].join('\n'));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:2:') && e.includes('invalid JSON')));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:3:') && e.includes('"lang"')));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:4:') && e.includes('"startSec"')));
});

test('duplicate id, bad audio path, end<=start, bad refTranslations', () => {
  const errs = errorsOf(
    [
      line({}), line({}),
      line({ id: 'p', audio: '../x.wav' }),
      line({ id: 'q', audio: 'C:/x.wav' }),
      line({ id: 'r', startSec: 2, endSec: 1 }),
      line({ id: 's', refTranslations: { ko: 5 } }),
    ].join('\n'),
  );
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:2:') && e.includes('duplicate id') && e.includes('m.jsonl:1')));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:3:') && e.includes('relative path')));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:4:') && e.includes('relative path')));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:5:') && e.includes('endSec')));
  assert.ok(errs.some((e) => e.startsWith('m.jsonl:6:') && e.includes('refTranslations["ko"]')));
});

test('empty manifest is an error', () => {
  assert.ok(errorsOf('\n\n')[0].includes('no entries'));
});
