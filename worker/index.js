import prompt from '../prompts/map-semantic.md';
import { analyze, hash } from '../src/analyze.js';
import { fetchArticle, extractPastedArticleLinks, requestedArticleURL } from '../src/article.js';
import { huggingFace } from '../src/huggingface.js';
import { cloudflareAI } from '../src/cloudflare.js';
const MAP_GENERATION = 2;
const MAX_CARDS = 10;
const GA_MEASUREMENT_ID = 'G-RERFC3F88M';

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
}

.node.dragging{
  z-index:10;
}

.node.dragging .dot{
  cursor:grabbing;
}

/* Keep the hit target generous while the visible shape stays a simple flat circle. */
.node.error .dot::before{outline:3px solid #ff3b30}

/* The article title is exposed through the link's aria-label and tooltip. */
.title,.label,.calculation-state{display:none}

/* Remove the old 3D layout rules from this client. */
.journey-trails,.orbit-layer,.orbit-ring{display:none}

/* Legacy selectors intentionally stay inert so old saved cards render as circles. */
.node{
  width:0;
  height:0;
  user-select:none;
  -webkit-user-select:none;
}

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

const nodeColors = ["#111827","#ef4444","#2563eb","#f59e0b","#10b981","#8b5cf6","#ec4899"];

function colorFor(id){
  let hash = 0;
  for(const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return nodeColors[Math.abs(hash) % nodeColors.length];
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
  dot.setAttribute("aria-label",d.title || d.link);
  dot.addEventListener("click",()=>trackMapEvent("map_article_opened",{
    article_url:d.link,
    article_title:d.title
  }));
  el.appendChild(dot);

  const position = normalizedPosition(d);
  let analysis = d.analysis || null;
  let status = d.status || (analysis ? "ready" : "pending");
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

  function updateMetrics(){
    const {size,hitSize} = dotMetrics();
    body.radius = size/2;
    body.hitRadius = hitSize/2;
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
    dot.style.color = colorFor(d.id);
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

  render();
  setStatus(status);

  return {
    id:d.id,
    el,
    position,
    body,
    step,
    setTitle:value=>{d.title=value;dot.title=value;dot.setAttribute("aria-label",value);},
    setAnalysis:value=>{ analysis = value; },
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
  const separation = 18;
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
    // The title starts three pixels beyond the visible circle edge, not from
    // the centre or from the larger invisible pointer hit area.
    const radius = size/2 + 3;
    const ownDot = {left:x-radius,right:x+radius,top:y-radius,bottom:y+radius};
    const dotObstacles = [...dots,ownDot];
    const obstacles = [...dotObstacles,...placedLabels];
    const xs = [x+radius,x-radius-width,margin,innerWidth-margin-width];
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

    candidateSearch: for(const left of xPositions){
      for(const top of yPositions){
        const rect = {left,top,right:left+width,bottom:top+height};
        if (dotObstacles.some(obstacle=>overlapArea(rect,obstacle)>0)) continue;
        const overlap = obstacles.reduce((sum,obstacle)=>sum+overlapArea(rect,obstacle),0);
        const distance = Math.hypot(clamp(x,rect.left,rect.right)-x,clamp(y,rect.top,rect.bottom)-y);
        const alignment = Math.abs(top+height/2-y)*0.1+(left<x ? 0.5 : 0);
        const score = overlap*10000+distance+alignment;
        if(score<bestScore){
          bestScore=score;
          bestRect=rect;
        }
        if(overlap===0) break candidateSearch;
      }
    }

    // Never fall back to a rectangle over a point. Search the full viewport
    // when crowded local candidates have no safe position.
    if(!bestRect){
      for(let top=margin;top<=innerHeight-margin-height;top+=16){
        for(let left=margin;left<=innerWidth-margin-width;left+=16){
          const rect={left,top,right:left+width,bottom:top+height};
          if(dotObstacles.some(obstacle=>overlapArea(rect,obstacle)>0)) continue;
          const score=placedLabels.reduce((sum,obstacle)=>sum+overlapArea(rect,obstacle),0)*10000+Math.hypot(left-x,top-y);
          if(score<bestScore){bestScore=score;bestRect=rect;}
        }
      }
    }
    if(!bestRect){node.label.style.visibility="hidden";continue;}
    node.label.style.visibility="visible";
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
  if ((d.cards||[]).length > maxCards) await save();
  nodes.forEach((node,index)=>{
    if(node.get().analysis) node.setOrbit(orbitalParameters(index,nodes.length,{width:innerWidth,height:innerHeight,hitSize:dotMetrics().hitSize}));
  });
  rebuildOrbitRings();
  if (nodes.some(node=>node.get().orbit)) startOrbitAnimation();
}

window.addEventListener("resize",()=>{
  nodes.forEach((node,index)=>{
    if(node.get().orbit) node.setOrbit(orbitalParameters(index,nodes.length,{width:innerWidth,height:innerHeight,hitSize:dotMetrics().hitSize}));
  });
  rebuildOrbitRings();
  if(!nodes.some(node=>node.get().orbit)) separateNodes();
  scheduleLabelLayout();
});

load().then(()=>{
  separateNodes();
  scheduleLabelLayout();
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
