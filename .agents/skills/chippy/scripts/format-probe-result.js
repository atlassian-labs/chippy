#!/usr/bin/env node
/* eslint-disable */

const mode = process.argv[2] || 'text';
let input = '';

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  if (mode === 'json') {
    process.stdout.write(JSON.stringify(payload, null, 2));
    return;
  }
  if (!payload?.ok || !payload?.result?.ok) {
    process.stdout.write(JSON.stringify(payload, null, 2));
    return;
  }
  const result = payload.result;
  const text = String(result.text || '');
  if (mode === 'complexity') {
    const lines = text.split('\n');
    const start = lines.indexOf('complexity:');
    const end = lines.indexOf('structure:');
    if (start >= 0) {
      const until = end > start ? end : lines.length;
      process.stdout.write(lines.slice(start, until).join('\n'));
      return;
    }
  }
  process.stdout.write(text || JSON.stringify(payload, null, 2));
});
