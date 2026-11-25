/**
 * A/B sample files on disk. An arm is a directory of `sample-<n>.json.gz`
 * files written by `ab-capture`, or a comma-separated list of sample files.
 * Node only: used by the offline analyzer.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Arm } from './arm';
import { observeSample } from './observations';
import { buildAbSample, isAbSample, type AbSample } from './sample';

const SAMPLE_FILE = /^sample-(\d+)\.json(\.gz)?$/;

export function readJsonFile(file: string): unknown {
  const bytes = readFileSync(file);
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return JSON.parse((gzipped ? gunzipSync(bytes) : bytes).toString('utf8'));
}

/** Sample files of a directory, by sample number. */
export function sampleFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => ({ name, match: SAMPLE_FILE.exec(name) }))
    .filter((entry) => entry.match)
    .sort((x, y) => Number(x.match![1]) - Number(y.match![1]))
    .map((entry) => join(dir, entry.name));
}

/** `dir` or `a.json,b.json` → the files, and the arm's name. */
export function resolveArm(spec: string): { name: string; files: string[] } {
  if (existsSync(spec) && statSync(spec).isDirectory()) {
    return { name: basename(resolve(spec)), files: sampleFiles(spec) };
  }
  const files = spec.split(',').map((s) => s.trim()).filter(Boolean);
  return { name: files.length === 1 ? basename(files[0]) : spec, files };
}

/**
 * Reads an arm one sample at a time: each export is reduced to its
 * observations before the next is parsed, so an arm of large exports fits in memory.
 */
export function loadArm(spec: string, options: { skip?: unknown } = {}): Arm {
  const { name, files } = resolveArm(spec);
  if (!files.length) throw new Error(`arm ${spec} has no sample files (expected sample-<n>.json.gz from ab-capture)`);
  const skip = Math.max(0, Math.floor(Number(options.skip) || 0));
  if (skip >= files.length) throw new Error(`--skip ${skip} leaves no sample in arm ${name} (${files.length} samples)`);
  const used = files.slice(skip);
  const observations = used.map((file) => {
    const sample = readJsonFile(file);
    if (!isAbSample(sample)) throw new Error(`${file} is not an A/B sample (write samples with ab-capture)`);
    return observeSample(sample);
  });
  return { name, files: used, skipped: skip, observations };
}

/** The next free `sample-<n>.json.gz` in `dir`, creating the directory. */
export function nextSamplePath(dir: string): { file: string; index: number } {
  mkdirSync(dir, { recursive: true });
  const last = sampleFiles(dir).map((file) => Number(SAMPLE_FILE.exec(basename(file))![1])).pop() ?? 0;
  const index = last + 1;
  return { file: join(dir, `sample-${index}.json.gz`), index };
}

export function writeSample(dir: string, input: Omit<Parameters<typeof buildAbSample>[0], 'arm' | 'index'>): { file: string; sample: AbSample; bytes: number } {
  const { file, index } = nextSamplePath(dir);
  const sample = buildAbSample({ ...input, arm: basename(resolve(dir)), index });
  const data = gzipSync(JSON.stringify(sample), { level: 1 });
  writeFileSync(file, data);
  return { file, sample, bytes: data.length };
}
