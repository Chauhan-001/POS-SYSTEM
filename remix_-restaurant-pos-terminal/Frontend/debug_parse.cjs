const fs = require('fs');
const parser = require('@babel/parser');

const lines = fs.readFileSync('src/App.tsx', 'utf8').split('\n');

// Parse full file
try {
  parser.parse(lines.join('\n'), {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log('Full file parses OK');
} catch (e) {
  console.log('Full file error:', e.message);
  console.log('Location:', e.loc);
}

// Try incremental parsing around line 2536
const start = 2390;
const end = 2550;
const code = lines.slice(start - 1, end).join('\n');
try {
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log('Snippet 2390-2550 parses OK');
} catch (e) {
  console.log('Snippet 2390-2550 error:', e.message);
  console.log('Location:', e.loc);
}

// Try binary search
let low = 2400;
let high = 2548;
let badLow = high;
let goodHigh = low;

while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  const snippet = lines.slice(start - 1, mid).join('\n');
  try {
    parser.parse(snippet, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    });
    console.log(`Lines 2390-${mid} parse OK`);
    goodHigh = mid;
    low = mid + 1;
  } catch (e) {
    console.log(`Lines 2390-${mid} error: ${e.message} at line ${e.loc.line}, col ${e.loc.column}`);
    badLow = mid;
    high = mid - 1;
  }
}
