import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { extractPastedArticleLinks, requestedArticleURL } from '../src/article.js';

const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const script = worker.slice(worker.lastIndexOf('<script>') + 8, worker.lastIndexOf('</script>'))
  .replace('${MAX_CARDS}', '10')
  .replace('${extractPastedArticleLinks.toString()}', extractPastedArticleLinks.toString())
  .replace('${requestedArticleURL.toString()}', requestedArticleURL.toString());

function client(width) {
  class Element {
    style = {};
    children = [];
    textContent = '';
    className = '';
    events = {};
    href = '';
    offsetWidth = 120;
    offsetHeight = 44;
    classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
    };
    appendChild(child) { this.children.push(child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute() {}
    addEventListener(name, fn) { this.events[name] = fn; }
    focus() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    hasPointerCapture() { return false; }
  }

  const ws = new Element();
  const status = new Element();
  const frames = new Map();
  let nextFrame = 1;
  let now = 0;
  const context = vm.createContext({
    innerWidth: width,
    innerHeight: 844,
    Element,
    URL,
    URLSearchParams,
    location: { search: '' },
    crypto: { randomUUID: () => 'new' },
    performance: { now: () => now },
    document: {
      documentElement: new Element(),
      body: new Element(),
      getElementById: id => id === 'workspace' ? ws : status,
      createElement: () => new Element(),
      addEventListener() {}
    },
    window: { addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: key => ({ '--dot-size': width < 600 ? '48' : '40', '--hit-size': '64' })[key] }),
    requestAnimationFrame: fn => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    fetch: async () => ({ ok: true, json: async () => ({ generation: 2, cards: [] }) })
  });

  vm.runInContext(script.slice(0, script.indexOf('load().then(')), context);
  return {
    context,
    ws,
    run: code => vm.runInContext(code, context),
    frame: time => {
      now = time;
      const current = [...frames.values()];
      frames.clear();
      current.forEach(fn => fn(time));
    }
  };
}

test('flat circles move smoothly, collide elastically and bounce from the viewport edge', () => {
  const c = client(1000);
  c.run(`
    nodes.push(createNode({id:'a', title:'A', link:'https://indexmod.press/a', status:'ready', nx:.45, ny:.5, vx:100, vy:0}));
    nodes.push(createNode({id:'b', title:'B', link:'https://indexmod.press/b', status:'ready', nx:.55, ny:.5, vx:-100, vy:0}));
    nodes.forEach(node => ws.appendChild(node.el));
  `);

  const initial = c.run('nodes.map(node => ({ x:node.body.x, y:node.body.y }))');
  for (let time = 0; time <= 800; time += 16) c.frame(time);
  const final = c.run('nodes.map(node => ({ x:node.body.x, y:node.body.y, vx:node.body.vx, vy:node.body.vy, radius:node.body.radius }))');

  assert.ok(final[0].x !== initial[0].x, 'circles should move between frames');
  assert.ok(final[0].vx < 0, 'first circle should bounce away after collision');
  assert.ok(final[1].vx > 0, 'second circle should bounce away after collision');
  assert.ok(Math.hypot(final[0].x - final[1].x, final[0].y - final[1].y) >= final[0].radius + final[1].radius - .2);

  c.run(`globalThis.edge = createNode({id:'edge', title:'Edge', link:'https://indexmod.press/edge', status:'ready', nx:.5, ny:.2, vx:400, vy:0});
    nodes.push(globalThis.edge); ws.appendChild(globalThis.edge.el);`);
  for (let time = 816; time <= 2400; time += 16) c.frame(time);
  assert.ok(c.run('globalThis.edge.body.x') <= 980.1);
  assert.ok(c.run('globalThis.edge.body.vx') < 0, 'circle should reverse velocity at the right edge');
});

test('the served client has no logo, orbit or visible label layer', () => {
  assert.doesNotMatch(worker, /sphere-logo|orbit-layer|orbit-ring|class="label"|journey-trail/);
  assert.match(worker, /function resolveCircleCollision/);
  assert.match(worker, /const maxCards = \$\{MAX_CARDS\};/);
});
