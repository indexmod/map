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
      return Response.json(raw ? JSON.parse(raw) : { cards: [] });
    }

    // =====================
    // SAVE
    // =====================
    if (url.pathname === "/api/save") {
      const data = await req.json();
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
  --dot-size:clamp(12px,1.15vw,18px);
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
  width:var(--dot-size);
  height:var(--dot-size);
  border-radius:50%;
  border:1px solid #111;
  background:#fff;
  cursor:grab;
  touch-action:none;
  box-shadow:0 0 0 1px #fff,0 0 12px currentColor;
  transform:translate(-50%,-50%);
}

.node.dragging{
  z-index:10;
}

.node.dragging .dot{
  cursor:grabbing;
  transform:scale(1.28);
}

.title{
  min-width:0;
  overflow:hidden;
  color:#000;
  text-decoration:none;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--label-size);
  line-height:1.45;
  text-shadow:0 1px 0 #fff,1px 0 0 #fff,-1px 0 0 #fff;
}

.label{
  position:absolute;
  display:flex;
  align-items:center;
  gap:8px;
  width:max-content;
  max-width:min(58vw,480px);
}

.label a{
  display:block;
  width:max-content;
  max-width:calc(min(58vw,480px) - 28px);
  white-space:nowrap;
}

.side-right .label{
  left:calc(var(--dot-size)/2 + 10px);
  top:0;
  transform:translateY(-50%);
}

.side-left .label{
  right:calc(var(--dot-size)/2 + 10px);
  top:0;
  flex-direction:row-reverse;
  transform:translateY(-50%);
}

.side-top .label{
  left:0;
  bottom:calc(var(--dot-size)/2 + 10px);
  transform:translateX(-50%);
}

.side-bottom .label{
  left:0;
  top:calc(var(--dot-size)/2 + 10px);
  transform:translateX(-50%);
}

.del{
  flex:0 0 auto;
  color:#000;
  cursor:pointer;
  opacity:.35;
  font-size:clamp(12px,1.15vw,16px);
  line-height:1;
  padding:8px 2px;
}

.del:hover,
.del:focus-visible{
  opacity:1;
}

@media (max-width:600px){
  :root{
    --dot-size:34px;
    --label-size:clamp(17px,4.8vw,20px);
  }

  .dot{
    box-shadow:0 0 0 6px rgba(0,0,0,.07),0 0 12px currentColor;
  }

  .label{
    align-items:flex-start;
    gap:7px;
    max-width:min(72vw,320px);
  }

  .label a{
    max-width:calc(min(72vw,320px) - 40px);
    white-space:normal;
    line-height:1.3;
  }

  .side-left .label{
    align-items:flex-start;
  }

  .del{
    padding:3px 5px;
    font-size:16px;
  }
}
</style>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='black'/%3E%3Ccircle cx='11' cy='13' r='2' fill='white'/%3E%3Ccircle cx='21' cy='13' r='2' fill='white'/%3E%3Crect x='12' y='20' width='8' height='2' rx='1' fill='white'/%3E%3C/svg%3E">
</head>

<body>
<img class="sphere-logo" src="https://indexmod.press/logo.svg" alt="Indexmod" aria-hidden="true">
<div id="workspace"></div>

<script>
const ws = document.getElementById("workspace");
let nodes = [];
let busy = false;
let savePromise = Promise.resolve();

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
document.addEventListener("paste", async (e) => {
  const text = e.clipboardData.getData("text");

  if (!text.startsWith("http")) return;
  if (busy) return;

  busy = true;

  try {
    const r = await fetch("/api/title?url=" + encodeURIComponent(text));
    const meta = await r.json();

    const node = createNode({
      id: crypto.randomUUID(),
      title: meta.title || "Untitled",
      link: text,
      nx: 0.5,
      ny: 0.5
    });

    ws.appendChild(node.el);
    nodes.push(node);
    scheduleLabelLayout();
    save();

  } finally {
    busy = false;
  }
});

// =====================
// NODE
// =====================
function createNode(d){
  const el = document.createElement("div");
  el.className = "node";

  const dot = document.createElement("div");
  dot.className = "dot";

  const a = document.createElement("a");
  a.className = "title";
  a.href = d.link;
  a.target = "_blank";
  a.textContent = d.title;

  const del = document.createElement("span");
  del.className = "del";
  del.textContent = "✖";

  const label = document.createElement("div");
  label.className = "label";
  label.appendChild(a);
  label.appendChild(del);

  el.appendChild(dot);
  el.appendChild(label);

  const position = normalizedPosition(d);

  function render(){
    el.style.left = (position.x*innerWidth)+"px";
    el.style.top = (position.y*innerHeight)+"px";

    const color = colorAt(position.x,position.y);
    dot.style.backgroundColor = color;
    dot.style.color = color;
  }

  function moveTo(clientX,clientY,offsetX,offsetY){
    position.x = clamp((clientX-offsetX)/innerWidth,0.015,0.985);
    position.y = clamp((clientY-offsetY)/innerHeight,0.025,0.975);
    render();
  }

  function setSide(side){
    el.classList.remove("side-right","side-left","side-top","side-bottom");
    el.classList.add("side-"+side);
  }

  setSide(position.x>0.62 ? "left" : "right");

  del.onclick = () => {
    el.remove();
    nodes = nodes.filter(n => n.id !== d.id);
    save();
  };

  let drag = false;
  let offsetX = 0;
  let offsetY = 0;

  dot.addEventListener("pointerdown",e=>{
    e.preventDefault();
    drag = true;
    offsetX = e.clientX-position.x*innerWidth;
    offsetY = e.clientY-position.y*innerHeight;
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
    render,
    setSide,
    get:()=>({
      id:d.id,
      title:d.title,
      link:d.link,
      nx:Number(position.x.toFixed(6)),
      ny:Number(position.y.toFixed(6))
    })
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
  if(!matchMedia("(max-width: 600px)").matches){
    for(const node of nodes) node.setSide(node.position.x>0.62 ? "left" : "right");
    return;
  }

  const placedLabels = [];
  const dots = nodes.map(node=>({node,rect:node.el.querySelector(".dot").getBoundingClientRect()}));
  const ordered = [...nodes].sort((a,b)=>a.position.y-b.position.y || a.position.x-b.position.x);
  const sides = ["right","left","bottom","top"];
  const gapPenalty = 42;

  for(const node of ordered){
    let bestSide = sides[0];
    let bestScore = Infinity;

    for(let index=0;index<sides.length;index++){
      const side = sides[index];
      node.setSide(side);
      const rect = node.label.getBoundingClientRect();
      const outsideWidth = Math.max(0,-rect.left)+Math.max(0,rect.right-innerWidth);
      const outsideHeight = Math.max(0,-rect.top)+Math.max(0,rect.bottom-innerHeight);
      let score = (outsideWidth*rect.height + outsideHeight*rect.width)*30 + index*gapPenalty;

      for(const previous of placedLabels){
        score += overlapArea(rect,previous)*40;
      }

      for(const item of dots){
        if(item.node===node) continue;
        score += overlapArea(rect,item.rect)*60;
      }

      if(score<bestScore){
        bestScore=score;
        bestSide=side;
      }
    }

    node.setSide(bestSide);
    placedLabels.push(node.label.getBoundingClientRect());
  }
}

// =====================
// SAVE / LOAD
// =====================
async function save(){
  const body = JSON.stringify({ cards:nodes.map(n=>n.get()) });

  savePromise = savePromise
    .catch(()=>{})
    .then(()=>fetch("/api/save",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body
    }));

  return savePromise;
}

async function load(){
  const r = await fetch("/api/load");
  const d = await r.json();

  for(const i of (d.cards||[])){
    const n = createNode(i);
    ws.appendChild(n.el);
    nodes.push(n);
  }
}

window.addEventListener("resize",()=>{
  for(const node of nodes) node.render();
  scheduleLabelLayout();
});

load().then(scheduleLabelLayout);
</script>

</body>
</html>`;
