#!/usr/bin/env node
'use strict';

const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');

const REQUIRED_FIELDS = ['id', 'q', 'tags', 'a', 'done', 'guard', 'refs'];
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'use', 'what', 'when',
  'where', 'which', 'why', 'with',
]);

function usage() {
  process.stderr.write('Usage: chippy.sh recipes <query...> [--limit N]\n');
}

function parseArgs(argv) {
  let limit = 5;
  const queryParts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--limit') {
      const next = argv[index + 1];
      if (!next || !/^\d+$/.test(next)) {
        throw new Error('--limit requires an integer from 1 to 20');
      }
      limit = Number(next);
      index += 1;
      continue;
    }
    queryParts.push(value);
  }

  if (limit < 1 || limit > 20) {
    throw new Error('--limit must be between 1 and 20');
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    throw new Error('recipes requires a search query');
  }

  return { limit, query };
}

function normalizeToken(token) {
  let value = token.toLowerCase();
  if (value.length > 4 && value.endsWith('ies')) value = `${value.slice(0, -3)}y`;
  else if (value.length > 4 && value.endsWith('ing')) value = value.slice(0, -3);
  else if (value.length > 4 && value.endsWith('ed')) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith('s')) value = value.slice(0, -1);
  return value;
}

function tokenize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function parseRecord(line, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const fields = {};
  for (const part of trimmed.split(' | ')) {
    const equals = part.indexOf('=');
    if (equals <= 0) throw new Error(`invalid recipe field at line ${lineNumber}`);
    fields[part.slice(0, equals)] = part.slice(equals + 1);
  }

  const missing = REQUIRED_FIELDS.filter((field) => !fields[field]);
  if (missing.length > 0) {
    throw new Error(`recipe at line ${lineNumber} is missing: ${missing.join(', ')}`);
  }
  return fields;
}

async function forEachRecipe(file, visit) {
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const record = parseRecord(line, lineNumber);
    if (record) await visit(record);
  }
}

function isEditDistanceOne(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  let edits = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + (leftIndex < left.length || rightIndex < right.length ? 1 : 0) === 1;
}

function matchWeight(queryToken, documentToken) {
  if (queryToken === documentToken) return 1;
  if (
    Math.min(queryToken.length, documentToken.length) >= 4
    && (queryToken.startsWith(documentToken) || documentToken.startsWith(queryToken))
  ) return 0.72;
  if (
    Math.min(queryToken.length, documentToken.length) >= 5
    && isEditDistanceOne(queryToken, documentToken)
  ) return 0.58;
  return 0;
}

function indexedTokens(record) {
  const weightedFields = [
    ['id', 3],
    ['q', 2],
    ['tags', 3],
    ['a', 1],
    ['done', 1],
    ['guard', 1],
    ['refs', 1],
  ];
  const result = [];
  for (const [field, weight] of weightedFields) {
    for (const token of tokenize(record[field])) result.push({ token, weight });
  }
  return result;
}

function termFrequency(queryToken, tokens) {
  let frequency = 0;
  for (const { token, weight } of tokens) {
    frequency += matchWeight(queryToken, token) * weight;
  }
  return frequency;
}

function insertTop(results, candidate, limit) {
  results.push(candidate);
  results.sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id));
  if (results.length > limit) results.length = limit;
}

async function search(file, query, limit) {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) throw new Error('search query contains no searchable words');

  let documentCount = 0;
  let totalLength = 0;
  const documentFrequency = new Map(queryTokens.map((token) => [token, 0]));

  await forEachRecipe(file, (record) => {
    const tokens = indexedTokens(record);
    documentCount += 1;
    totalLength += tokens.length;
    for (const queryToken of queryTokens) {
      if (termFrequency(queryToken, tokens) > 0) {
        documentFrequency.set(queryToken, documentFrequency.get(queryToken) + 1);
      }
    }
  });

  if (documentCount === 0) throw new Error('recipe corpus is empty');
  const averageLength = totalLength / documentCount;
  const results = [];
  const k1 = 1.2;
  const b = 0.75;
  const normalizedPhrase = tokenize(query).join(' ');

  await forEachRecipe(file, (record) => {
    const tokens = indexedTokens(record);
    let score = 0;
    for (const queryToken of queryTokens) {
      const frequency = termFrequency(queryToken, tokens);
      if (frequency === 0) continue;
      const df = documentFrequency.get(queryToken);
      const inverseDocumentFrequency = Math.log(1 + ((documentCount - df + 0.5) / (df + 0.5)));
      const denominator = frequency + k1 * (1 - b + b * (tokens.length / averageLength));
      score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / denominator);
    }

    const searchablePhrase = tokenize(`${record.id} ${record.q} ${record.tags}`).join(' ');
    if (normalizedPhrase.length >= 5 && searchablePhrase.includes(normalizedPhrase)) score += 1.5;
    if (score > 0) insertTop(results, { record, score }, limit);
  });

  return results;
}

function printResults(query, results) {
  if (results.length === 0) {
    process.stderr.write(`No Chippy recipe matched: ${query}\n`);
    process.exitCode = 1;
    return;
  }

  results.forEach(({ record, score }, index) => {
    if (index > 0) process.stdout.write('\n');
    process.stdout.write(`recipe: ${record.id}\n`);
    process.stdout.write(`score: ${score.toFixed(3)}\n`);
    process.stdout.write(`question: ${record.q}\n`);
    process.stdout.write(`answer: ${record.a}\n`);
    process.stdout.write(`done: ${record.done}\n`);
    process.stdout.write(`guard: ${record.guard}\n`);
    process.stdout.write(`refs: ${record.refs}\n`);
  });
}

async function main() {
  const [file, ...argv] = process.argv.slice(2);
  if (!file) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const { query, limit } = parseArgs(argv);
    printResults(query, await search(file, query, limit));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    usage();
    process.exitCode = 1;
  }
}

main();
