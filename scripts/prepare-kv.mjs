import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const title = 'MAP_DB';
const wrangler = (...args) => execFileSync('./node_modules/.bin/wrangler', args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const namespaces = () => {
  const output = wrangler('kv', 'namespace', 'list');
  const start = output.indexOf('[');
  if (start < 0) throw new Error('Wrangler did not return a KV namespace list');
  return JSON.parse(output.slice(start));
};

let namespace = namespaces().find(item => item.title === title);
if (!namespace) {
  wrangler('kv', 'namespace', 'create', title, '--binding', 'MAP_DB', '--update-config=false');
  namespace = namespaces().find(item => item.title === title);
}
if (!namespace?.id || !/^[a-f0-9]{32}$/i.test(namespace.id)) {
  throw new Error(`KV namespace ${title} was not found after creation`);
}

const path = 'wrangler.toml';
const config = readFileSync(path, 'utf8');
const binding = /(\[\[kv_namespaces\]\]\r?\nbinding = "MAP_DB")(?:\r?\nid = "[^"]*")?/;
if (!binding.test(config)) throw new Error('Missing MAP_DB binding in wrangler.toml');
writeFileSync(path, config.replace(binding, `$1\nid = "${namespace.id}"`));
console.log(`Using dedicated KV namespace ${title}`);
