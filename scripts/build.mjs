import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
fs.writeFileSync(path.join(root, 'bin/axon.js'), bundle, { mode: 0o755 });
console.log(`Built bin/axon.js (${Buffer.byteLength(bundle)} bytes)`);
