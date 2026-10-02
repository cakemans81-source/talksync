/** JSONL 매니페스트 로드 + 검증. 오류는 파일명:줄번호 포함. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export class ManifestError extends Error {
  constructor(errors, source) {
    super(`invalid manifest ${source}:\n  ${errors.join('\n  ')}`);
    this.name = 'ManifestError';
    this.errors = errors;
  }
}

const isStr = (v) => typeof v === 'string';
const isNonEmpty = (v) => isStr(v) && v.trim() !== '';
const isNumOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

function validateEntry(e, line, seen) {
  const errs = [];
  const bad = (msg) => errs.push(`${line}: ${msg}`);
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return [`${line}: entry must be a JSON object`];
  for (const k of ['id', 'set', 'lang', 'audio', 'license', 'source']) {
    if (!isNonEmpty(e[k])) bad(`field "${k}" must be a non-empty string`);
  }
  if (isNonEmpty(e.id)) {
    if (seen.has(e.id)) bad(`duplicate id "${e.id}" (first at ${seen.get(e.id)})`);
    else seen.set(e.id, line);
  }
  if (isNonEmpty(e.audio) && (path.isAbsolute(e.audio) || /^[a-z]:/i.test(e.audio) || e.audio.split(/[\\/]/).includes('..'))) {
    bad('field "audio" must be a relative path under data/ (no absolute path or "..")');
  }
  for (const k of ['startSec', 'endSec']) {
    if (e[k] === undefined) e[k] = null;
    else if (!isNumOrNull(e[k])) bad(`field "${k}" must be a number >= 0 or null`);
  }
  if (typeof e.startSec === 'number' && typeof e.endSec === 'number' && e.endSec <= e.startSec) {
    bad('"endSec" must be greater than "startSec"');
  }
  if (!isStr(e.refText)) bad('field "refText" must be a string');
  if (e.refTranslations === undefined) e.refTranslations = {};
  const rt = e.refTranslations;
  if (rt === null || typeof rt !== 'object' || Array.isArray(rt)) bad('field "refTranslations" must be an object');
  else for (const [k, v] of Object.entries(rt)) if (!isStr(v)) bad(`refTranslations["${k}"] must be a string`);
  return errs;
}

export function parseManifest(text, source = '<manifest>') {
  const entries = [];
  const errors = [];
  const seen = new Map();
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const line = `${source}:${i + 1}`;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      errors.push(`${line}: invalid JSON (${err.message})`);
      return;
    }
    const errs = validateEntry(obj, line, seen);
    if (errs.length) errors.push(...errs);
    else entries.push(obj);
  });
  if (errors.length) throw new ManifestError(errors, source);
  if (entries.length === 0) throw new ManifestError(['manifest has no entries'], source);
  return entries;
}

export function loadManifest(file) {
  return parseManifest(readFileSync(file, 'utf8'), path.basename(file));
}
