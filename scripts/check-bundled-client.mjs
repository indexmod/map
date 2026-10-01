import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const file = resolve(process.argv[2]);
let bundle = await readFile(file, 'utf8');
// Wrangler emits text modules beside the JS bundle. Node needs their content
// inlined to import the exact deployed Worker and obtain its served HTML.
for (const match of [...bundle.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+\.md)["'];?/g)]) {
  const content = await readFile(resolve(dirname(file), match[2]), 'utf8');
  bundle = bundle.replace(match[0], `const ${match[1]} = ${JSON.stringify(content)};`);
}
const worker = (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`)).default;
const html = await (await worker.fetch(new Request('https://map.indexmod.press/'), {})).text();
const dir = await mkdtemp(join(tmpdir(), 'map-client-'));
try {
  const path = join(dir, 'index.html');
  await writeFile(path, html);
  const result = spawnSync(process.execPath, ['--test', 'test/motion.test.js'], {
    stdio: 'inherit', env: { ...process.env, MAP_CLIENT_HTML_PATH: path }
  });
  if (result.status !== 0) process.exitCode = 1;
} finally { await rm(dir, { recursive: true, force: true }); }
