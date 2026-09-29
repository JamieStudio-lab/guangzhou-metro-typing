#!/usr/bin/env node
/* Fetches the raw OpenStreetMap data behind the pixel ride map, for the whole network, into tools/.cache/map/ (Overpass API).
   Fetch + raw cache only: tools/pack-map.js turns the cache into the js/map/ tiles offline.
   Cells sit on a grid anchored at the origin (广州塔 station, metres east/north — see tools/lib/osm-geom.js), key "<km>k_<ix>_<iy>":
     routes     1 query  every line's route_master + route relations from js/geo.js, out geom (key "net")
     landmarks  1 query  named Line 3 landmarks around Line 3, out center tags — same query as the mockup's fetch-l3.js (key "l3")
     water green landuse roads rail   16 km cells over the station bbox of all lines + 8 km (LOD2 + context);
                water = water areas + natural=coastline + river/canal lines, roads = motorway…secondary(+links)
     minor      4 km cells within 5 km of any track: tertiary/residential/unclassified/living_street roads, stream/drain/ditch (LOD1)
     paths bldg 4 km cells within 2.5 km of any track: service/pedestrian/footway/path/cycleway/steps; buildings + bridges (LOD0)
   Tracks for the cell choice = station chords from js/geo.js ∪ each line's cached route geometry (fetched first).
   Usage: node tools/fetch-map.js [--dry-run] [--only=kind,…] [--limit=n] [--cells=key|kind.key,…]
     --dry-run  print the plan (cells per kind, queries, time/size estimates) and exit — no network
     --only     fetch these kinds only          --limit  fetch at most n new cells (smoke tests)
     --cells    fetch only these cells, e.g. --cells=l3,16k_0_0,4k_0_0 (a bare key matches every kind on that grid)
   One query at a time, 2 s apart, rotating through mirrors with exponential backoff; a cell that times out or runs out of
   memory is split into 4 (down to 1 km) and its quarters fetched instead. Resumable: cells already cached with the same query
   are skipped; Ctrl-C stops cleanly (every file is written as .tmp, then renamed).
   Env: OVERPASS_URLS=<url,…> replaces the mirror list, FETCH_MAP_CACHE=<dir> the cache dir (tests, private servers).
   Cache: <kind>.<key>.json = the Overpass JSON answer, minified. Ways come in the compact convert form
   {type:"way",id,tags,geometry:{type:"LineString",coordinates:[[lon,lat],…]}} (osm-geom's pg()/normalize() read it);
   relations are plain out geom (members with role + geometry). manifest.json lists every cell: kind, key, bbox (m + lat/lon),
   query, osm_base, elements, bytes, ms, mirror — or split:[child keys] for a cell fetched as quarters.
   Dev-only, Node ≥18, zero deps, needs network; the game never fetches at runtime. Data © OpenStreetMap contributors, ODbL 1.0. */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const G=require("./lib/osm-geom.js");
const REPO=path.join(__dirname,".."),DIR=process.env.FETCH_MAP_CACHE?path.resolve(process.env.FETCH_MAP_CACHE):path.join(__dirname,".cache","map"),MANIFEST=path.join(DIR,"manifest.json");

// kumi last: in Sep 2026 it served a months-old snapshot (private.coffee too). Answers older than STALE_DAYS are skipped (accepted only in the last round)
const MIRRORS=process.env.OVERPASS_URLS?process.env.OVERPASS_URLS.split(","):["https://overpass-api.de/api/interpreter","https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
const UA="guangzhou-metro-typing/fetch-map (https://github.com/JamieStudio-lab/guangzhou-metro-typing)";
const STALE_DAYS=14,PAUSE=2000,TIMEOUT=180,ROUNDS=6,MIN_CELL=1000;
const PAD=8000,L3_MARGIN=3000;   // m: station bbox pad for the 16 km cells; Line 3 station bbox margin for the landmarks query

// grid m, band = m from any track (none: the whole station bbox + PAD), way / relation filters, default estimates (s per query, MB per cell)
const AREA=[['["natural"="water"]','["waterway"="riverbank"]','["landuse"~"^(reservoir|basin)$"]'],
  ['["leisure"~"^(park|garden|recreation_ground|nature_reserve|golf_course|pitch|track|playground)$"]','["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|cemetery)$"]','["natural"~"^(wood|scrub|grassland|heath|wetland)$"]'],
  ['["landuse"~"^(residential|commercial|retail|industrial|construction|brownfield|greenfield|education|railway|farmland|orchard|farmyard|plant_nursery|greenhouse_horticulture|aquaculture|military|religious)$"]',
   '["amenity"~"^(university|college|school|kindergarten|hospital)$"]','["place"="square"]']];
const KINDS={
  routes:{one:"net",est:[20,3]},
  landmarks:{one:"l3",est:[10,.05]},
  water:{grid:16000,ways:[...AREA[0],'["natural"="coastline"]','["waterway"~"^(river|canal)$"]'],rels:AREA[0],est:[25,5]},
  green:{grid:16000,ways:AREA[1],rels:AREA[1],est:[20,4]},
  landuse:{grid:16000,ways:[...AREA[2],'["highway"="pedestrian"]["area"="yes"]'],rels:[...AREA[2],'["highway"="pedestrian"]["type"="multipolygon"]'],est:[25,6]},
  roads:{grid:16000,ways:['["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"]'],est:[20,5]},
  rail:{grid:16000,ways:['["railway"~"^(rail|light_rail|narrow_gauge|tram|subway)$"]'],est:[8,1]},
  minor:{grid:4000,band:5000,ways:['["highway"~"^(tertiary|tertiary_link|residential|unclassified|living_street)$"]','["waterway"~"^(stream|drain|ditch)$"]'],est:[8,1.5]},
  paths:{grid:4000,band:2500,ways:['["highway"~"^(service|pedestrian|footway|path|cycleway|steps)$"]'],est:[8,1.5]},
  bldg:{grid:4000,band:2500,ways:['["building"]','["man_made"="bridge"]'],rels:['["building"]["type"="multipolygon"]','["man_made"="bridge"]'],est:[12,4]}};
const ORDER=Object.keys(KINDS);
const cellQuery=(k,B)=>{const K=KINDS[k];
  return "("+K.ways.map(f=>`way${f}(${B});`).join("")+");convert way ::=::,::id=id(),::geom=geom();out geom;"
    +(K.rels?"("+K.rels.map(f=>`rel${f}(${B});`).join("")+");out geom qt;":"")};

// --- arguments ---
const args={};
for(const a of process.argv.slice(2)){const m=a.match(/^--(dry-run|only|limit|cells)(?:=(.+))?$/);if(!m){console.error("unknown argument "+a+"\nusage: node tools/fetch-map.js [--dry-run] [--only=kind,…] [--limit=n] [--cells=key|kind.key,…]");process.exit(2)}args[m[1]]=m[2]===undefined?true:m[2]}
const DRY=!!args["dry-run"],ONLY=args.only?String(args.only).split(","):null,LIMIT=args.limit?+args.limit:1/0,CELLS=args.cells?String(args.cells).split(","):null;
if(ONLY)for(const k of ONLY)if(!KINDS[k]){console.error(`unknown kind "${k}" (kinds: ${ORDER.join(", ")})`);process.exit(2)}
if(!(LIMIT>=0)){console.error("--limit needs a number");process.exit(2)}

// --- cache + manifest ---
fs.mkdirSync(DIR,{recursive:true});
for(const f of fs.readdirSync(DIR))if(f.endsWith(".tmp"))fs.unlinkSync(path.join(DIR,f)); // leftovers of a killed run
const M=fs.existsSync(MANIFEST)?JSON.parse(fs.readFileSync(MANIFEST,"utf8")):{};M.cells=M.cells||{};
const writeAtomic=(f,txt)=>{fs.writeFileSync(f+".tmp",txt);fs.renameSync(f+".tmp",f)};
function saveManifest(){
  const cells={};for(const k of Object.keys(M.cells).sort())cells[k]=M.cells[k];
  writeAtomic(MANIFEST,JSON.stringify({tool:"tools/fetch-map.js",source:"Map data © OpenStreetMap contributors, ODbL 1.0",
    origin:G.ORIGIN,mPerDegLat:G.MLAT,mPerDegLon:G.MLON,grid:"cell key <km>k_<ix>_<iy> = metres [ix*size,iy*size]-[(ix+1)*size,(iy+1)*size] east/north of origin",
    kinds:Object.fromEntries(ORDER.map(k=>[k,KINDS[k].one?{key:KINDS[k].one}:{grid:KINDS[k].grid,band:KINDS[k].band||null,ways:KINDS[k].ways,rels:KINDS[k].rels||[]}])),
    cells},null,1));
}
const fileOf=(kind,key)=>`${kind}.${key}.json`;
function cached(job){ // → "cached" | "stale" (query changed) | "todo"
  const id=job.kind+"."+job.key,e=M.cells[id],f=path.join(DIR,fileOf(job.kind,job.key));
  if(e&&e.split)return "split";
  if(!fs.existsSync(f))return "todo";
  if(!e){try{const j=JSON.parse(fs.readFileSync(f,"utf8"));M.cells[id]=entry(job,j,fs.statSync(f).size,{recovered:true});return "cached"}catch(e){return "todo"}} // file landed, manifest didn't
  return e.query===job.q?"cached":"stale";
}
const entry=(job,j,bytes,x)=>Object.assign({kind:job.kind,key:job.key},job.R?{size:job.size,bbox:job.R,bboxLL:job.B.split(",").map(Number)}:{},
  {file:fileOf(job.kind,job.key),query:job.q,osm_base:j.osm3s&&j.osm3s.timestamp_osm_base||null,elements:j.elements.length,bytes},x||{});

// --- network: stations + tracks from js/geo.js (+ the cached route geometry) ---
const GEO=vm.runInNewContext(fs.readFileSync(path.join(REPO,"js","geo.js"),"utf8")+"\n;GEO",{},{filename:"js/geo.js"});
const ST=GEO.lines.flatMap(l=>l.stations.map(s=>G.P(s.lat,s.lon))),SB=G.bboxOf(ST);
const L3=GEO.lines.find(l=>l.ref==="3").stations.map(s=>G.P(s.lat,s.lon)),L3B=G.bboxOf(L3);
const L3BOX=[L3B[0]-L3_MARGIN,L3B[1]-L3_MARGIN,L3B[2]+L3_MARGIN,L3B[3]+L3_MARGIN].map(Math.round);
function trackSegs(routes){ // [[a,b],…] metres; chords between stations (+ loop closure) and the geo.js route of each line
  const segs=[];let fromRoutes=0;
  for(const l of GEO.lines){
    const S=l.stations.map(s=>G.P(s.lat,s.lon));if(l.loop)S.push(S[0]);
    for(let i=1;i<S.length;i++)segs.push([S[i-1],S[i]]);
    const rel=routes&&routes.elements.find(e=>e.type==="relation"&&e.id===l.route);
    if(rel)for(const m of rel.members)if(m.type==="way"&&m.geometry&&!/^(platform|stop)/.test(m.role||"")){
      const p=G.rdp(G.pg(m.geometry),25);for(let i=1;i<p.length;i++){segs.push([p[i-1],p[i]]);fromRoutes++}}
  }
  return {segs,fromRoutes};
}
const nearTrack=(segs,R,band)=>segs.some(([a,b])=>Math.min(a[0],b[0])-band<=R[2]&&Math.max(a[0],b[0])+band>=R[0]&&Math.min(a[1],b[1])-band<=R[3]&&Math.max(a[1],b[1])+band>=R[1]&&G.rectSegDist(R,a,b)<=band);
function bandCells(segs,size,band){ // → [[ix,iy],…] cells within band m of any segment
  const out=new Map();
  for(const [a,b] of segs){
    const x0=Math.floor((Math.min(a[0],b[0])-band)/size),x1=Math.floor((Math.max(a[0],b[0])+band)/size),y0=Math.floor((Math.min(a[1],b[1])-band)/size),y1=Math.floor((Math.max(a[1],b[1])+band)/size);
    for(let ix=x0;ix<=x1;ix++)for(let iy=y0;iy<=y1;iy++){const k=ix+"_"+iy;if(!out.has(k)&&G.rectSegDist([ix*size,iy*size,(ix+1)*size,(iy+1)*size],a,b)<=band)out.set(k,[ix,iy])}
  }
  return [...out.values()];
}
const cellJob=(kind,size,ix,iy)=>{const R=[ix*size,iy*size,(ix+1)*size,(iy+1)*size],B=G.llBox(R,6).join(",");
  return {kind,key:`${size/1000}k_${ix}_${iy}`,size,ix,iy,R,B,q:cellQuery(kind,B)}};
const ROUTE_IDS=[...new Set(GEO.lines.flatMap(l=>[l.relation,l.route]))];
const oneJob=kind=>kind==="routes"?{kind,key:KINDS.routes.one,q:`rel(id:${ROUTE_IDS.join(",")});(._;rel(r););out geom;`}
  :{kind,key:KINDS.landmarks.one,R:L3BOX,B:G.llBox(L3BOX,6).join(","),q:G.landmarkQuery(G.llBox(L3BOX).join(","))};

// --- the plan: every (kind, cell) job, splits expanded, ordered region by region outwards from the origin ---
function plan(routes){
  const {segs,fromRoutes}=trackSegs(routes),jobs=[oneJob("routes"),oneJob("landmarks")];
  const r=v=>Math.floor(v/16000);
  for(const kind of ORDER){const K=KINDS[kind];if(K.one)continue;
    const cells=K.band?bandCells(segs,K.grid,K.band)
      :(()=>{const o=[];for(let ix=Math.floor((SB[0]-PAD)/K.grid);ix<=Math.floor((SB[2]+PAD)/K.grid);ix++)for(let iy=Math.floor((SB[1]-PAD)/K.grid);iy<=Math.floor((SB[3]+PAD)/K.grid);iy++)o.push([ix,iy]);return o})();
    for(const [ix,iy] of cells)jobs.push(cellJob(kind,K.grid,ix,iy));
  }
  // sort key: enclosing 16 km region (nearest the origin first), then 16 km kinds before 4 km ones, kind order, cell distance
  const sk=j=>KINDS[j.kind].one?[-1,0,0,0,ORDER.indexOf(j.kind),0]
    :[Math.hypot(r(j.R[0])*16000+8000,r(j.R[1])*16000+8000),r(j.R[0]),r(j.R[1]),-KINDS[j.kind].grid,ORDER.indexOf(j.kind),Math.hypot((j.R[0]+j.R[2])/2,(j.R[1]+j.R[3])/2)];
  jobs.sort((a,b)=>{const p=sk(a),q=sk(b);for(let i=0;i<p.length;i++)if(p[i]!==q[i])return p[i]-q[i];return a.key<b.key?-1:1});
  return {jobs:jobs.flatMap(j=>expand(j,segs)),segs,fromRoutes};
}
function children(j,segs){const K=KINDS[j.kind],s=j.size/2,out=[];
  for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]]){const c=cellJob(j.kind,s,j.ix*2+dx,j.iy*2+dy);c.parent=j.key;c.root=j.root||j.key;if(!K.band||nearTrack(segs,c.R,K.band))out.push(c)}
  return out}
function expand(j,segs){const e=M.cells[j.kind+"."+j.key];return e&&e.split?children(j,segs).flatMap(c=>expand(c,segs)):[j]}
const wanted=j=>(!ONLY||ONLY.includes(j.kind))&&(!CELLS||CELLS.some(c=>[j.key,j.root].includes(c)||[j.key,j.root].some(k=>k&&c===j.kind+"."+k)));

function printPlan(P,routesCached){
  const by={};let tq=0,ts=0,tb=0;
  for(const j of P.jobs){const b=by[j.kind]=by[j.kind]||{cells:0,cached:0,stale:0,todo:0,sel:0};b.cells++;const s=cached(j);b[s==="cached"?"cached":s==="stale"?"stale":"todo"]++;if(s!=="cached"&&wanted(j))b.sel++}
  const meas=k=>{const v=Object.values(M.cells).filter(e=>e.kind===k&&e.ms);return v.length?[v.reduce((s,e)=>s+e.ms,0)/v.length/1000,v.reduce((s,e)=>s+e.bytes,0)/v.length/1e6,v.length]:null};
  const km=v=>(v/1000).toFixed(0);
  console.log(`Plan — origin 广州塔 ${G.ORIGIN.lat},${G.ORIGIN.lon}; stations of ${GEO.lines.length} lines x ${km(SB[0])}…${km(SB[2])} km, y ${km(SB[1])}…${km(SB[3])} km (+${PAD/1000} km pad for 16 km cells)`);
  console.log(`  tracks: ${P.segs.length} segments (${P.fromRoutes} from OSM routes${routesCached?"":" — routes not cached yet: station chords only, a real run adds the route geometry"})`);
  console.log("  kind        grid   band    cells  cached  stale  to fetch   est s/query  est MB/cell");
  for(const k of ORDER){const b=by[k]||{cells:0,cached:0,stale:0,todo:0,sel:0},K=KINDS[k],m=meas(k),e=m||K.est;
    tq+=b.sel;ts+=b.sel*(e[0]+PAUSE/1000);tb+=b.sel*e[1];
    console.log(`  ${k.padEnd(10)} ${(K.one?"—":K.grid/1000+" km").padStart(5)} ${(K.band?K.band/1000+" km":K.one?"—":"bbox").padStart(7)} ${String(b.cells).padStart(7)} ${String(b.cached).padStart(7)} ${String(b.stale).padStart(6)} ${String(b.sel).padStart(9)}   ${e[0].toFixed(1).padStart(8)}${m?" (n="+m[2]+")":"    (guess)"} ${e[1].toFixed(2).padStart(8)}`)}
  const all=Object.values(M.cells).filter(e=>e.bytes).reduce((s,e)=>s+e.bytes,0);
  const dur=s=>s<5400?Math.round(s/60)+" min":(s/3600).toFixed(1)+" h",sel=[ONLY&&"--only",CELLS&&"--cells"].filter(Boolean).join(" ");
  console.log(`  → ${tq} queries to run${sel?" (after "+sel+")":""}${LIMIT<1/0?", at most "+LIMIT+" this run (--limit)":""}: est ${dur(ts)} + backoff, ${tb.toFixed(0)} MB · cache now ${(all/1e6).toFixed(1)} MB`);
}

// --- Overpass client: one query at a time, PAUSE apart, mirrors in turn, exponential backoff between rounds ---
const stopCtl=new AbortController(),STOP=new Error("stopped");let lastLive=0;
const sleep=ms=>new Promise(r=>{if(stopCtl.signal.aborted)return r();const t=setTimeout(r,ms);stopCtl.signal.addEventListener("abort",()=>{clearTimeout(t);r()},{once:true})});
async function post(url,body,ms){
  const c=new AbortController(),tm=setTimeout(()=>c.abort(),ms),on=()=>c.abort();stopCtl.signal.addEventListener("abort",on);
  try{const res=await fetch(url,{method:"POST",body,signal:c.signal,headers:{"User-Agent":UA,"Content-Type":"application/x-www-form-urlencoded"}});return {status:res.status,txt:await res.text()}}
  catch(e){if(stopCtl.signal.aborted)throw STOP;if(c.signal.aborted)return {timeout:true};throw e}
  finally{clearTimeout(tm);stopCtl.signal.removeEventListener("abort",on)}
}
const htmlErr=t=>((t.replace(/\s+/g," ").match(/Error<\/strong>:\s*([^<]{0,160})/)||[])[1]||t.slice(0,80)).trim();
const staleUrls=new Set(); // mirrors that served an old snapshot this run: skipped until the last round (no full answer fetched only to be dropped)
async function overpass(job,canSplit){ // → {j,txt,ms,mirror} | {split:why} | {fail:why}
  const body="data="+encodeURIComponent(`[out:json][timeout:${TIMEOUT}];`+job.q),label=`${job.kind} ${job.key}`,bad=new Set();let why="",noisy=false;
  process.stderr.write(`${label}…`);
  for(let round=1;round<=ROUNDS;round++){
    for(const url of MIRRORS){
      if(stopCtl.signal.aborted)throw STOP;
      if(round<ROUNDS&&staleUrls.has(url)&&staleUrls.size<MIRRORS.length)continue;
      const wait=lastLive+PAUSE-Date.now();if(wait>0)await sleep(wait);
      const host=new URL(url).host,t=Date.now();let big=false;
      try{
        const r=await post(url,body,(TIMEOUT+45)*1000);lastLive=Date.now();const s=(lastLive-t)/1000;
        if(r.timeout){why=`no answer in ${s.toFixed(0)} s`;big=true}
        else if(r.status===400){why="HTTP 400 "+htmlErr(r.txt);bad.add(host); // two servers rejecting the query = our bug: stop the run
          if(bad.size>1)throw Object.assign(new Error(`Overpass 400 (bad query): ${htmlErr(r.txt)}\n  ${job.q}`),{fatal:true})}
        else if(r.status===429)why="HTTP 429 rate limited";
        else if(r.status!==200){why=`HTTP ${r.status} ${htmlErr(r.txt)}`;big=r.status>=500&&s>=120}
        else{
          let j;try{j=JSON.parse(r.txt)}catch(e){j=null}
          const base=j&&j.osm3s&&j.osm3s.timestamp_osm_base||"",rem=j&&j.remark||"";
          if(!j||!Array.isArray(j.elements))why="unparsable answer ("+r.txt.length+" B)";
          else if(/timed out|out of memory|maxsize|too large/i.test(rem)){why="remark: "+rem.slice(0,90);big=true}
          else if(/error/i.test(rem))why="remark: "+rem.slice(0,90);
          else if(job.kind!=="routes"&&job.kind!=="landmarks"&&j.elements.some(e=>e.type==="way"&&!e.geometry))why="ways without geometry (convert unsupported?)";
          else if(round<ROUNDS&&!(Date.now()-Date.parse(base)<=STALE_DAYS*864e5)){why="stale snapshot "+base.slice(0,10)+" (skipped from now on)";staleUrls.add(url)}
          else{
            const txt=JSON.stringify(j);
            process.stderr.write(`${noisy?"\n  "+label+":":""} ${j.elements.length} el, ${(Buffer.byteLength(txt)/1e6).toFixed(2)} MB, ${s.toFixed(1)} s, OSM ${base.slice(0,16)} (${host})\n`);
            return {j,txt,ms:lastLive-t,mirror:host};
          }
        }
      }catch(e){if(e===STOP||e.fatal)throw e;lastLive=Date.now();why=e.cause&&e.cause.code||e.message}
      process.stderr.write(`\n  ${host}: ${why}`);noisy=true;
      if(big&&canSplit){process.stderr.write(" → splitting into 4\n");return {split:why}}
    }
    if(round<ROUNDS){const b=Math.min(300,10*2**(round-1));process.stderr.write(`\n  round ${round} failed, backing off ${b} s`);await sleep(b*1000)}
  }
  process.stderr.write("\n");
  return {fail:why};
}

// --- run ---
process.on("SIGINT",()=>{if(stopCtl.signal.aborted)process.exit(130);process.stderr.write("\nCtrl-C: stopping cleanly (press again to force)…\n");stopCtl.abort()});
(async()=>{
  const t0=Date.now(),routesFile=path.join(DIR,fileOf("routes","net")),stat={n:0,bytes:0,el:0,fail:[]};
  const readRoutes=()=>cached(oneJob("routes"))==="cached"?JSON.parse(fs.readFileSync(routesFile,"utf8")):null;
  if(DRY){printPlan(plan(readRoutes()),!!readRoutes());return}
  const fetchJob=async(job,canSplit)=>{
    const r=await overpass(job,canSplit);if(r.split||r.fail)return r;
    writeAtomic(path.join(DIR,fileOf(job.kind,job.key)),r.txt);
    M.cells[job.kind+"."+job.key]=entry(job,r.j,Buffer.byteLength(r.txt),Object.assign({ms:r.ms,mirror:r.mirror,fetched:new Date().toISOString().slice(0,19)+"Z"},job.parent?{parent:job.parent}:{}));
    saveManifest();stat.n++;stat.bytes+=Buffer.byteLength(r.txt);stat.el+=r.j.elements.length;return r};
  try{
    if(!readRoutes()){const r=await fetchJob(oneJob("routes"),false);if(r.fail)throw new Error("routes query failed: "+r.fail)} // needed for the plan
    const P=plan(readRoutes());printPlan(P,true);saveManifest();
    const queue=P.jobs.filter(j=>wanted(j)&&cached(j)!=="cached");let n=0;
    while(queue.length&&n<LIMIT&&!stopCtl.signal.aborted){
      const job=queue.shift(),canSplit=!!job.size&&job.size/2>=MIN_CELL,r=await fetchJob(job,canSplit);
      if(r.split){const ch=children(job,P.segs);M.cells[job.kind+"."+job.key]={kind:job.kind,key:job.key,size:job.size,bbox:job.R,split:ch.map(c=>c.key),reason:r.split};saveManifest();queue.unshift(...ch);continue}
      n++;if(r.fail)stat.fail.push(`${job.kind}.${job.key}: ${r.fail}`);
    }
    if(queue.length&&!stopCtl.signal.aborted)console.log(`--limit ${LIMIT} reached: ${queue.length} cells left for the next run`);
  }catch(e){if(e!==STOP)throw e}
  saveManifest();
  const all=Object.values(M.cells).filter(e=>e.bytes),mb=v=>(v/1e6).toFixed(1)+" MB";
  console.log(`${stopCtl.signal.aborted?"stopped":"done"}: ${stat.n} new cells, ${mb(stat.bytes)}, ${stat.el} elements in ${((Date.now()-t0)/60000).toFixed(1)} min · cache ${all.length} files, ${mb(all.reduce((s,e)=>s+e.bytes,0))}`);
  if(stat.fail.length){console.log(`FAILED (re-run to retry): ${stat.fail.length}\n  ${stat.fail.join("\n  ")}`);process.exitCode=1}
  if(stopCtl.signal.aborted)process.exitCode=130;
})().catch(e=>{console.error("\n"+(e.stack||e));try{saveManifest()}catch(_){}process.exit(1)});
