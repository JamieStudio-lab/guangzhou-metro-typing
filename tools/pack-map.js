#!/usr/bin/env node
/* Packs the pixel ride's map: the raw OSM cache of tools/fetch-map.js (tools/.cache/map/) → js/map/lines.js + the tiles
   js/map/t0|t1|t2/<tx>_<ty>.js. Format, LODs, layers and the runtime: js/map/map.js — this tool loads that file (vm) for the tile
   lists and the decoder, so the packer and the game agree by construction; every tile is decoded again and compared before it is kept.
   Usage: node tools/pack-map.js [--from-cache] [--cache=DIR] [--out=js/map] [--lines=l3,…] [--report]
          node tools/pack-map.js --from-l3=mockups/pixel-ride/data/l3.js --out=mockups/px-dev/tiles-l3
     --from-cache  (default) read tools/.cache/map/manifest.json: planned + completed cells only; missing cells are reported as gaps
     --cache       another fetch cache (= env FETCH_MAP_CACHE), e.g. a frozen copy while tools/fetch-map.js still writes the real one
     --lines       pack only the tiles of these lines (lines.js always has all of them); other tile files are left alone
     --report      per-layer and per-line detail
     --from-l3     test front end: tile an already processed Line 3 extract (the mockup's data/l3.js) as it is — LOD0 at its full detail,
                   LOD1/LOD2 derived with the coarser rules — for the tile-vs-l3 parity check of the renderer
   Pipeline (cache): tracks from the route relations (ways chained, gaps < 150 m bridged, stations snapped in order ≤ 60 m, clipped to the
   playable end stations + up to 300 m where OSM goes on; else a Catmull–Rom curve through the stations) → tile sets (MAP.tiles:
   2 km / 4 km bands; LOD2 over the stations' bbox + 8 km) → elements deduped by OSM id → areas/lines simplified once, then clipped
   per tile (pieces of roads / landuse / buildings split by the grid share a sid); buildings (heights on the unclipped footprint) and
   traffic chains whole; the sea assembled from natural=coastline per tile, only where the tile's water cells are all cached — a piece
   ending inside a tile, or a chain broken among cached cells (and the gap it leaves), leaves the tile land; a tile no coastline
   crosses is sea only when the nearest coastline says so from ≤ ¾ tile + 2 km, not from a loose chain end, and no uncached water cell
   is nearer (never whole tiles of sea at a cache edge); river lanes network-wide over the LOD1 corridor → c45 tiles, Morton-ordered
   per layer. Output is byte-stable (no timestamps; the same cache gives the same bytes); stale tile files are deleted. Needs ~200 MB
   heap per 45 MB of cache. Prints a size report and exits 1 when a budget (tools/lib/osm-geom.js BUDGET) is exceeded: all tiles +
   lines.js ≤ 16 MB raw; a line's cold ride ≤ 1.5 MB gz (Line 3 ≤ 1.3 MB); the first frame (P0 of the views js/px/ride.js asks for,
   replayed: both directions, desktop 1440×900 + phone 390×844) ≤ 160 KB gz.
   Dev-only, zero deps, Node ≥ 18, offline. Map data © OpenStreetMap contributors, ODbL 1.0. */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),zlib=require("zlib");
const G=require("./lib/osm-geom.js");
const REPO=path.join(__dirname,"..");
const t00=Date.now(),log=(...a)=>console.log(...a),mb=v=>(v/1e6).toFixed(2)+" MB",kb=v=>(v/1e3).toFixed(0)+" KB";

// --- arguments ---
const args={};
for(const a of process.argv.slice(2)){const m=a.match(/^--(from-cache|cache|from-l3|out|lines|report)(?:=(.+))?$/);
  if(!m){console.error("unknown argument "+a+"\nusage: node tools/pack-map.js [--from-cache] [--cache=DIR] [--out=js/map] [--lines=l3,…] [--report] | --from-l3=<l3.js> --out=<dir>");process.exit(2)}
  args[m[1]]=m[2]===undefined?true:m[2]}
const CACHE=typeof args.cache==="string"?path.resolve(args.cache):process.env.FETCH_MAP_CACHE?path.resolve(process.env.FETCH_MAP_CACHE):path.join(__dirname,".cache","map");
const FROM_L3=typeof args["from-l3"]==="string"?path.resolve(args["from-l3"]):null;
if(args["from-l3"]===true){console.error("--from-l3 needs a path");process.exit(2)}
const OUT=path.resolve(args.out||(FROM_L3?"mockups/px-dev/tiles-l3":path.join(REPO,"js","map")));
const REPORT=!!args.report,ONLY=args.lines?String(args.lines).split(","):null;

// --- tuning (see js/map/map.js) ---
const NEAR=60,TAIL=300,GAP=150,BIG=400,CH_MAX=4000;
const AREA_TOL=[1.5,6,{w:12,g:16,u:16}],AREA_MIN=[40,1000,{w:5000,g:20000,u:20000}],BRIDGE=[[G.TOL.area,G.MIN_AREA.area],[4,400]];
const LINE_TOL=[G.TOL.road,3,12],LOD1_ROADS=/^(motorway|trunk|primary|secondary|tertiary|residential)$/,LOD2_ROADS=/^(motorway|trunk|primary|secondary)$/;
const BUDGET=G.BUDGET;
const LM_ART=["cantonTower","ifc","ctf","operaHouse","haixinsha"];

// --- repo sources: stations (geo.js), playable lines (data.js), the runtime (map.js) ---
const GEO=vm.runInNewContext(fs.readFileSync(path.join(REPO,"js","geo.js"),"utf8")+"\n;GEO",{},{filename:"js/geo.js"});
const LINES=new Function(fs.readFileSync(path.join(REPO,"js","data.js"),"utf8").match(/\/\*__DATA__\*\/([\s\S]*)\/\*__END_DATA__\*\//)[1]+";return LINES;")();
const lineKey=ref=>ref==="GF"?"lgf":ref==="APM"?"lapm":"l"+ref;
const MAPJS=fs.readFileSync(path.join(REPO,"js","map","map.js"),"utf8");
function sandbox(lines){const sb={console,performance,MAPLINES:lines};sb.window=sb;vm.createContext(sb);vm.runInContext(MAPJS,sb,{filename:"js/map/map.js"});return sb}
const SB0=sandbox(null),LODS=SB0.MAP.LODS,LAYERS=SB0.MAP.LAYERS,LK=LAYERS.map(l=>l.key),CLS={};
for(const l of LAYERS)if(l.cls)CLS[l.key]=Object.fromEntries(l.cls.map((c,i)=>[c,i]));
const LMI=Object.fromEntries(SB0.MAP.LM.map((k,i)=>[k,i]));

// --- c45 encoder (the decoder is map.js) ---
const AL=[];for(let c=35;c<=125;c++)if(c!==92)AL.push(c);
class Enc{
  constructor(){this.b=Buffer.allocUnsafe(1<<12);this.n=0}
  i(v){if(!Number.isSafeInteger(v))throw new Error("c45: not an integer: "+v);let z=v>=0?v*2:-v*2-1;
    if(this.n+12>this.b.length){const b=Buffer.allocUnsafe(this.b.length*2);this.b.copy(b,0,0,this.n);this.b=b}
    while(z>=45){this.b[this.n++]=AL[45+z%45];z=Math.floor(z/45)}this.b[this.n++]=AL[z];return this}
  s(){return this.b.toString("latin1",0,this.n)}
}
const encInts=a=>{const e=new Enc();for(const v of a)e.i(v);return e.s()};
const encPts=P=>{const e=new Enc();e.i(P.length);let x=0,y=0;for(const p of P){e.i(p[0]-x);e.i(p[1]-y);x=p[0];y=p[1]}return e.s()};

// --- tile buckets: B[lod] Map key → {w:[],…}; features hold rings as Int32Array (tile-local quanta, x,y interleaved) ---
let TS=[new Set(),new Set(),new Set()];            // the planned tiles per LOD
const B=[new Map(),new Map(),new Map()],STAT={clip:0,drop:0,bigBld:0};
const qOf=(lod,lk)=>lk==="c"?1:LODS[lod].q;
function bucket(lod,k){let b=B[lod].get(k);if(!b){b={};for(const l of LK)b[l]=[];B[lod].set(k,b)}return b}
function forTiles(lod,bb,fn){const S=LODS[lod].S;
  for(let tx=Math.floor(bb[0]/S);tx<=Math.floor(bb[2]/S);tx++)for(let ty=Math.floor(bb[1]/S);ty<=Math.floor(bb[3]/S);ty++){
    const k=tx+"_"+ty;if(TS[lod].has(k))fn(k,[tx*S,ty*S,tx*S+S,ty*S+S])}}
function quant(pts,ox,oy,q,ring){ // → Int32Array or null; ring: open ring, drops the closing duplicate, needs ≥ 3 points and area
  const o=[];let lx=NaN,ly=NaN;
  for(const p of pts){const x=Math.round((p[0]-ox)/q),y=Math.round((p[1]-oy)/q);if(x!==lx||y!==ly){o.push(x,y);lx=x;ly=y}}
  if(ring){while(o.length>=4&&o[0]===o[o.length-2]&&o[1]===o[o.length-1])o.length-=2;if(o.length<6)return null}
  else if(o.length<4)return null;
  return Int32Array.from(o);
}
const areaOf=r=>{let a=0;for(let i=0,n=r.length;i<n;i+=2){const j=(i+2)%n;a+=r[i]*r[j+1]-r[j]*r[i+1]}return a/2};
function revRing(r){const o=new Int32Array(r.length);for(let i=0;i<r.length;i+=2){o[r.length-2-i]=r[i];o[r.length-1-i]=r[i+1]}return o}
// sid (+ sc) on the tile-split pieces the renderer must see as one: LOD0 roads residential and up (junction marks), landuse at LOD0/LOD1
// (procedural lots), buildings; everything else is drawn per piece anyway
const SID=[0,0,0],spans=(lod,bb)=>{const S=LODS[lod].S;return Math.floor(bb[0]/S)!==Math.floor(bb[2]/S)||Math.floor(bb[1]/S)!==Math.floor(bb[3]/S)};
const wantSid=(lod,lk,f)=>lk==="b"||(lk==="u"&&lod<2)||(lk==="r"&&lod===0&&f.c<=CLS.r.residential);
function putArea(lod,lk,f,rings){ // rings: metres, oriented (outer CCW, holes CW) → clipped into every planned tile they meet
  const bb=G.bboxOf(rings[0]);
  if(wantSid(lod,lk,f)&&spans(lod,bb))f=Object.assign({},f,{sid:SID[lod]++,sc:[(bb[0]+bb[2])/2,(bb[1]+bb[3])/2]});
  forTiles(lod,bb,(k,R)=>{const inside=bb[0]>=R[0]&&bb[2]<=R[2]&&bb[1]>=R[1]&&bb[3]<=R[3];if(!inside)STAT.clip++;putAreaIn(lod,lk,k,R,f,inside?rings:rings.map(r=>G.clipRing(r,R)))});
}
function putAreaIn(lod,lk,k,R,f,rings){ // rings already inside tile k (rect R)
  const out=[],q=qOf(lod,lk);
  for(let i=0;i<rings.length;i++){
    let r=rings[i].length>=3?quant(rings[i],R[0],R[1],q,true):null;const a=r?areaOf(r):0;
    if(!r||a===0){if(!i)return;continue}
    if((i===0)!==(a>0))r=revRing(r);out.push(r)}
  bucket(lod,k)[lk].push(Object.assign({},f,{r:out}));
}
const anyTile=(lod,bb)=>{let y=false;forTiles(lod,bb,()=>{y=true});return y};
function putLine(lod,lk,f,pts){
  const bb=G.bboxOf(pts),q=qOf(lod,lk);if(wantSid(lod,lk,f)&&spans(lod,bb))f=Object.assign({},f,{sid:SID[lod]++});
  forTiles(lod,bb,(k,R)=>{
    const inside=bb[0]>=R[0]&&bb[2]<=R[2]&&bb[1]>=R[1]&&bb[3]<=R[3];
    for(const pc of inside?[pts]:G.clipLine(pts,R)){const r=quant(pc,R[0],R[1],q,false);if(r)bucket(lod,k)[lk].push(Object.assign({},f,{r:[r]}))}
  });
}
function putBuilding(f,rings){ // whole in the tile of its bbox centre (pieces would be drawn as separate buildings: walls and roof
  // edges along the cut); only one > BIG m whose centre tile is not planned is clipped like an area, into the planned tiles it meets
  const bb=G.bboxOf(rings[0]),S=LODS[0].S,tx=Math.floor((bb[0]+bb[2])/2/S),ty=Math.floor((bb[1]+bb[3])/2/S),k=tx+"_"+ty;
  if(!TS[0].has(k)){if(bb[2]-bb[0]>BIG||bb[3]-bb[1]>BIG){STAT.bigBld++;putArea(0,"b",f,rings)}return}
  const out=[];for(let i=0;i<rings.length;i++){let r=quant(rings[i],tx*S,ty*S,1,true);const a=r?areaOf(r):0;if(!r||!a){if(!i)return;continue}if((i===0)!==(a>0))r=revRing(r);out.push(r)}
  bucket(0,k).b.push(Object.assign({},f,{r:out}));
}
function splitChain(c){ // chains > CH_MAX m → balanced pieces ≤ CH_MAX cut at vertices (unless one segment is longer); tunnels re-based
  const cum=G.along(c.pts),L=cum[cum.length-1];if(L<=CH_MAX)return [c];
  const cuts=[0],last=c.pts.length-1;
  while(L-cum[cuts[cuts.length-1]]>CH_MAX){
    const a=cuts[cuts.length-1],R=L-cum[a],want=cum[a]+R/Math.ceil(R/CH_MAX);let j=a+1;
    for(let i=a+1;i<last&&cum[i]-cum[a]<=CH_MAX;i++)if(Math.abs(cum[i]-want)<Math.abs(cum[j]-want)||cum[j]-cum[a]>CH_MAX)j=i;
    if(j>=last)break;cuts.push(j);
  }
  cuts.push(last);const out=[];
  for(let k=1;k<cuts.length;k++){const a=cuts[k-1],b=cuts[k],s0=cum[a],s1=cum[b],len=Math.floor(s1-s0);
    const tunnel=c.tunnel.map(([u,v])=>[Math.max(u,s0)-s0,Math.min(v,s1)-s0]).filter(([u,v])=>v>u).map(z=>z.map(v=>Math.min(len,Math.round(v))));
    out.push(Object.assign({},c,{len,tunnel,pts:c.pts.slice(a,b+1)}))}
  return out;
}
function putChain(c){
  for(const p of splitChain(c)){
    const cum=G.along(p.pts),h=cum[cum.length-1]/2;let i=1;while(i<cum.length-1&&cum[i]<h)i++;
    const t=(h-cum[i-1])/(cum[i]-cum[i-1]||1),mx=p.pts[i-1][0]+t*(p.pts[i][0]-p.pts[i-1][0]),my=p.pts[i-1][1]+t*(p.pts[i][1]-p.pts[i-1][1]);
    const S=LODS[1].S,tx=Math.floor(mx/S),ty=Math.floor(my/S),k=tx+"_"+ty;if(!TS[1].has(k))continue;
    const r=quant(p.pts,tx*S,ty*S,1,false);if(!r)continue;
    bucket(1,k).c.push({c:CLS.c[p.c],o:p.o?1:0,n:p.n||0,len:p.len,tun:p.tunnel,r:[r]});
  }
}
// LOD0 keeps every line and flag; LOD1/LOD2 leave out tunnels (never drawn), drop o/n (drawn alike) and merge again; LOD2 also
// leaves out link roads and sidings
function putLines(lk,F,l1,l2){
  for(const f of F)putLine(0,lk,{c:CLS[lk][f.c],fl:lineFlags(f)},f.pts);
  for(const [lod,ok] of [[1,l1],[2,l2]]){
    const sel=F.filter(f=>ok(f)&&!f.t&&!(lod===2&&(f.link||f.c==="siding"))).map(f=>Object.assign({c:f.c},f.b?{b:1}:{},f.link?{link:1}:{},{pts:f.pts}));
    for(const f of G.merge(sel,LINE_TOL[lod]))if(f.pts.length>1)putLine(lod,lk,{c:CLS[lk][f.c],fl:lineFlags(f)},f.pts);
  }
}
const lineFlags=f=>(f.b?1:0)|(f.t?2:0)|(f.link?4:0)|((f.o===1?1:f.o===-1?2:0)<<3)|((f.n||0)<<5);
function simpRings(rings,tol,min){ // = osm-geom areas() on an unclipped feature: DP per ring, rounded, small rings dropped, re-oriented
  const done=[];
  for(let k=0;k<rings.length;k++){
    let r=G.roundPts(G.rdp(rings[k].concat([rings[k][0]]),tol));if(r.length>1&&r[0][0]===r[r.length-1][0]&&r[0][1]===r[r.length-1][1])r.pop();
    const a=G.signedArea(r);if(r.length<3||Math.abs(a)<min){if(!k)break;continue}
    if((k===0)!==(a>0))r.reverse();done.push(r)}
  return done;
}
const simpLine=(pts,tol)=>G.roundPts(G.rdp(pts,tol));

// --- tracks (lines.js) ---
function sub(P,cum,a,b){ // polyline between arcs a < b
  const at=s=>{let i=1;while(i<cum.length-1&&cum[i]<s)i++;const t=(s-cum[i-1])/(cum[i]-cum[i-1]||1);return [P[i-1][0]+t*(P[i][0]-P[i-1][0]),P[i-1][1]+t*(P[i][1]-P[i-1][1])]};
  const o=[at(a)];for(let i=0;i<P.length;i++)if(cum[i]>a&&cum[i]<b)o.push(P[i]);o.push(at(b));return o;
}
function snapMono(P,pos){ // stations in order on polyline P: each within NEAR m, strictly increasing arc (first matching pass wins)
  const cum=G.along(P),st=[],off=[];let prev=-1e9;
  for(let k=0;k<pos.length;k++){
    const p=pos[k],cand=[];let dmin=1/0;
    for(let i=1;i<P.length;i++){const [d,t]=G.segDist(p,P[i-1],P[i]);if(d<dmin)dmin=d;if(d<=NEAR){const s=cum[i-1]+t*(cum[i]-cum[i-1]);if(s>prev+1)cand.push([s,d])}}
    if(!cand.length)return {ok:false,why:`station #${k} ${dmin<=NEAR?"out of order":Math.round(dmin)+" m off"}`,k};
    cand.sort((a,b)=>a[0]-b[0]);let best=cand[0];for(let j=1;j<cand.length&&cand[j][0]-cand[j-1][0]<300;j++)if(cand[j][1]<best[1])best=cand[j];
    st.push(best[0]);off.push(best[1]);prev=best[0];
  }
  return {ok:true,st,off,cum,max:Math.max(...off)};
}
function joinPieces(pieces){ // greedy: join the closest pair of piece ends while < GAP m apart
  pieces=pieces.filter(p=>p.length>1).map(p=>p.slice());
  for(;;){
    let best=null;
    for(let i=0;i<pieces.length;i++)for(let j=0;j<pieces.length;j++){if(i===j)continue;const a=pieces[i],b=pieces[j],d=G.dist(a[a.length-1],b[0]),d2=G.dist(a[a.length-1],b[b.length-1]);
      if(d<GAP&&(!best||d<best.d))best={i,j,d,rev:false};if(d2<GAP&&(!best||d2<best.d))best={i,j,d:d2,rev:true}}
    if(!best)return pieces;
    const a=pieces[best.i],b=best.rev?pieces[best.j].slice().reverse():pieces[best.j];
    const m=a.concat(G.dist(a[a.length-1],b[0])<.05?b.slice(1):b);pieces=pieces.filter((_,k)=>k!==best.i&&k!==best.j);pieces.unshift(m);
  }
}
function trackOf(rel,pos,loop){ // → {ok, pts, close?, st, max} from one route relation
  const ways=rel.members.filter(m=>m.type==="way"&&m.geometry&&!/^(platform|stop)/.test(m.role||"")).map(m=>G.pg(m.geometry));
  const pieces=joinPieces(G.chain(ways,2));
  if(pieces.length!==1)return {ok:false,why:`${pieces.length} pieces`};
  let P=pieces[0];
  if(loop){if(G.dist(P[0],P[P.length-1])>GAP)return {ok:false,why:"loop not closed"};if(G.dist(P[0],P[P.length-1])>.05)P=P.concat([P[0]])}
  let why="";
  for(const rev of [false,true]){
    let Q=rev?P.slice().reverse():P;
    if(loop){const V=Q.slice(0,-1);let bi=0,bd=1/0,bt=0;for(let j=0;j<V.length;j++){const [d,t]=G.segDist(pos[0],V[j],V[(j+1)%V.length]);if(d<bd){bd=d;bi=j;bt=t}}
      const a=V[bi],b=V[(bi+1)%V.length],X=[a[0]+bt*(b[0]-a[0]),a[1]+bt*(b[1]-a[1])];Q=[X].concat(V.slice(bi+1),V.slice(0,bi+1),[X])}
    const s=snapMono(Q,pos);if(!s.ok){why=s.why;continue}
    const L=s.cum[s.cum.length-1],n=pos.length;
    if(loop)return finish(sub(Q,s.cum,0,s.st[n-1]),pos,sub(Q,s.cum,s.st[n-1],L));
    return finish(sub(Q,s.cum,Math.max(0,s.st[0]-TAIL),Math.min(L,s.st[n-1]+TAIL)),pos,null);
  }
  return {ok:false,why};
}
function finish(P,pos,close){ // simplify + round, then snap again on what is stored
  const pts=G.roundPts(G.rdp(P,G.TOL.line3)),s=snapMono(pts,pos);if(!s.ok)return {ok:false,why:"after simplification: "+s.why};
  const o={ok:true,pts,st:s.st.map(Math.round),off:s.off,max:s.max,len:Math.round(s.cum[s.cum.length-1])};
  if(close)o.close=G.roundPts(G.rdp(close,G.TOL.line3));
  return o;
}
function curveOf(pos,loop){
  const q=loop?pos.concat([pos[0]]):pos,C=G.smoothPath(q,20),s=snapMono(C,pos);
  if(!loop)return finish(C,pos,null);
  const L=G.along(C);return finish(sub(C,L,0,s.st[pos.length-1]),pos,sub(C,L,s.st[pos.length-1],L[L.length-1]));
}
function buildTracks(routes){
  const rel=new Map(routes.elements.filter(e=>e.type==="relation").map(e=>[e.id,e])),out={},rep=[];
  for(const L of LINES){
    const g=GEO.lines.find(x=>lineKey(x.ref)===L.id);if(!g)throw new Error("no geo.js line for "+L.id);
    const pos=L.st.map(s=>{const q=g.stations.find(x=>x.zh===s[0]);if(!q)throw new Error(`${L.id}: station ${s[0]} not in js/geo.js`);return G.P(q.lat,q.lon)});
    const master=rel.get(g.relation),ids=[g.route].concat(master&&master.tags.type==="route_master"?master.members.filter(m=>m.type==="relation").map(m=>m.ref):[]);
    const first=L.st[0][0],last=L.st[L.st.length-1][0],score=r=>r.id===g.route?0:[r.tags.from,r.tags.to].includes(first)&&[r.tags.from,r.tags.to].includes(last)?1:2;
    const cands=[...new Set(ids)].map(id=>rel.get(id)).filter(r=>r&&r.tags&&r.tags.type==="route").sort((a,b)=>score(a)-score(b)||a.id-b.id);
    let t=null,used=null;const fails=[];
    for(const r of cands){const x=trackOf(r,pos,!!L.loop);if(x.ok){t=x;used=r.id;break}fails.push(r.id+": "+x.why)}
    if(!t){t=curveOf(pos,!!L.loop);if(!t.ok)throw new Error(L.id+": curve fallback failed: "+t.why)}
    out[L.id]=Object.assign({len:t.len,src:used?"osm":"curve",st:t.st,pts:encPts(t.pts)},L.loop?{loop:1,close:encPts(t.close)}:{});
    rep.push({id:L.id,src:used?"osm "+used:"curve",pts:t.pts.length,len:t.len,max:t.max,fails,hops:L.segKm.map((k,i)=>(t.st[i+1]-t.st[i])/(k*1000))});
  }
  const extra=[],br=[...rel.values()].find(r=>r.tags.type==="route"&&r.tags.from==="体育西路"&&r.tags.to==="机场北"); // the Line 3 airport branch (not playable)
  if(br)for(const pc of G.chain(br.members.filter(m=>m.type==="way"&&m.geometry&&!/^(platform|stop)/.test(m.role||"")).map(m=>G.pg(m.geometry)),2)){
    const pts=simpLine(pc,G.TOL.metro);if(pts.length>1)extra.push({key:"l3",branch:1,pts:encPts(pts)})}
  return {lines:out,extra,rep};
}

function readKind(cov,kind,fn){ // every cached element of a kind once (by OSM type + id), file by file (sorted)
  const seen=new Set();let n=0;
  for(const c of cov.cells[kind]?cov.cells[kind].ok.slice().sort((a,b)=>a.key<b.key?-1:1):[]){
    const j=JSON.parse(fs.readFileSync(path.join(CACHE,c.file),"utf8"));
    for(const e of j.elements){const k=e.type[0]+e.id;if(seen.has(k))continue;seen.add(k);n++;fn(e)}
  }
  return n;
}

// --- sources → features ---
function fromCache(){
  for(const f of ["manifest.json","routes.net.json"])if(!fs.existsSync(path.join(CACHE,f))){console.error(`no ${path.relative(REPO,path.join(CACHE,f))} — run tools/fetch-map.js first (or --from-l3)`);process.exit(2)}
  const M=JSON.parse(fs.readFileSync(path.join(CACHE,"manifest.json"),"utf8"));
  const routes=JSON.parse(fs.readFileSync(path.join(CACHE,"routes.net.json"),"utf8"));
  const cov=G.fetchCoverage(M,GEO,routes,CACHE),T=buildTracks(routes);
  const osm=Object.values(cov.cells).flatMap(c=>c.ok.map(x=>x.osm||"")).concat([(M.cells["routes.net"]||{}).osm_base||""]).sort().pop().slice(0,10);
  const lines={lines:T.lines,extra:T.extra};
  setTiles(lines,stationsOf(ONLY||LINES.map(L=>L.id)));
  const tc=Date.now(),info={cov,rep:T.rep,osm,counts:{}},cnt=info.counts;
  // areas: water / green / landuse (16 km cells) — LOD0 unclipped copies kept for building heights and the river raster
  const W0=[],PARK0=[],LU0=[],rivers=[],coast=[];let islet=null;
  const area=(lk,e,cls)=>{const c=cls(e.tags||{});if(!c)return;
    for(const rings of G.polysOf(e)){
      const bb=G.bboxOf(rings[0]),at=[0,1,2].map(l=>anyTile(l,bb));   // LOD0 copies only where used: heights (LOD0 tiles), river raster (LOD1)
      for(let lod=0;lod<3;lod++){if(!at[lod]&&!(lod===0&&lk==="w"&&at[1]))continue;
        const tol=lod<2?AREA_TOL[lod]:AREA_TOL[2][lk],min=lod<2?AREA_MIN[lod]:AREA_MIN[2][lk],r=simpRings(rings,tol,min);if(!r.length)continue;
        putArea(lod,lk,{c:CLS[lk][c]},r);if(!lod){const f={c,p:r};if(lk==="w")W0.push(f);else if(lk==="u")LU0.push(f);else if(c==="park")PARK0.push(f)}}
    }};
  cnt.water=readKind(cov,"water",e=>{const t=e.tags||{};
    if(e.type==="way"&&t.natural==="coastline"){coast.push(G.pg(e.geometry));return}
    if(e.type==="way"&&/^(river|canal)$/.test(t.waterway||"")){rivers.push(e);return}
    area("w",e,G.cWater)});
  cnt.green=readKind(cov,"green",e=>{const t=e.tags||{};if(!islet&&e.type==="way"&&e.geometry&&/^海心沙/.test(t.name||"")&&(t.place==="islet"||t.leisure==="park"))islet=G.pg(e.geometry);area("g",e,G.cGreen)});
  cnt.landuse=readKind(cov,"landuse",e=>area("u",e,G.cLand));
  log(`  areas: water ${W0.length}, landuse ${LU0.length}, parks ${PARK0.length} (LOD0) · ${((Date.now()-tc)/1000).toFixed(1)} s`);
  // buildings + bridges (4 km cells)
  const luAt=G.areaIndex(LU0),parkAt=G.areaIndex(PARK0),hOf=G.heightOf({luAt,parkAt,isletRing:islet}),lmH={},hs={osm:0,est:0,lm:0,zero:0};
  cnt.bldg=readKind(cov,"bldg",e=>{const t=e.tags||{};
    if(G.cBuilding(t))for(const rings of G.polysOf(e)){const r=simpRings(rings,G.TOL.building,G.MIN_AREA.building);if(!r.length)continue;
      const x=hOf(t,r);hs[x._s]++;if(x.lm)lmH[x.lm]=Math.max(lmH[x.lm]||0,x.h);putBuilding({h:x.h,lm:x.lm?LMI[x.lm]:0},r)}
    if(G.cBridge(t))for(const rings of G.polysOf(e))for(let lod=0;lod<2;lod++){const r=simpRings(rings,BRIDGE[lod][0],BRIDGE[lod][1]);if(r.length)putArea(lod,"k",{},r)}});
  info.heights=hs;
  // lines: roads (16 km majors + 4 km minor + paths), rail, waterways — simplified, merged network-wide, then per LOD
  const roads=[],rail=[],ww=[],chainEls=[];
  const lin=(arr,e,cls,tol)=>{if(e.type!=="way"||!e.geometry)return;for(const f of G.lines([e],cls,{tol}))arr.push(Object.assign(f,{_i:e.id}))};
  const road=e=>{lin(roads,e,G.cRoad,G.TOL.road);const t=e.tags||{};if(e.type==="way"&&G.CH.cls.test(t.highway||""))chainEls.push({type:"way",id:e.id,tags:t,geometry:e.geometry})};
  cnt.roads=readKind(cov,"roads",road);
  cnt.minor=readKind(cov,"minor",e=>{if((e.tags||{}).waterway)lin(ww,e,G.cWaterway,G.TOL.road);else road(e)});
  cnt.paths=readKind(cov,"paths",road);
  cnt.rail=readKind(cov,"rail",e=>lin(rail,e,G.cRail,G.TOL.rail));
  for(const e of rivers)lin(ww,e,G.cWaterway,G.TOL.road);
  const byId=(a,b)=>a._i-b._i;
  for(const [lk,arr,l1,l2] of [["r",roads,f=>LOD1_ROADS.test(f.c),f=>LOD2_ROADS.test(f.c)],["l",rail,()=>true,()=>false],["v",ww,f=>f.c!=="stream",()=>false]]){
    arr.sort(byId);const m=G.merge(arr.map(f=>{delete f._i;return f}));info.counts[lk+"Merged"]=m.length;
    putLines(lk,m,l1,l2);
  }
  // traffic chains (LOD1), stitched over everything cached
  chainEls.sort(byId);const all=[-1e7,-1e7,1e7,1e7],chains=G.trafficChains(chainEls,all);for(const c of chains)putChain(c);info.chains=chains.length;
  // the sea: coastline chains → per tile (only where every water cell over the tile is cached)
  const cc=G.coastChains(coast.sort((a,b)=>a[0][0]-b[0][0]||a[0][1]-b[0][1])),gap=cov.gap("water"),bad=new Set(G.coastBroken(cc,gap)),seaStat={},SEA1=[];
  for(const c of bad)c.bad=1;const side=G.coastSide(cc,{gap}),zone=G.coastGapZone([...bad],gap);
  info.sea={chains:cc.length,open:cc.filter(c=>G.dist(c[0],c[c.length-1])>=.05).length,broken:bad.size,tiles:[0,0,0],skipped:0};
  if(cc.length)for(let lod=0;lod<3;lod++){
    const tol=lod<2?AREA_TOL[lod]:AREA_TOL[2].w,min=lod<2?AREA_MIN[lod]:AREA_MIN[2].w,ch=cc.map(c=>Object.assign(G.rdp(c,tol),c.bad?{bad:1}:{})),cb=G.bboxOf(cc.flat()),S=LODS[lod].S,isSea=p=>side(p,S*.75+2000);
    for(const k of [...TS[lod]].sort()){const [tx,ty]=k.split("_").map(Number),R=[tx*S,ty*S,tx*S+S,ty*S+S];
      if(G.rectPtDist(R,[(cb[0]+cb[2])/2,(cb[1]+cb[3])/2])>Math.hypot(cb[2]-cb[0],cb[3]-cb[1])/2+30000)continue;
      if(cov.hole("water",R)){info.sea.skipped++;continue}
      if(bad.size&&zone(R)){seaStat.incomplete=(seaStat.incomplete||0)+1;continue}
      const polys=G.coastPolys(ch,R,isSea,seaStat);
      for(const p of polys){const r=[p[0]].concat(p.slice(1).filter(h=>Math.abs(G.signedArea(h))>=min));putAreaIn(lod,"w",k,R,{c:CLS.w.sea},r);if(lod===1)SEA1.push({c:"sea",p:r})}
      if(polys.length)info.sea.tiles[lod]++}
  }
  info.sea.dangling=seaStat.dangling||0;info.sea.incomplete=seaStat.incomplete||0;
  // river lanes (boats), network-wide over the LOD1 corridor (--lines: the water of other corridors is not read — lines.js keeps its lanes)
  const tr=Date.now(),R1=G.bboxOf([...TS[1]].flatMap(k=>{const [x,y]=k.split("_").map(Number);return [[x*4000,y*4000],[x*4000+4000,y*4000+4000]]}));
  const old=ONLY&&fs.existsSync(path.join(OUT,"lines.js"))?vm.runInNewContext(fs.readFileSync(path.join(OUT,"lines.js"),"utf8")+"\n;MAPLINES",{}):null;
  if(old&&old.lanes)lines.lanes=old.lanes;
  else{rivers.sort(byId);const lanes=TS[1].size?G.riverLanes(rivers,null,R1,G.rasterSparse(W0.concat(SEA1),R1,G.RL.res)):[];
    lines.lanes=lanes.map(l=>({zh:l.zh,len:l.len,width:l.width,w:encInts(l.w.map((v,i)=>v-(i?l.w[i-1]:0))),pts:encPts(l.pts)}))}
  log(`  river lanes: ${lines.lanes.length}${old&&old.lanes?" (kept from lines.js)":""} (${((Date.now()-tr)/1000).toFixed(1)} s)`);
  // landmarks (Line 3 art)
  const lf=path.join(CACHE,"landmarks.l3.json");lines.landmarks=[];
  if(fs.existsSync(lf)){const els=JSON.parse(fs.readFileSync(lf,"utf8")).elements;
    for(const L of G.LANDMARKS){if(!LM_ART.includes(L[0]))continue;const b=G.pickLandmark(els,L);if(!b)continue;const ll=b.center||b,[x,y]=G.P(ll.lat,ll.lon);
      lines.landmarks.push(Object.assign({id:L[0],zh:b.tags.name,en:b.tags["name:en"]||"",x:Math.round(x),y:Math.round(y)},lmH[L[0]]?{h:lmH[L[0]]}:{}))}}
  lines.osm=osm;
  return {lines,info};
}
function setTiles(lines,stations){ // planned tiles: LOD0/1 = the union of the lines' MAP.tiles(id, all); LOD2 = over the stations' bbox + 8 km
  const sb=sandbox(Object.assign({lines:{}},lines)),S=LODS[2].S,b=G.bboxOf(stations);TS=[new Set(),new Set(),new Set()];
  for(const id of Object.keys(lines.lines))if(!ONLY||ONLY.includes(id)){const t=sb.MAP.tiles(id,true);for(let l=0;l<3;l++)for(const x of t[l])TS[l].add(x.key)}
  for(let tx=Math.floor((b[0]-8000)/S);tx<=Math.floor((b[2]+8000)/S);tx++)for(let ty=Math.floor((b[1]-8000)/S);ty<=Math.floor((b[3]+8000)/S);ty++)TS[2].add(tx+"_"+ty);
}
const stationsOf=ids=>LINES.filter(L=>ids.includes(L.id)).flatMap(L=>{const g=GEO.lines.find(x=>lineKey(x.ref)===L.id);return L.st.map(s=>{const q=g.stations.find(x=>x.zh===s[0]);return G.P(q.lat,q.lon)})});
function fromL3(file){
  const L3=vm.runInNewContext(fs.readFileSync(file,"utf8")+"\n;L3",{},{filename:file});
  const pts=L3.line3.slice().reverse(),cum=G.along(pts),Lf=cum[cum.length-1];                  // data.js order: 海傍 → 天河客运站
  const st=L3.stations.slice().reverse().map(s=>Math.round(Lf-s.d)),dl=LINES.find(l=>l.id==="l3");
  if(L3.stations[L3.stations.length-1].zh!==dl.st[0][0])throw new Error("l3.js stations do not end at data.js station 0");
  const lines={lines:{l3:{len:Math.round(Lf),src:L3.line3Src==="osm"?"osm":"curve",st,pts:encPts(pts)}},
    extra:L3.otherLines.map(o=>Object.assign({key:o.key},o.branch?{branch:1}:{},{pts:encPts(o.pts)})),
    lanes:(L3.riverLanes||[]).map(l=>({zh:l.zh,len:l.len,width:l.width,w:encInts(l.w.map((v,i)=>v-(i?l.w[i-1]:0))),pts:encPts(l.pts)})),
    landmarks:L3.landmarks.filter(l=>LM_ART.includes(l.id)),osm:L3.fetched||""};
  setTiles(lines,L3.stations.map(s=>[s.x,s.y]));
  for(const [lk,arr] of [["w",L3.water],["g",L3.green],["u",L3.landuse]])for(const f of arr){
    putArea(0,lk,{c:CLS[lk][f.c]},f.p);
    for(let lod=1;lod<3;lod++){const tol=lod<2?AREA_TOL[lod]:AREA_TOL[2][lk],min=lod<2?AREA_MIN[lod]:AREA_MIN[2][lk],r=simpRings(f.p,tol,min);if(r.length)putArea(lod,lk,{c:CLS[lk][f.c]},r)}}
  for(const f of L3.bridges){putArea(0,"k",{},f.p);const r=simpRings(f.p,BRIDGE[1][0],BRIDGE[1][1]);if(r.length)putArea(1,"k",{},r)}
  for(const [lk,arr,l1,l2] of [["r",L3.roads,f=>LOD1_ROADS.test(f.c),f=>LOD2_ROADS.test(f.c)],["l",L3.rail,()=>true,()=>false],["v",L3.waterways,f=>f.c!=="stream",()=>false]])
    putLines(lk,arr,l1,l2);
  for(const f of L3.buildings)putBuilding({h:f.h,lm:f.lm?LMI[f.lm]:0},f.p);
  for(const c of L3.chains)putChain(c);
  return {lines,info:{l3:{file,raw:fs.statSync(file).size,gz:zlib.gzipSync(fs.readFileSync(file),{level:9}).length}}};
}

// --- encode, verify (decode with map.js), write ---
function morton(x,y){let m=0;for(let i=0;i<10;i++)m+=(((x>>i)&1)+((y>>i)&1)*2)*4**i;return m}
function cmpFeat(a,b){if(a.m!==b.m)return a.m-b.m;if(a.hd!==b.hd)return a.hd-b.hd;
  for(let i=0;i<Math.min(a.r.length,b.r.length);i++){const p=a.r[i],q=b.r[i];if(p.length!==q.length)return p.length-q.length;for(let k=0;k<p.length;k++)if(p[k]!==q[k])return p[k]-q[k]}
  return a.r.length-b.r.length}
function encTile(lod,key,b){ // → {e?, <layer key>: c45} (e: the features' overhang past the tile square, m: W, S, E, N)
  const S=LODS[lod].S,layers={},[tx,ty]=key.split("_").map(Number),ov=[0,0,0,0];
  for(const L of LAYERS){
    const F=b[L.key];if(!F.length)continue;const q=qOf(lod,L.key),k=1024/(3*S/q);
    for(const f of F){const x=f.sid!==undefined?1:0,mu=f.r.length>1?1:0;
      f.hd=L.kind==="area"?(f.c||0)*4+x*2+mu:L.kind==="bld"?((f.h*8+f.lm)*2+x)*2+mu:L.kind==="line"?f.c+L.cls.length*(x+2*f.fl):f.c+5*(f.o+2*f.n);
      f.m=morton(Math.max(0,Math.min(1023,Math.floor((f.r[0][0]+S/q)*k))),Math.max(0,Math.min(1023,Math.floor((f.r[0][1]+S/q)*k))))}
    F.sort(cmpFeat);
    const e=new Enc();let nr=0,np=0;for(const f of F){nr+=f.r.length;for(const r of f.r)np+=r.length/2}
    e.i(F.length).i(nr).i(np);let x=0,y=0;
    for(const f of F)for(const r of f.r)for(let i=0;i<r.length;i+=2){const X=r[i]*q,Y=r[i+1]*q;ov[0]=Math.max(ov[0],-X);ov[1]=Math.max(ov[1],-Y);ov[2]=Math.max(ov[2],X-S);ov[3]=Math.max(ov[3],Y-S)}
    for(const f of F){
      e.i(f.hd);if((L.kind==="area"||L.kind==="bld")&&f.r.length>1)e.i(f.r.length);
      if(f.sid!==undefined){e.i(f.sid);if(L.kind!=="line")e.i(Math.round((f.sc[0]-tx*S)/q)).i(Math.round((f.sc[1]-ty*S)/q))}
      if(L.kind==="chain"){e.i(f.len).i(f.tun.length);let s=0;for(const [a,z] of f.tun){e.i(a-s).i(z-a);s=z}}
      for(const r of f.r){e.i(r.length/2);for(let i=0;i<r.length;i+=2){e.i(r[i]-x).i(r[i+1]-y);x=r[i];y=r[i+1]}}
    }
    layers[L.key]=e.s();
  }
  return ov.some(v=>v>0)?Object.assign({e:encInts(ov)},layers):layers;
}
function verify(sb,lod,key,layers,b,base){ // decode what was encoded and compare every feature, and the extent (header) with the decoded one
  sb.MAPT(lod,key,Object.assign({i:base},layers));const T=sb.MAP.tile(lod,key,true),S=LODS[lod].S,[tx,ty]=key.split("_").map(Number),x=[tx*S,ty*S,tx*S+S,ty*S+S];
  for(const D of T.dec)if(D)for(let f=0;f<D.n;f++)for(let j=0;j<4;j++)x[j]=j<2?Math.min(x[j],D.BB[4*f+j]):Math.max(x[j],D.BB[4*f+j]);
  if(x.join()!==T.ext.join())throw new Error(`verify ${lod}/${key}: extent ${T.ext} ≠ ${x}`);
  for(let li=0;li<LAYERS.length;li++){const L=LAYERS[li],F=b[L.key],D=T.dec[li];if(!F.length){if(D)throw new Error("verify: extra layer");continue}
    const q=qOf(lod,L.key);if(D.n!==F.length)throw new Error(`verify ${lod}/${key}/${L.key}: ${D.n} ≠ ${F.length} features`);
    let k=0;for(let f=0;f<F.length;f++){if(D.H[f]!==F[f].hd||D.SID[f]!==(F[f].sid!==undefined?F[f].sid:-1))throw new Error(`verify ${lod}/${key}/${L.key}#${f}: header`);
      for(const r of F[f].r)for(let i=0;i<r.length;i+=2,k++)if(D.XY[2*k]!==tx*S+r[i]*q||D.XY[2*k+1]!==ty*S+r[i+1]*q)throw new Error(`verify ${lod}/${key}/${L.key}#${f}: point ${k}`)}}
  sb.MAP.clear();
}
function emit(lines,info){
  const tw=Date.now(),files=[],have=[[],[],[]],hs=[new Set(),new Set(),new Set()];let base=0;
  const sb=sandbox(null),nOf=b=>LK.reduce((s,l)=>s+b[l].length,0);
  if(ONLY)for(let lod=0;lod<3;lod++){ // --lines: the tile files left alone keep their ids and sids, the rewritten tiles number above them
    const dir=path.join(OUT,"t"+lod);let off=0;
    for(const f of fs.existsSync(dir)?fs.readdirSync(dir):[]){const m=f.match(/^(-?\d+_-?\d+)\.js$/);if(!m||B[lod].has(m[1])&&nOf(B[lod].get(m[1])))continue;
      vm.runInContext(fs.readFileSync(path.join(dir,f),"utf8"),sb);const T=sb.MAP.tile(lod,m[1],true);if(!T)continue;base=Math.max(base,T.base+T.n);
      for(const L of T.dec)if(L)for(const s of L.SID)off=Math.max(off,s+1);sb.MAP.clear()}
    for(const b of B[lod].values())for(const l of LK)for(const f of b[l])if(f.sid!==undefined)f.sid+=off}
  for(let lod=0;lod<3;lod++){
    const dir=path.join(OUT,"t"+lod);fs.mkdirSync(dir,{recursive:true});
    const keys=[...B[lod].keys()].map(k=>k.split("_").map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0]).map(p=>p.join("_"));
    for(const key of keys){
      const b=B[lod].get(key),n=nOf(b);if(!n)continue;
      const layers=encTile(lod,key,b);verify(sb,lod,key,layers,b,base);
      const txt=`MAPT(${lod},"${key}",{i:${base}${["e"].concat(LK).filter(l=>layers[l]).map(l=>`,${l}:"${layers[l]}"`).join("")}});\n`;
      if(base+n>=2**31)throw new Error("feature ids overflow");base+=n;
      const f=path.join(dir,key+".js");if(!fs.existsSync(f)||fs.readFileSync(f,"utf8")!==txt)fs.writeFileSync(f,txt);
      files.push({lod,key,f,raw:Buffer.byteLength(txt),gz:zlib.gzipSync(txt,{level:9}).length,n,layers:Object.fromEntries(LK.filter(l=>layers[l]).map(l=>[l,layers[l].length]))});
      have[lod].push(key);hs[lod].add(key);B[lod].delete(key);
    }
    // stale files: every other tile file in the folder (with --lines: kept, and listed as present)
    for(const f of fs.readdirSync(dir)){const m=f.match(/^(-?\d+_-?\d+)\.js$/);if(!m||hs[lod].has(m[1]))continue;
      if(ONLY){have[lod].push(m[1]);const txt=fs.readFileSync(path.join(dir,f));files.push({lod,key:m[1],f:path.join(dir,f),raw:txt.length,gz:zlib.gzipSync(txt,{level:9}).length,kept:1});continue}
      fs.unlinkSync(path.join(dir,f));info.deleted=(info.deleted||0)+1}
  }
  lines.have=have.map(ks=>{const p=ks.map(k=>k.split("_").map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0]),o=[p.length];let x=0,y=0;for(const [a,c] of p){o.push(a-x,c-y);x=a;y=c}return encInts(o)});
  const L=Object.assign({v:1,source:"Map data © OpenStreetMap contributors, ODbL 1.0",osm:lines.osm||"",origin:G.ORIGIN,mPerDegLat:G.MLAT,mPerDegLon:G.MLON,
    lod:LODS.map((l,i)=>Object.assign({S:l.S,q:l.q},i<2?{band:SB0.MAP.BAND[i]}:{pad:SB0.MAP.BAND[2]})),have:lines.have},{lines:lines.lines,extra:lines.extra||[],lanes:lines.lanes||[],landmarks:lines.landmarks||[]});
  const js=o=>JSON.stringify(o).replace(/"([A-Za-z_]\w*)":/g,"$1:");
  const txt=`/* Generated by tools/pack-map.js — do not edit by hand. The pixel ride's always-loaded map index: one track per playable line
   (js/data.js station order, st = metres along it), the tiles that exist per LOD, river lanes, landmarks. Format: js/map/map.js.
   Map data © OpenStreetMap contributors, ODbL 1.0 — openstreetmap.org/copyright */
var MAPLINES={v:${L.v},source:${js(L.source)},osm:${js(L.osm)},origin:${js(L.origin)},mPerDegLat:${L.mPerDegLat},mPerDegLon:${L.mPerDegLon},
lod:${js(L.lod)},
have:${js(L.have)},
lines:{
${Object.entries(L.lines).map(([k,v])=>k+":"+js(v)).join(",\n")}
},
extra:[${L.extra.map(js).join(",\n")}],
lanes:[${L.lanes.map(js).join(",\n")}],
landmarks:${js(L.landmarks)}};
`;
  fs.writeFileSync(path.join(OUT,"lines.js"),txt);
  info.lines={raw:Buffer.byteLength(txt),gz:zlib.gzipSync(txt,{level:9}).length};
  info.writeS=(Date.now()-tw)/1000;
  return {files,L};
}

// --- report + budgets ---
function report(files,L,info){
  let fail=0;const by=[0,1,2].map(l=>files.filter(f=>f.lod===l)),sum=(a,k)=>a.reduce((s,f)=>s+f[k],0);
  log(`tiles (${OUT}):`);
  for(let l=0;l<3;l++)log(`  LOD${l}: ${String(by[l].length).padStart(5)} tiles (planned ${TS[l].size})  ${mb(sum(by[l],"raw")).padStart(9)} raw  ${mb(sum(by[l],"gz")).padStart(9)} gz  · max ${kb(Math.max(0,...by[l].map(f=>f.raw)))} raw`);
  const net=sum(files,"raw")+info.lines.raw;
  log(`  lines.js ${kb(info.lines.raw)} raw / ${kb(info.lines.gz)} gz · whole network ${mb(net)} raw / ${mb(sum(files,"gz")+info.lines.gz)} gz  (budget ${mb(BUDGET.net)} raw)${net>BUDGET.net?"  ** OVER BUDGET **":""}`);
  if(net>BUDGET.net)fail++;
  if(REPORT){const lay={};for(const f of files)for(const [k,v] of Object.entries(f.layers||{})){const o=lay[f.lod+k]=lay[f.lod+k]||0;lay[f.lod+k]=o+v}
    for(let l=0;l<3;l++)log(`  LOD${l} layers: `+LK.filter(k=>lay[l+k]).map(k=>`${k} ${kb(lay[l+k])}`).join(" · "))}
  const sb=sandbox(L),size=new Map(files.map(f=>[f.lod+"/"+f.key,f])),g=(lod,key)=>(size.get(lod+"/"+key)||{gz:0}).gz;
  log(`per line (gz): cold ride = lines.js + every tile of the line (budget ${mb(BUDGET.ride)}; ${Object.entries(BUDGET.rideOf).map(([k,v])=>k+" "+mb(v)).join(", ")}) · first frame = the P0 of the ride's own views, worst of desktop/phone × both directions (budget ${kb(BUDGET.first)})`);
  const worst={ride:0,first:0};
  for(const b of G.budgets(sb.MAP,L,g,info.lines.gz)){const id=b.id;
    if(ONLY&&!ONLY.includes(id))continue;
    if(b.bad.length)fail++;worst.ride=Math.max(worst.ride,b.ride);worst.first=Math.max(worst.first,b.first);
    const r=(info.rep||[]).find(x=>x.id===id),t=sb.MAP.tiles(id);
    log(`  ${id.padEnd(5)} tiles ${t.map(l=>l.length).join("/").padEnd(11)} ride ${kb(b.ride).padStart(6)} (${(b.ride/1e3/b.km).toFixed(1).padStart(5)} KB/km of track)  first ${kb(b.first).padStart(4)} (${b.at})`+
      (r?`  track ${r.src}, ${(r.len/1000).toFixed(1)} km, ${r.pts} pts, max off ${r.max.toFixed(1)} m`:"")+(b.bad.length?"  ** OVER BUDGET: "+b.bad.join(", ")+" **":""));
    if(r&&REPORT&&r.fails.length)log(`        rejected: ${r.fails.join(" · ")}`);
    if(r){const w=r.hops.map((v,i)=>[i,v]).filter(([,v])=>v<.8||v>1.6);if(w.length)log(`        WARN hop track ÷ segKm outside 0.8–1.6: ${w.map(([i,v])=>`#${i} ${v.toFixed(2)}`).join(", ")}`)}
  }
  log(`  worst: ride ${kb(worst.ride)} gz, first frame ${kb(worst.first)} gz`);
  return fail;
}

// --- run ---
(()=>{
  let r;
  if(FROM_L3){log(`from ${path.relative(REPO,FROM_L3)} → ${path.relative(REPO,OUT)}`);r=fromL3(FROM_L3)}
  else{log(`from ${path.relative(REPO,CACHE)} → ${path.relative(REPO,OUT)}${ONLY?" (lines "+ONLY.join(",")+")":""}`);r=fromCache()}
  const tp=Date.now();const {files,L}=emit(r.lines,r.info);const info=r.info;
  if(info.cov){log("cache coverage (planned cells cached / planned; tiles over a gap still get what is cached):");
    for(const [k,c] of Object.entries(info.cov.cells))log(`  ${k.padEnd(8)} ${String(c.ok.length).padStart(4)} / ${String(c.planned).padStart(4)}${c.missing.length?"  missing "+c.missing.length:""}`);
    log(`  elements: ${Object.entries(info.counts).map(([k,v])=>k+" "+v).join(" · ")} · heights ${Object.entries(info.heights).map(([k,v])=>k+" "+v).join(" ")} · chains ${info.chains}`);
    log(`  sea: ${info.sea.chains} coastline chains (${info.sea.open} open, ${info.sea.broken} broken) → sea in ${info.sea.tiles.join("/")} tiles, ${info.sea.skipped} skipped (water cells missing), ${info.sea.incomplete} left land (${info.sea.dangling} pieces end inside)`);
    const bad=info.rep.filter(x=>x.src==="curve");log(`tracks: ${info.rep.length} lines, ${info.rep.length-bad.length} from OSM${bad.length?", curve fallback: "+bad.map(x=>x.id+" ("+x.fails.join("; ")+")").join(", "):""}`)}
  log(`  clipped pieces ${STAT.clip}, buildings > ${BIG} m clipped ${STAT.bigBld}${info.deleted?", stale tiles deleted "+info.deleted:""} · write+verify ${info.writeS.toFixed(1)} s`);
  if(info.l3){const tot=files.reduce((s,f)=>s+f.raw,0)+info.lines.raw,gz=files.reduce((s,f)=>s+f.gz,0)+info.lines.gz;
    log(`vs ${path.basename(info.l3.file)}: ${mb(info.l3.raw)} raw / ${mb(info.l3.gz)} gz → tiles + lines.js ${mb(tot)} raw (${(tot/info.l3.raw*100).toFixed(0)}%) / ${mb(gz)} gz (${(gz/info.l3.gz*100).toFixed(0)}%)`)}
  const fail=report(files,L,info);
  log(`done in ${((Date.now()-t00)/1000).toFixed(1)} s${fail?` — ${fail} budget(s) exceeded`:""}`);
  if(fail)process.exitCode=1;
})();
