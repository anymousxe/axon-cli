import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--release-dir')) throw new Error('Usage: node scripts/build.mjs [--release-dir <directory>]');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const sourceVersion = fs.readFileSync(path.join(root, 'src/cli.js'), 'utf8').match(/export const VERSION = '([^']+)';/)?.[1];
if (packageVersion !== sourceVersion) throw new Error('Package and source versions must match');
const entry = path.join(root, 'src/cli.js');
const visited = new Set(), output = [];
function visit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  let source = fs.readFileSync(file, 'utf8');
  const local = /^import\s+[^;]+from\s+['"](\.\.?\/[^'"]+)['"];?\s*$/gm;
  for (const match of source.matchAll(local)) visit(path.resolve(path.dirname(file), match[1]));
  source = source.replace(local, '');
  // Each source module gets its own scope; native imports stay at bundle scope.
  const imports = [];
  source = source.replace(/^import\s+[^;]+from\s+['"]node:[^'"]+['"];?\s*$/gm, line => { imports.push(line.trim()); return ''; });
  const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const)\s+(\w+)/gm)].map(m => m[1]);
  source = source.replace(/^export\s+/gm, '');
  output.push({ file: path.basename(file), imports, source, exports });
}
visit(entry);
const imports = [...new Set(output.flatMap(module => module.imports))];
// Duplicate native imports with the same binding are normalized by name.
const bindings = new Map();
for (const line of imports) {
  const spec = line.match(/^import\s+(.*?)\s+from\s+(['"].*?['"])/s);
  if (!spec) throw new Error(`Unsupported import: ${line}`);
  bindings.set(spec[1], `import ${spec[1]} from ${spec[2]};`);
}
const body = output.map(module => `// ${module.file}\nconst { ${module.exports.join(', ')} } = (() => {\n${module.source}\nreturn { ${module.exports.join(', ')} };\n})();`).join('\n\n');
const bundle = '#!/usr/bin/env node\n// Generated from src/ by scripts/build.mjs. No runtime dependencies.\n' + [...bindings.values()].join('\n') + '\n\n' + body + '\n\nawait main();\n';
fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
fs.writeFileSync(path.join(root, 'bin/axon.mjs'), bundle, { mode: 0o755 });
console.log(`Built bin/axon.mjs (${Buffer.byteLength(bundle)} bytes)`);
if (args.length) {
  const releaseDir = path.resolve(args[1]);
  const asset = `axon-${packageVersion}.mjs`;
  const bytes = Buffer.from(bundle);
  fs.mkdirSync(releaseDir, { recursive: true });
  const assetPath = path.join(releaseDir, asset);
  if (fs.existsSync(assetPath) && !fs.readFileSync(assetPath).equals(bytes)) throw new Error('Versioned releases are immutable; bump the version first');
  fs.writeFileSync(assetPath, bytes, { mode: 0o755 });
  const manifest = { version: packageVersion, path: `/cli/${asset}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const pending = path.join(releaseDir, `manifest.${process.pid}.tmp`);
  fs.writeFileSync(pending, JSON.stringify(manifest, null, 2) + '\n');
  fs.renameSync(pending, path.join(releaseDir, 'manifest.json'));
  console.log(`Prepared ${asset} and manifest.json in ${releaseDir}`);
}
