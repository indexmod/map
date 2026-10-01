import prompt from '../prompts/map-semantic.md';
import { analyze, hash } from '../src/analyze.js';
import { fetchArticle, extractPastedArticleLinks } from '../src/article.js';
import { huggingFace } from '../src/huggingface.js';
import { cloudflareAI } from '../src/cloudflare.js';
import { semanticPosition, ageTransform } from '../src/position.js';
const MAP_GENERATION = 2;
const MAX_CARDS = 20;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // =====================
    // UI
    // =====================
    if (url.pathname === "/") {
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }

    // =====================
    // GET TITLE (STABLE FRONTMATTER)
    // =====================
    if (url.pathname === "/api/title") {
      const page = url.searchParams.get("url");

      try {
        const u = new URL(page);

        if (!u.hostname.includes("indexmod.press")) {
          return Response.json({ title: "Untitled" });
        }

        const slug = u.pathname.split("/").filter(Boolean).pop();
        if (!slug) {
          return Response.json({ title: "Untitled" });
        }

        const api = `${u.origin}/_get/${slug}`;
        const res = await fetch(api);

        if (!res.ok) {
          return Response.json({ title: "Untitled" });
        }

        const data = await res.json();
        const content = data?.content || "";

        const block = content.match(/---([\s\S]*?)---/);
        let title = null;

        if (block) {
          const t = block[1].match(/title:\s*([^\r\n]+)/i);
          if (t) title = t[1].trim();
        }

        return Response.json({
          title: title || data?.title || slug || "Untitled"
        });

      } catch {
        return Response.json({ title: "Untitled" });
      }
    }

    // =====================
    // LOAD
    // =====================
    if (url.pathname === "/api/load") {
      const raw = await env.MAP_DB.get("map_state");
      const state = raw ? JSON.parse(raw) : { cards: [] };
      if (state.generation !== MAP_GENERATION) {
        const fresh = { generation: MAP_GENERATION, cards: [] };
        await env.MAP_DB.put("map_state", JSON.stringify(fresh));
        return Response.json(fresh);
      }
      return Response.json(state);
    }

    // Analysis is cached separately from map_state and never moves a card by itself.
    if (url.pathname === "/api/analyze") {
      if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
      try {
        const body = await req.json();
        const { url: articleURL, raw } = await fetchArticle(body.link);
        const hour = new Date().toISOString().slice(0, 13);
        const limitKey = `rate:${await hash(`${req.headers.get('CF-Connecting-IP') || 'unknown'}:${hour}`)}`;
        const used = Number(await env.MAP_DB.get(limitKey)) || 0;
        if (used >= 30) return Response.json({ error: 'Analysis limit reached; try again later' }, { status: 429 });
        await env.MAP_DB.put(limitKey, String(used + 1), { expirationTtl: 7200 });
        const engine = env.MAP_AI_PROVIDER === 'hf' ? huggingFace(env) : cloudflareAI(env);
        const result = await analyze({ raw, prompt, mode: 'hf', model: engine.model,
          endpoint: engine.endpoint, infer: engine.infer, cache: env.MAP_DB, requireSeptember: false });
        return Response.json({ url: articleURL, ...result }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 502 });
      }
    }

    // =====================
    // SAVE
    // =====================
    if (url.pathname === "/api/save") {
      const data = await req.json();
      if (data?.generation !== MAP_GENERATION || !Array.isArray(data.cards)) return new Response('Outdated map state', { status: 409 });
      data.cards = data.cards.slice(-MAX_CARDS);
      await env.MAP_DB.put("map_state", JSON.stringify(data));
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }
};

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Map — Indexmod</title>

<style>
:root{
  color-scheme:light;
  --dot-size:36px;
  --hit-size:52px;
  --label-gap:22px;
  --label-width:min(42vw,420px);
  --label-size:16px;
}

*{
  box-sizing:border-box;
}

html,body{
  margin:0;
  width:100%;
  height:100%;
  overflow:hidden;
  background:#fff;
  color:#000;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}

body{
  overscroll-behavior:none;
}

/* Логотип в центре — неподвижная система отсчёта всей карты. */
.sphere-logo{
  position:fixed;
  left:50%;
  top:50%;
  width:min(70vw,70vh);
  height:min(70vw,70vh);
  max-width:70vw;
  max-height:70vh;
  object-fit:contain;
  transform:translate(-50%,-50%);
  z-index:0;
  pointer-events:none;
  user-select:none;
  -webkit-user-drag:none;
}

#workspace{
  position:fixed;
  inset:0;
  z-index:1;
  touch-action:none;
}

.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

@keyframes nodePulse{
  0%,100%{transform:translateY(-2px) scale(.97);opacity:.86}
  50%{transform:translateY(2px) scale(1.045);opacity:1}
}
.node{
  transition:left 3.8s cubic-bezier(.22,.61,.24,1),top 3.8s cubic-bezier(.22,.61,.24,1);
  animation:nodePulse 4.6s ease-in-out infinite;
  transform-origin:0 0;
}
.node.pending{animation-duration:1.35s}
.node.recalculating{animation-duration:1.35s}
.node.dragging{transition:none;animation:none;transform:none;opacity:1}
.node.error .dot::before{box-shadow:0 0 0 3px #ff3b30}
@media (prefers-reduced-motion:reduce){.node{transition:none;animation:none;transform:none;opacity:1}}

.node{
  position:absolute;
  display:flex;
  align-items:center;
  width:0;
  height:0;
  user-select:none;
  -webkit-user-select:none;
}

.dot{
  position:absolute;
  left:0;
  top:0;
  flex:0 0 auto;
  width:var(--hit-size);
  height:var(--hit-size);
  border-radius:50%;
  cursor:grab;
  touch-action:none;
  transform:translate(-50%,-50%);
}

.dot::before{
  content:"";
  position:absolute;
  left:50%;
  top:50%;
  width:var(--dot-size);
  height:var(--dot-size);
  border-radius:50%;
  background:currentColor;
  transform:translate(-50%,-50%);
  pointer-events:none;
}

.node.dragging{
  z-index:10;
}

.node.dragging .dot{
  cursor:grabbing;
}

.title{
  min-width:0;
  color:#000;
  text-decoration:none;
  font-size:var(--label-size);
  line-height:1.45;
  overflow-wrap:anywhere;
}

.label{
  position:absolute;
  display:flex;
  align-items:center;
  gap:12px;
  width:max-content;
  max-width:var(--label-width);
}

.label a{
  display:block;
  flex:1;
  white-space:normal;
}

@media (max-width:600px), (pointer:coarse){
  :root{
    --dot-size:48px;
    --hit-size:64px;
    --label-gap:24px;
    --label-size:clamp(17px,4.8vw,20px);
  }

  .label{
    align-items:flex-start;
  }

  .label a{
    line-height:1.3;
  }


}

@media (max-width:600px){
  :root{
    --label-width:min(70vw,280px);
  }
}
</style>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='black'/%3E%3Ccircle cx='11' cy='13' r='2' fill='white'/%3E%3Ccircle cx='21' cy='13' r='2' fill='white'/%3E%3Crect x='12' y='20' width='8' height='2' rx='1' fill='white'/%3E%3C/svg%3E">
</head>

<body tabindex="0">
<img class="sphere-logo" src="https://indexmod.press/logo.svg" alt="Indexmod" aria-hidden="true">
<div id="workspace"></div>
<output id="analysis-status" class="sr-only" aria-live="polite"></output>

<script>
const ws = document.getElementById("workspace");
let nodes = [];
let pasteQueue = Promise.resolve();
let savePromise = Promise.resolve();
let mapState = {};
let lastPointer = { x:innerWidth/2, y:innerHeight/2 };
let pendingAnalyses = 0;
let activeJourneys = 0;
let reflowPending = false;
const analysisStatus = document.getElementById("analysis-status");
const maxCards = ${MAX_CARDS};
${semanticPosition.toString()}
${ageTransform.toString()}
${extractPastedArticleLinks.toString()}

window.addEventListener("pointermove",e=>{ lastPointer = {x:e.clientX,y:e.clientY}; },{passive:true});

function updatePulse(){
  const recalculating = pendingAnalyses > 0 || activeJourneys > 0;
  for (const node of nodes) node.el.classList.toggle("recalculating",recalculating);
}

async function analyzeNode(node){
  pendingAnalyses++;
  updatePulse();
  node.setStatus("pending");
  try {
    const response = await fetch("/api/analyze", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({link:node.get().link})
    });
    const analysis = await response.json();
    if (!response.ok) throw new Error(analysis.error || "Analysis failed");
    if (analysis.status === "analyzed") {
      if (!nodes.includes(node)) return analysis;
      node.setAnalysis(analysis);
      node.setStatus("ready");
      reflowPending = true;
    }
    return analysis;
  } finally {
    pendingAnalyses--;
    if (pendingAnalyses === 0 && reflowPending) {
      reflowPending = false;
      await reflow();
      await save();
    }
    updatePulse();
  }
}

function reflow(){
  const years = nodes.map(n => n.get().analysis?.result?.subjectYear).filter(Number.isFinite);
  const oldestYear = years.length > 1 && Math.min(...years) < Math.max(...years) ? Math.min(...years) : 1900;
  const newestYear = years.length > 1 && Math.min(...years) < Math.max(...years) ? Math.max(...years) : 2026;
  const journeys = [];
  for (const node of nodes) {
    const profile = node.get().analysis?.result;
    if (!profile) continue;
    const base = semanticPosition(profile.scores);
    const target = ageTransform(base,profile.subjectYear,{oldestYear,newestYear}).position;
    if (target) journeys.push(node.visitTarget(target));
  }
  if (!journeys.length) return;
  activeJourneys++;
  updatePulse();
  return Promise.allSettled(journeys).then(()=>{ activeJourneys--; updatePulse(); });
}

const colorAnchors = [
  { x:0.5, y:0.5, color:[48,48,48] },
  { x:0,   y:0,   color:[255,59,48] },
  { x:1,   y:0,   color:[45,112,255] },
  { x:1,   y:1,   color:[255,149,0] },
  { x:0,   y:1,   color:[48,209,88] }
];

function clamp(value,min,max){
  return Math.min(max,Math.max(min,value));
}

function normalizedPosition(d){
  if(Number.isFinite(d.nx) && Number.isFinite(d.ny)){
    return {
      x:clamp(d.nx,0.015,0.985),
      y:clamp(d.ny,0.025,0.975)
    };
  }

  // Миграция старых данных, которые были сохранены в пикселях.
  const oldX = Number.isFinite(d.x) ? d.x : innerWidth/2;
  const oldY = Number.isFinite(d.y) ? d.y : innerHeight/2;

  if(oldX >= 0 && oldX <= 1 && oldY >= 0 && oldY <= 1){
    return { x:oldX, y:oldY };
  }

  return {
    x:clamp(oldX/innerWidth,0.015,0.985),
    y:clamp(oldY/innerHeight,0.025,0.975)
  };
}

function colorAt(x,y){
  let total = 0;
  const channels = [0,0,0];

  for(const anchor of colorAnchors){
    const distance = Math.hypot(x-anchor.x,y-anchor.y);
    const weight = 1/Math.pow(distance+0.065,3.35);
    total += weight;
    channels[0] += anchor.color[0]*weight;
    channels[1] += anchor.color[1]*weight;
    channels[2] += anchor.color[2]*weight;
  }

  return "rgb(" + channels.map(value=>Math.round(value/total)).join(",") + ")";
}

// =====================
// PASTE
// =====================
async function addArticle(articleURL,insertionPosition){
  if(nodes.some(node=>node.get().link===articleURL)) return;
  try{
    const node = createNode({
      id:crypto.randomUUID(),title:articleURL.split("/").pop(),link:articleURL,
      status:"pending",...insertionPosition
    });
    ws.appendChild(node.el);
    nodes.push(node);
    while(nodes.length>maxCards) nodes.shift().el.remove();
    updatePulse();
    scheduleLabelLayout();
    const initialSave = save();
    const titleRequest = fetch("/api/title?url="+encodeURIComponent(articleURL))
      .then(response=>response.ok?response.json():null).catch(()=>null);
    analyzeNode(node).catch(error=>{
      node.setStatus("error");
      analysisStatus.textContent=error.message;
    });
    titleRequest.then(meta=>{
      if(meta?.title && nodes.includes(node)){
        node.setTitle(meta.title);
        scheduleLabelLayout();
        save().catch(error=>{analysisStatus.textContent=error.message;});
      }
    });
    await initialSave;
  }catch(error){
    analysisStatus.textContent=error.message;
  }
}

document.body.focus({preventScroll:true});
document.body.addEventListener("pointerdown",e=>{
  if(e.target instanceof Element && !e.target.closest("a")) document.body.focus({preventScroll:true});
});
document.addEventListener("paste",e=>{
  const links = extractPastedArticleLinks(e.clipboardData?.getData("text")||"");
  if(!links.length) return;
  e.preventDefault();
  const insertionPosition = cursorPosition();
  for(const link of links){
    pasteQueue = pasteQueue.then(()=>addArticle(link,insertionPosition));
  }
});

// =====================
// NODE
// =====================
function createNode(d){
  const el = document.createElement("div");
  el.className = "node " + (d.status || (d.analysis ? "ready" : "pending"));

  const dot = document.createElement("div");
  dot.className = "dot";

  const a = document.createElement("a");
  a.className = "title";
  a.href = d.link;
  a.target = "_blank";
  a.textContent = d.title;

  const label = document.createElement("div");
  label.className = "label";
  label.appendChild(a);

  el.appendChild(dot);
  el.appendChild(label);

  const position = normalizedPosition(d);
  let analysis = d.analysis || null;
  let status = d.status || (analysis ? "ready" : "pending");
  let manualOffset = d.manualOffset || { x:0, y:0 };
  let journey = null;
  let baseTarget = null;
  let touchedBeforeAnalysis = false;
  const anchor = { x:0, y:0 };

  function render(){
    const margin = dotMetrics().hitSize/2+12;
    anchor.x = clamp(position.x*innerWidth,margin,innerWidth-margin);
    anchor.y = clamp(position.y*innerHeight,margin,innerHeight-margin);
    el.style.left = anchor.x+"px";
    el.style.top = anchor.y+"px";

    const color = colorAt(position.x,position.y);
    dot.style.color = color;
  }

  function moveTo(clientX,clientY,offsetX,offsetY){
    position.x = clamp((clientX-offsetX)/innerWidth,0.015,0.985);
    position.y = clamp((clientY-offsetY)/innerHeight,0.025,0.975);
    if(baseTarget) manualOffset = {x:position.x-baseTarget.x,y:position.y-baseTarget.y};
    else touchedBeforeAnalysis = true;
    render();
    scheduleLabelLayout();
  }

  function stopJourneyAtVisiblePosition(){
    if(!journey) return;
    const style = getComputedStyle(el);
    const visibleX = parseFloat(style.left);
    const visibleY = parseFloat(style.top);
    journey.cancel();
    journey = null;
    if(Number.isFinite(visibleX) && Number.isFinite(visibleY)){
      position.x = clamp(visibleX/innerWidth,0.015,0.985);
      position.y = clamp(visibleY/innerHeight,0.025,0.975);
      render();
    }
  }

  function visitTarget(target){
    stopJourneyAtVisiblePosition();
    if(touchedBeforeAnalysis && !baseTarget){
      manualOffset = {x:position.x-target.x,y:position.y-target.y};
      touchedBeforeAnalysis = false;
    }
    baseTarget = target;
    const margin = dotMetrics().hitSize/2+12;
    const destination = {
      x:clamp((target.x+manualOffset.x)*innerWidth,margin,innerWidth-margin),
      y:clamp((target.y+manualOffset.y)*innerHeight,margin,innerHeight-margin)
    };
    const start = {x:anchor.x,y:anchor.y};
    position.x = destination.x/innerWidth;
    position.y = destination.y/innerHeight;
    render();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    journey = el.animate([
      {left:start.x+"px",top:start.y+"px"},
      {left:anchor.x+"px",top:anchor.y+"px"}
    ],{duration:4800,easing:"cubic-bezier(.22,.61,.24,1)"});
    const current = journey;
    return current.finished.catch(()=>{}).then(()=>{if(journey===current) journey=null;});
  }

  let drag = false;
  let offsetX = 0;
  let offsetY = 0;

  dot.addEventListener("pointerdown",e=>{
    if(e.button!==0) return;
    e.preventDefault();
    stopJourneyAtVisiblePosition();
    drag = true;
    offsetX = e.clientX-anchor.x;
    offsetY = e.clientY-anchor.y;
    el.classList.add("dragging");
    dot.setPointerCapture(e.pointerId);
  });

  dot.addEventListener("pointermove",e=>{
    if(!drag) return;
    moveTo(e.clientX,e.clientY,offsetX,offsetY);
  });

  function finishDrag(e){
    if(!drag) return;
    drag = false;
    el.classList.remove("dragging");
    if(dot.hasPointerCapture(e.pointerId)){
      dot.releasePointerCapture(e.pointerId);
    }
    scheduleLabelLayout();
    save();
  }

  dot.addEventListener("pointerup",finishDrag);
  dot.addEventListener("pointercancel",finishDrag);

  render();

  return {
    id:d.id,
    el,
    label,
    position,
    visitTarget,
    setTitle:value=>{d.title=value;a.textContent=value;},
    setAnalysis:value=>{ analysis = value; dot.title = "Analyzed " + (value.updated || ""); },
    setStatus:value=>{ status = value; el.classList.remove("pending","ready","error"); el.classList.add(value); },
    anchor,
    render,
    get:()=>({
      id:d.id,
      title:d.title,
      link:d.link,
      analysis,
      status,
      manualOffset,
      nx:Number(position.x.toFixed(6)),
      ny:Number(position.y.toFixed(6))
    })
  };
}

function dotMetrics(){
  const style = getComputedStyle(document.documentElement);
  return {
    size:parseFloat(style.getPropertyValue("--dot-size")),
    hitSize:parseFloat(style.getPropertyValue("--hit-size")),
    gap:parseFloat(style.getPropertyValue("--label-gap"))
  };
}

function cursorPosition(){
  const margin = dotMetrics().hitSize/2+12;
  return {
    nx:clamp(lastPointer.x,margin,innerWidth-margin)/innerWidth,
    ny:clamp(lastPointer.y,margin,innerHeight-margin)/innerHeight
  };
}

function overlapArea(a,b){
  const width = Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
  const height = Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  return width*height;
}

let labelLayoutFrame = 0;

function scheduleLabelLayout(){
  cancelAnimationFrame(labelLayoutFrame);
  labelLayoutFrame = requestAnimationFrame(layoutLabels);
}

function layoutLabels(){
  const {size,hitSize,gap} = dotMetrics();
  const margin = 12;
  const separation = 16;
  const placedLabels = [];
  const dots = nodes.map(node=>({
    left:node.anchor.x-hitSize/2-6,
    right:node.anchor.x+hitSize/2+6,
    top:node.anchor.y-hitSize/2-6,
    bottom:node.anchor.y+hitSize/2+6
  }));
  const ordered = [...nodes].sort((a,b)=>a.position.y-b.position.y || a.position.x-b.position.x);
  const labelSizes = new Map(nodes.map(node=>[node,{
    width:node.label.offsetWidth,
    height:node.label.offsetHeight
  }]));

  for(const node of ordered){
    const {width,height} = labelSizes.get(node);
    const {x,y} = node.anchor;
    const radius = size/2+gap;
    const ownDot = {left:x-radius,right:x+radius,top:y-radius,bottom:y+radius};
    const obstacles = [...dots,ownDot,...placedLabels];
    const xs = [x+radius,x-radius-width,x-width/2,margin,innerWidth-margin-width];
    const ys = [y-height/2,y+radius,y-radius-height,margin,innerHeight-margin-height];
    for(const obstacle of obstacles){
      xs.push(obstacle.left-width,obstacle.right);
      ys.push(obstacle.top-height,obstacle.bottom);
    }
    const positions = (values,min,max,center,length) => [...new Set(values.map(value=>clamp(value,min,Math.max(min,max))))]
      .sort((a,b)=>Math.abs(a+length/2-center)-Math.abs(b+length/2-center))
      .slice(0,24);
    const xPositions = positions(xs,margin,innerWidth-margin-width,x,width);
    const yPositions = positions(ys,margin,innerHeight-margin-height,y,height);
    let bestRect;
    let bestScore = Infinity;

    for(const left of xPositions){
      for(const top of yPositions){
        const rect = {left,top,right:left+width,bottom:top+height};
        const overlap = obstacles.reduce((sum,obstacle)=>sum+overlapArea(rect,obstacle),0);
        const distance = Math.hypot(clamp(x,rect.left,rect.right)-x,clamp(y,rect.top,rect.bottom)-y);
        const alignment = Math.abs(top+height/2-y)*0.1+(left<x ? 0.5 : 0);
        const score = overlap*10000+distance+alignment;
        if(score<bestScore){
          bestScore=score;
          bestRect=rect;
        }
      }
    }

    node.label.style.left = (bestRect.left-x)+"px";
    node.label.style.top = (bestRect.top-y)+"px";
    placedLabels.push({
      left:bestRect.left-separation,
      right:bestRect.right+separation,
      top:bestRect.top-separation,
      bottom:bestRect.bottom+separation
    });
  }
}

// =====================
// SAVE / LOAD
// =====================
async function save(){
  const body = JSON.stringify({ ...mapState, cards:nodes.map(n=>n.get()) });

  savePromise = savePromise
    .catch(()=>{})
    .then(async()=>{
      const response = await fetch("/api/save",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body
      });
      if (!response.ok) throw new Error("Map save failed: " + response.status);
    });

  return savePromise;
}

async function load(){
  const r = await fetch("/api/load");
  const d = await r.json();
  mapState = d;

  for(const i of (d.cards||[])){
    const n = createNode(i);
    ws.appendChild(n.el);
    nodes.push(n);
  }
  while (nodes.length > maxCards) nodes.shift().el.remove();
  if ((d.cards||[]).length > 20) await save();
}

window.addEventListener("resize",()=>{
  for(const node of nodes) node.render();
  scheduleLabelLayout();
});

load().then(()=>{
  scheduleLabelLayout();
  for (const node of nodes.filter(n => !n.get().analysis)) {
    analyzeNode(node).catch(error => { node.setStatus("error"); analysisStatus.textContent = error.message; });
  }
}).catch(error => { analysisStatus.textContent = error.message; });
</script>

</body>
</html>`;
