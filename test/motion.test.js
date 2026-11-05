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
    dataset = {};
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
  const timers = new Map();
  let nextFrame = 1;
  let nextTimer = 1;
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
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
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
    },
    flushTimers: () => {
      const current = [...timers.values()];
      timers.clear();
      current.forEach(fn => fn());
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

  const initial = c.run('nodes.map(node => ({ x:node.body.x, y:node.body.y, color:node.el.children[0].style.color, label:node.el.children[0].dataset.label }))');
  assert.equal(initial[0].color, '#000');
  assert.equal(initial[0].label, 'A');
  for (let time = 0; time <= 800; time += 16) c.frame(time);
  const final = c.run('nodes.map(node => ({ x:node.body.x, y:node.body.y, vx:node.body.vx, vy:node.body.vy, radius:node.body.radius, color:node.el.children[0].style.color, labelVisible:node.el.className.includes("collision-visible") }))');

  assert.ok(final[0].x !== initial[0].x, 'circles should move between frames');
  assert.ok(final[0].vx < 0, 'first circle should bounce away after collision');
  assert.ok(final[1].vx > 0, 'second circle should bounce away after collision');
  assert.notEqual(final[0].color, '#000', 'collision should flash a visible color');
  assert.equal(final[0].labelVisible, true, 'first collision link should be visible');
  assert.equal(final[1].labelVisible, true, 'second collision link should be visible');
  assert.ok(Math.hypot(final[0].x - final[1].x, final[0].y - final[1].y) >= final[0].radius + final[1].radius - .2);
  c.flushTimers();
  assert.doesNotMatch(c.run('nodes[0].el.className'), /collision-visible/);
  assert.doesNotMatch(c.run('nodes[1].el.className'), /collision-visible/);

  c.run(`globalThis.edge = createNode({id:'edge', title:'Edge', link:'https://indexmod.press/edge', status:'ready', nx:.5, ny:.2, vx:400, vy:0});
    nodes.push(globalThis.edge); ws.appendChild(globalThis.edge.el);`);
  for (let time = 816; time <= 2400; time += 16) c.frame(time);
  assert.ok(c.run('globalThis.edge.body.x') <= 980.1);
  assert.ok(c.run('globalThis.edge.body.vx') < 0, 'circle should reverse velocity at the right edge');
});

test('circle size follows article age and speed follows update freshness', () => {
  const c = client(1000);
  c.run(`
    globalThis.oldArticle = createNode({id:'old', title:'Old', link:'https://indexmod.press/old', status:'ready',
      analysis:{created:'2016-01-01', updated:'2026-09-01', result:{subjectYear:2026}}});
    globalThis.newArticle = createNode({id:'new', title:'New', link:'https://indexmod.press/new', status:'ready',
      analysis:{created:'2026-10-01', updated:'2026-09-01', result:{subjectYear:1950}}});
    globalThis.freshArticle = createNode({id:'fresh', title:'Fresh', link:'https://indexmod.press/fresh', status:'ready',
      analysis:{updated:new Date().toISOString().slice(0,10), result:{subjectYear:2026}}});
    globalThis.unupdatedArticle = createNode({id:'unupdated', title:'Unupdated', link:'https://indexmod.press/unupdated', status:'ready',
      analysis:{result:{subjectYear:2026}}});
  `);

  const metrics = c.run(`({
    oldSize:oldArticle.body.radius*2,
    newSize:newArticle.body.radius*2,
    freshSpeed:Math.hypot(freshArticle.body.vx,freshArticle.body.vy),
    unupdatedSpeed:Math.hypot(unupdatedArticle.body.vx,unupdatedArticle.body.vy)
  })`);
  assert.ok(metrics.oldSize > metrics.newSize, 'older articles should have larger circles');
  assert.ok(metrics.freshSpeed > metrics.unupdatedSpeed, 'recently updated articles should move faster');
  assert.equal(Math.round(metrics.unupdatedSpeed), 18, 'articles without an update should use the minimum speed');
});

test('the served client has no logo, orbit or visible label layer', () => {
  assert.doesNotMatch(worker, /sphere-logo|orbit-layer|orbit-ring|class="label"|journey-trail/);
  assert.match(worker, /content:attr\(data-label\)/);
  assert.match(worker, /function resolveCircleCollision/);
  assert.match(worker, /const maxCards = \$\{MAX_CARDS\};/);
  assert.match(worker, /function motionSize/);
  assert.match(worker, /function motionSpeed/);
});
