import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { semanticPosition, ageTransform, separatePoints } from '../src/position.js';
import { extractPastedArticleLinks, requestedArticleURL } from '../src/article.js';

const worker = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const script = worker.slice(worker.indexOf('<script>') + 8, worker.indexOf('</script>'))
  .replace('${MAX_CARDS}', '20')
  .replace('${semanticPosition.toString()}', semanticPosition.toString())
  .replace('${ageTransform.toString()}', ageTransform.toString())
  .replace('${separatePoints.toString()}', separatePoints.toString())
  .replace('${extractPastedArticleLinks.toString()}', extractPastedArticleLinks.toString())
  .replace('${requestedArticleURL.toString()}', requestedArticleURL.toString());

// A deterministic DOM/frame harness exercises the actual served client script.
function client(width, reduced = false) {
  class Element {
    style = {}; children = []; textContent = ''; className = ''; events = {};
    offsetWidth = 120; offsetHeight = 44;
    classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter(n => !names.includes(n)).join(' '); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
    };
    appendChild(child) { this.children.push(child); child.parent = this; }
    remove() { if(this.parent) this.parent.children = this.parent.children.filter(c=>c!==this); }
    setAttribute() {}
    addEventListener(name, fn) { this.events[name] = fn; }
    focus() {}
    setPointerCapture() {}
    hasPointerCapture() { return false; }
  }
  const ws = new Element(), status = new Element();
  const frames = new Map(); let nextFrame = 1;
  const context = vm.createContext({
    innerWidth: width, innerHeight: 844, Element, crypto: { randomUUID: () => 'new' },
    URL, URLSearchParams, location: { search: '' },
    document: { documentElement: new Element(), body: new Element(), getElementById: id => id === 'workspace' ? ws : status,
      createElement: () => new Element(), createElementNS: () => new Element(), addEventListener() {} },
    window: { addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: key => ({ '--dot-size': width < 600 ? '48' : '36', '--hit-size': width < 600 ? '64' : '52', '--label-gap': '24' })[key] }),
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: fn => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    fetch: async () => ({ ok: true, json: async () => ({ generation: 2, cards: [] }) })
  });
  vm.runInContext(script.slice(0, script.indexOf('load().then(')), context);
  return { context, ws, run: code => vm.runInContext(code, context), frame: time => {
    const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn(time));
  } };
}

test('client blinks while inference waits, then moves without overlap and saves ready positions', async () => {
  for (const width of [390, 1440]) {
    const c = client(width);
    let finishInference;
    const inference = new Promise(resolve => { finishInference = resolve; });
    const saves = [];
    c.context.fetch = async (url, options) => {
      if (url === '/api/analyze') { await inference; return { ok: true, json: async () => ({ status: 'analyzed', result: { scores: { institutional: .25, underground: .25, commercial: .25, experimental: .25 }, subjectYear: null } }) }; }
      saves.push(JSON.parse(options.body)); return { ok: true };
    };
    c.run(`nodes.push(createNode({id:'old',title:'Old',link:'https://indexmod.press/old',status:'ready',nx:.5,ny:.5}));
      nodes.push(createNode({id:'new',title:'New',link:'https://indexmod.press/new',nx:.15,ny:.2}));
      for(const node of nodes) ws.appendChild(node.el);
      globalThis.analysisPromise=analyzeNode(nodes[1]);`);
    assert.equal(c.run('nodes[1].get().status'), 'pending');
    assert.equal(c.run('nodes[1].label.children[1].textContent'), 'Calculating…');
    assert.match(worker, /animation:calculationBlink/);
    finishInference();
    for(let i=0;i<12;i++) await Promise.resolve();
    assert.equal(c.run('activeJourneys'), 1);
    let previous, maxStep = 0;
    for(let time=0;time<=5600;time+=16){
      c.frame(time);
      const points=c.run('nodes.map(n=>({...n.anchor}))');
      assert.ok(Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y) >= (width<600?76:64)-.1);
      if(previous) maxStep=Math.max(maxStep,Math.hypot(points[1].x-previous.x,points[1].y-previous.y));
      previous=points[1];
    }
    await c.context.analysisPromise;
    assert.ok(maxStep<10, `frame movement was ${maxStep}`);
    assert.equal(c.run('nodes[1].get().status'), 'ready');
    assert.equal(c.run('trailLayer.children.length'), 0);
    assert.equal(saves.at(-1).cards[1].status, 'ready');
    assert.ok(Math.hypot((saves.at(-1).cards[1].nx-.5)*width,(saves.at(-1).cards[1].ny-.5)*844)<6);
  }
});

test('reduced motion settles in one frame; dragging during travel preserves the manual position', async () => {
  for(const reduced of [true, false]){
    const c=client(1000,reduced);
    c.run(`nodes.push(createNode({id:'a',title:'A',link:'https://indexmod.press/a',status:'ready',nx:.2,ny:.2}));
      globalThis.journey=animateLayout(new Map([[nodes[0],nodes[0].prepareTarget({x:.7,y:.6})]]));`);
    c.frame(0);
    if(!reduced){
      c.frame(1000);
      c.run(`const dot=nodes[0].el.children[0];dot.events.pointerdown({button:0,preventDefault(){},clientX:nodes[0].anchor.x,clientY:nodes[0].anchor.y,pointerId:1});
        dot.events.pointermove({clientX:250,clientY:300});dot.events.pointerup({pointerId:1});`);
      for(let time=1016;time<5600;time+=16)c.frame(time);
      assert.equal(c.run('nodes[0].anchor.x'),250);
      assert.equal(c.run('nodes[0].anchor.y'),300);
    }else assert.ok(Math.abs(c.run('nodes[0].anchor.x')-700)<.1);
    await c.context.journey;
    assert.equal(c.run('activeJourneys'),0);
  }
});
