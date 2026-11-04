import prompt from '../prompts/map-semantic.md';
import { analyze, hash } from '../src/analyze.js';
import { fetchArticle, extractPastedArticleLinks, requestedArticleURL } from '../src/article.js';
import { huggingFace } from '../src/huggingface.js';
import { cloudflareAI } from '../src/cloudflare.js';
const MAP_GENERATION = 2;
const MAX_CARDS = 10;
const GA_MEASUREMENT_ID = 'G-RERFC3F88M';
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><circle cx="14" cy="18" r="7" fill="#000"/><circle cx="42" cy="11" r="5" fill="#000"/><circle cx="53" cy="28" r="8" fill="#000"/><circle cx="22" cy="43" r="6" fill="#000"/><circle cx="46" cy="47" r="7" fill="#000"/><circle cx="32" cy="59" r="4" fill="#000"/></svg>`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/favicon.svg") {
      return new Response(favicon, {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" }
      });
    }

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
      const existingCards = Array.isArray(state.cards) ? state.cards : [];
      const cards = existingCards.slice(-MAX_CARDS);
      if (!Array.isArray(state.cards) || cards.length !== existingCards.length) {
        state.cards = cards;
        await env.MAP_DB.put("map_state", JSON.stringify(state));
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
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${GA_MEASUREMENT_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","${GA_MEASUREMENT_ID}");</script>` : ''}

<style>
:root{
  color-scheme:light;
  --dot-size:40px;
  --hit-size:64px;
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

#workspace{
  position:fixed;
  inset:0;
  z-index:0;
  touch-action:none;
}

.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

.node.pending .dot::before{opacity:.5}
.node.error .dot::before{outline:3px solid #ff3b30}

.node{
  position:absolute;
  left:0;
  top:0;
  width:0;
  height:0;
  user-select:none;
  -webkit-user-select:none;
}

.dot{
  position:absolute;
  left:0;
  top:0;
  width:var(--hit-size);
  height:var(--hit-size);
  border-radius:50%;
  cursor:grab;
  touch-action:none;
  transform:translate(-50%,-50%);
  color:inherit;
  text-decoration:none;
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
  transition:width 700ms ease,height 700ms ease;
}

.node.dragging{
  z-index:10;
}

.node.hovering{
  z-index:20;
}

.node.dragging .dot{
  cursor:grabbing;
}

/* The article title is exposed through the link's aria-label and tooltip. */
.title,.label,.calculation-state{display:none}

.dot::after{
  content:attr(data-label);
  position:absolute;
  left:calc(50% + var(--dot-size)/2 + 10px);
  top:50%;
  display:block;
  opacity:0;
  visibility:hidden;
  max-width:min(70vw,420px);
  padding:4px 7px;
  color:#000;
  background:#fff;
  font:14px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  text-decoration:underline;
  text-underline-offset:2px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  transform:translateY(-50%);
  pointer-events:none;
  z-index:20;
  transition:opacity 320ms ease,visibility 0s linear 320ms;
}

.dot:hover::after,.dot:focus-visible::after,.dot.collision-visible::after{
  opacity:1;
  visibility:visible;
  transition-delay:0s;
}
.dot:hover,.dot:focus-visible{z-index:20}

@media (max-width:600px), (pointer:coarse){
  :root{
    --dot-size:48px;
    --hit-size:64px;
  }
}
</style>
</head>

<body tabindex="0">
<div id="workspace"></div>
<output id="analysis-status" class="sr-only" aria-live="polite"></output>

<script>
const ws = document.getElementById("workspace");
let nodes = [];
let pasteQueue = Promise.resolve();
let savePromise = Promise.resolve();
let mapState = {};
let lastPointer = { x:innerWidth/2, y:innerHeight/2 };
const analysisStatus = document.getElementById("analysis-status");
const maxCards = ${MAX_CARDS};
${extractPastedArticleLinks.toString()}
${requestedArticleURL.toString()}

const motionBounds = {
  minSize:20,
  maxSize:68,
  minSpeed:18,
  maxSpeed:120,
  oldestYear:1900,
  ageWindowDays:3650,
  freshnessWindowDays:180
};

window.addEventListener("pointermove",e=>{ lastPointer = {x:e.clientX,y:e.clientY}; },{passive:true});

function updatePulse(){
  analysisStatus.textContent = "Map ready";
}

function trackMapEvent(name, data){
  if(typeof window.gtag !== "function") return;
  window.gtag("event",name,data);
}

function trackArticle(node, eventName = "map_article_published"){
  const data=node.get();
  trackMapEvent(eventName,{
    article_url:data.link,
    article_title:data.title,
    map_slot:nodes.indexOf(node)+1,
    active_points:nodes.length
  });
}

function trackLoadedArticles(){
  for(const node of nodes){
    const link=node.get().link;
    let alreadySeen=false;
    try { alreadySeen=sessionStorage.getItem("map-ga:"+link)==="1"; } catch {}
    if(alreadySeen) continue;
    try { sessionStorage.setItem("map-ga:"+link,"1"); } catch {}
    trackArticle(node,"map_article_active");
  }
}

async function analyzeNode(node){
  node.setStatus("pending");
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
    save().catch(error=>{analysisStatus.textContent=error.message;});
  }
  if (analysis.status !== "analyzed" && nodes.includes(node)) {
    throw new Error(analysis.reason || "Analysis failed");
  }
  return analysis;
}

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

function articleSubjectYear(d,analysis){
  const value = analysis?.result?.subjectYear ?? d.subjectYear;
  return Number.isFinite(value) ? value : null;
}

function articleCreated(d,analysis){
  return analysis?.created || d.created || null;
}

function articleUpdated(d,analysis){
  return analysis?.updated || d.updated || null;
}

function parseArticleDate(value){
  if(typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value.length===10 ? value+"T12:00:00Z" : value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function articleAgeRatio(d,analysis,now=Date.now()){
  const created = parseArticleDate(articleCreated(d,analysis));
  if(created !== null){
    const ageDays = Math.max(0,(now-created)/86400000);
    return clamp(ageDays/motionBounds.ageWindowDays,0,1);
  }

  const year = articleSubjectYear(d,analysis);
  if(!Number.isFinite(year)) return 0;
  const currentYear = new Date(now).getUTCFullYear();
  const range = Math.max(1,currentYear-motionBounds.oldestYear);
  return clamp((currentYear-year)/range,0,1);
}

function articleFreshnessRatio(updated,now=Date.now()){
  const timestamp = parseArticleDate(updated);
  if(timestamp === null) return 0;
  const ageDays = Math.max(0,(now-timestamp)/86400000);
  return clamp(1-ageDays/motionBounds.freshnessWindowDays,0,1);
}

function motionSize(d,analysis){
  const age = articleAgeRatio(d,analysis);
  return motionBounds.minSize + age*(motionBounds.maxSize-motionBounds.minSize);
}

function motionSpeed(d,analysis){
  const freshness = articleFreshnessRatio(articleUpdated(d,analysis));
  return motionBounds.minSpeed + freshness*(motionBounds.maxSpeed-motionBounds.minSpeed);
}

const collisionColors = ["#ef4444","#2563eb","#f59e0b","#10b981","#8b5cf6","#ec4899"];
let collisionColorIndex = 0;

function nextCollisionColor(){
  const color = collisionColors[collisionColorIndex % collisionColors.length];
  collisionColorIndex++;
  return color;
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
        save().catch(error=>{analysisStatus.textContent=error.message;});
      }
      trackArticle(node);
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

  const dot = document.createElement("a");
  dot.className = "dot";
  dot.href = d.link;
  dot.target = "_blank";
  dot.rel = "noopener noreferrer";
  dot.title = d.title || d.link;
  dot.dataset.label = d.title || d.link;
  dot.setAttribute("aria-label",d.title || d.link);
  dot.addEventListener("click",()=>trackMapEvent("map_article_opened",{
    article_url:d.link,
    article_title:d.title
  }));
  el.appendChild(dot);

  const position = normalizedPosition(d);
  let analysis = d.analysis || null;
  let status = d.status || (analysis ? "ready" : "pending");
  let dotSize = motionSize(d,analysis);
  const hasInitialVelocity = Number.isFinite(d.vx) || Number.isFinite(d.vy);
  const body = {
    x:position.x*innerWidth,
    y:position.y*innerHeight,
    vx:Number.isFinite(d.vx) ? d.vx : 0,
    vy:Number.isFinite(d.vy) ? d.vy : 0,
    radius:0,
    hitRadius:0
  };
  if(!body.vx && !body.vy){
    const angle = Math.random()*Math.PI*2;
    const speed = 34+Math.random()*28;
    body.vx = Math.cos(angle)*speed;
    body.vy = Math.sin(angle)*speed;
  }

  let drag = false;
  let dragMoved = false;
  let offsetX = 0;
  let offsetY = 0;
  let previousDrag = null;
  let suppressClick = false;
  let currentColor = "#000";
  let colorTimer = 0;
  let collisionLabelTimer = 0;

  function updateMetrics(){
    const {hitSize} = dotMetrics();
    body.radius = dotSize/2;
    body.hitRadius = hitSize/2;
  }

  function setVelocityMagnitude(speed){
    const currentSpeed = Math.hypot(body.vx,body.vy);
    const angle = currentSpeed > 0 ? Math.atan2(body.vy,body.vx) : Math.random()*Math.PI*2;
    body.vx = Math.cos(angle)*speed;
    body.vy = Math.sin(angle)*speed;
  }

  function applyMotionProfile(adjustVelocity){
    dotSize = motionSize(d,analysis);
    if(typeof dot.style.setProperty === "function") dot.style.setProperty("--dot-size",dotSize+"px");
    else dot.style["--dot-size"] = dotSize+"px";
    if(adjustVelocity) setVelocityMagnitude(motionSpeed(d,analysis));
    updateMetrics();
  }

  function keepInside(){
    updateMetrics();
    const margin = 2;
    const minX = body.radius+margin;
    const maxX = Math.max(minX,innerWidth-body.radius-margin);
    const minY = body.radius+margin;
    const maxY = Math.max(minY,innerHeight-body.radius-margin);
    if(body.x<minX){ body.x=minX; if(body.vx<0) body.vx=Math.abs(body.vx); }
    if(body.x>maxX){ body.x=maxX; if(body.vx>0) body.vx=-Math.abs(body.vx); }
    if(body.y<minY){ body.y=minY; if(body.vy<0) body.vy=Math.abs(body.vy); }
    if(body.y>maxY){ body.y=maxY; if(body.vy>0) body.vy=-Math.abs(body.vy); }
  }

  function render(){
    keepInside();
    position.x = clamp(body.x/innerWidth,0.015,0.985);
    position.y = clamp(body.y/innerHeight,0.025,0.975);
    el.style.left = body.x+"px";
    el.style.top = body.y+"px";
    dot.style.color = currentColor;
  }

  function flashCollision(color){
    currentColor = color;
    dot.style.color = currentColor;
    clearTimeout(colorTimer);
    colorTimer = setTimeout(()=>{
      currentColor = "#000";
      dot.style.color = currentColor;
    },220);
  }

  function showCollisionLabel(){
    el.classList.add("collision-visible");
    dot.classList.add("collision-visible");
    clearTimeout(collisionLabelTimer);
    collisionLabelTimer = setTimeout(()=>{
      el.classList.remove("collision-visible");
      dot.classList.remove("collision-visible");
    },3600);
  }

  function moveTo(clientX,clientY,offsetX,offsetY){
    const now = performance.now();
    const previous = previousDrag || {x:body.x,y:body.y,time:now};
    body.x = clamp(clientX-offsetX,body.radius+2,Math.max(body.radius+2,innerWidth-body.radius-2));
    body.y = clamp(clientY-offsetY,body.radius+2,Math.max(body.radius+2,innerHeight-body.radius-2));
    const seconds = Math.max((now-previous.time)/1000,0.001);
    body.vx = clamp((body.x-previous.x)/seconds,-220,220);
    body.vy = clamp((body.y-previous.y)/seconds,-220,220);
    dragMoved ||= Math.hypot(body.x-previous.x,body.y-previous.y)>4;
    previousDrag = {x:body.x,y:body.y,time:now};
    render();
  }

  function step(seconds){
    if(drag) return;
    body.x += body.vx*seconds;
    body.y += body.vy*seconds;
    keepInside();
  }

  function setStatus(value){
    status=value;
    el.classList.remove("pending","ready","error");
    el.classList.add(value);
  }

  dot.addEventListener("pointerdown",e=>{
    if(e.button!==0) return;
    e.preventDefault();
    drag = true;
    dragMoved = false;
    offsetX = e.clientX-body.x;
    offsetY = e.clientY-body.y;
    previousDrag = {x:body.x,y:body.y,time:performance.now()};
    el.classList.add("dragging");
    dot.setPointerCapture(e.pointerId);
  });

  dot.addEventListener("pointermove",e=>{
    if(!drag) return;
    moveTo(e.clientX,e.clientY,offsetX,offsetY);
  });

  dot.addEventListener("pointerenter",()=>el.classList.add("hovering"));
  dot.addEventListener("pointerleave",()=>el.classList.remove("hovering"));

  function finishDrag(e){
    if(!drag) return;
    drag = false;
    el.classList.remove("dragging");
    suppressClick = dragMoved;
    if(dot.hasPointerCapture(e.pointerId)){
      dot.releasePointerCapture(e.pointerId);
    }
    previousDrag = null;
    if(dragMoved) save();
  }

  dot.addEventListener("pointerup",finishDrag);
  dot.addEventListener("pointercancel",finishDrag);
  dot.addEventListener("click",e=>{
    if(suppressClick){
      e.preventDefault();
      suppressClick = false;
    }
  });

  applyMotionProfile(!hasInitialVelocity);
  render();
  setStatus(status);

  return {
    id:d.id,
    el,
    position,
    body,
    step,
    flashCollision,
    showCollisionLabel,
    setTitle:value=>{d.title=value;dot.title=value;dot.dataset.label=value;dot.setAttribute("aria-label",value);},
    setAnalysis:value=>{ analysis = value; applyMotionProfile(true); render(); },
    setStatus,
    render,
    get:()=>({
      id:d.id,
      title:d.title,
      link:d.link,
      analysis,
      status,
      nx:Number(position.x.toFixed(6)),
      ny:Number(position.y.toFixed(6))
    })
  };
}

function dotMetrics(){
  const style = getComputedStyle(document.documentElement);
  return {
    size:parseFloat(style.getPropertyValue("--dot-size")),
    hitSize:parseFloat(style.getPropertyValue("--hit-size"))
  };
}

function cursorPosition(){
  const margin = dotMetrics().hitSize/2+12;
  return {
    nx:clamp(lastPointer.x,margin,innerWidth-margin)/innerWidth,
    ny:clamp(lastPointer.y,margin,innerHeight-margin)/innerHeight
  };
}

function resolveCircleCollision(first,second){
  const a = first.body;
  const b = second.body;
  let dx = b.x-a.x;
  let dy = b.y-a.y;
  let distance = Math.hypot(dx,dy);
  const minimum = a.radius+b.radius;
  if(distance>=minimum) return;

  if(!distance){
    const angle = (first.id.length+second.id.length)%360*Math.PI/180;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }

  const nx = dx/distance;
  const ny = dy/distance;
  const correction = (minimum-distance+0.1)/2;
  a.x -= nx*correction;
  a.y -= ny*correction;
  b.x += nx*correction;
  b.y += ny*correction;

  const relativeVelocity = (b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
  if(relativeVelocity<0){
    a.vx += relativeVelocity*nx;
    a.vy += relativeVelocity*ny;
    b.vx -= relativeVelocity*nx;
    b.vy -= relativeVelocity*ny;
    const color = nextCollisionColor();
    first.flashCollision(color);
    second.flashCollision(color);
    first.showCollisionLabel();
    second.showCollisionLabel();
  }
}

let lastFrame = performance.now();

function physicsFrame(now){
  const seconds = Math.min(Math.max((now-lastFrame)/1000,0),0.035);
  lastFrame = now;
  for(const node of nodes) node.step(seconds);
  for(let first=0;first<nodes.length;first++){
    for(let second=first+1;second<nodes.length;second++){
      resolveCircleCollision(nodes[first],nodes[second]);
    }
  }
  for(const node of nodes) node.render();
  requestAnimationFrame(physicsFrame);
}

requestAnimationFrame(physicsFrame);

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
  if ((d.cards||[]).length > maxCards) await save();
}

window.addEventListener("resize",()=>{
  for(const node of nodes) node.render();
});

load().then(()=>{
  trackLoadedArticles();
  const articleURL = requestedArticleURL(location.search);
  if (articleURL) {
    pasteQueue = pasteQueue.then(()=>addArticle(articleURL,cursorPosition()));
  }
  for (const node of nodes.filter(n => !n.get().analysis)) {
    analyzeNode(node).catch(error => { node.setStatus("error"); analysisStatus.textContent = error.message; });
  }
}).catch(error => { analysisStatus.textContent = error.message; });
</script>

</body>
</html>`;
