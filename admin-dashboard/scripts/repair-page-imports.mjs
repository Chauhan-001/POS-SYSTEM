/**
 * One-off repair (run once from admin-dashboard/, then delete):
 *   node scripts/repair-page-imports.mjs
 *
 * Each moved page (src/pages/<Domain>/<Name>.tsx, originally src/pages/<Name>.tsx)
 * had imports relative to src/pages/. Rewrite them: resolve against the OLD
 * directory (src/pages), apply the move map, express relative to the NEW dir.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const abs = (p) => path.join(ROOT, p);

// Reconstruct old->new for every moved page from the current disk layout.
const moved = new Map(); // newAbs -> oldAbs
const domainDirs = fs.readdirSync(abs('src/pages')).filter((d) =>
  fs.statSync(abs(`src/pages/${d}`)).isDirectory(),
);
for (const d of domainDirs) {
  for (const f of fs.readdirSync(abs(`src/pages/${d}`))) {
    if (!f.endsWith('.tsx')) continue;
    const newAbs = abs(`src/pages/${d}/${f}`);
    const oldAbs = abs(`src/pages/${f}`);
    moved.set(newAbs, oldAbs);
  }
}
console.log(`Found ${moved.size} moved pages to repair.`);

function resolveCandidate(base) {
  for (const ext of ['.tsx', '.ts', '', '.jsx', '.js']) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

let fixed = 0;
const unresolved = [];

for (const [newAbs, oldAbs] of moved) {
  const oldDir = path.dirname(oldAbs);
  const newDir = path.dirname(newAbs);
  let code = fs.readFileSync(newAbs, 'utf8');
  const re = /(from\s*|import\(\s*)(['"])(\.[^'"]*)\2/g;
  code = code.replace(re, (_m, pre, q, spec) => {
    // 1) Already resolves from the new location? Leave it.
    if (resolveCandidate(path.resolve(newDir, spec))) return `${pre}${q}${spec}${q}`;
    // 2) Resolve from the old location.
    const absOld = path.resolve(oldDir, spec);
    const resolved = resolveCandidate(absOld) ?? (fs.existsSync(absOld) ? absOld : null);
    if (!resolved) {
      unresolved.push(`${path.relative(ROOT, newAbs)}: '${spec}'`);
      return `${pre}${q}${spec}${q}`;
    }
    let rel = path.relative(newDir, resolved).replace(/\\/g, '/').replace(/\.(tsx|ts|jsx|js)$/, '');
    if (!rel.startsWith('.')) rel = './' + rel;
    fixed++;
    return `${pre}${q}${rel}${q}`;
  });
  fs.writeFileSync(newAbs, code);
}

console.log(`Repaired ${fixed} specifiers.`);
if (unresolved.length) {
  console.error('STILL UNRESOLVED:\n' + unresolved.join('\n'));
  process.exitCode = 1;
} else {
  console.log('All page imports resolve.');
}
