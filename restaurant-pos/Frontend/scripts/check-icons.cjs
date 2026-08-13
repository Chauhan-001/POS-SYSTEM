/* One-off audit: every icon imported from 'lucide-react' must exist in the installed package. */
const fs = require('fs');
const path = require('path');

const ROOTS = ['src', 'components'];
const files = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) files.push(p);
  }
})(ROOTS[0]);
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) files.push(p);
  }
})(ROOTS[1]);

const imported = new Map(); // name -> [files]
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(',')) {
      const clean = part.replace(/\s+/g, ' ').trim();
      if (!clean || clean.startsWith('type ') || clean.startsWith('/*')) continue;
      // name is the BASE export before any `as Alias`.
      const name = clean.split(' as ')[0].trim();
      if (!name) continue;
      if (!imported.has(name)) imported.set(name, []);
      imported.get(name).push(f);
    }
  }
}

// Exported names from the installed package's d.ts.
const dtsPath = 'node_modules/lucide-react/dist/lucide-react.d.ts';
const dts = fs.readFileSync(dtsPath, 'utf8');
const exported = new Set([...dts.matchAll(/as\s+([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]));
// The .d.ts is the "as" form; also pick up plain `export { IconName }` aliases.
for (const m of dts.matchAll(/\bexport\s*\{\s*([A-Z][A-Za-z0-9]*)\s*\}/g)) exported.add(m[1]);

const missing = [...imported.keys()].filter((n) => !exported.has(n));
console.log('Files scanned:', files.length);
console.log('Unique imported icon names:', imported.size);
console.log('Exported names in installed lucide-react:', exported.size);
if (missing.length === 0) {
  console.log('RESULT: ALL', imported.size, 'imported icons exist in lucide-react@' + require('lucide-react/package.json').version);
} else {
  console.log('MISSING ICONS:');
  for (const n of missing.sort()) {
    console.log('  -', n, '->', [...new Set(imported.get(n))].join(', '));
  }
  process.exitCode = 1;
}
