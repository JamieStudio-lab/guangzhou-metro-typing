#!/usr/bin/env node
/* Packs the overview map js/map/ov.js (global MAPOV: the menu's pixel map and the end-of-ride whole-line view, 48–512 m/px) from what
   the pixel ride already ships: js/map/lines.js (MAPLINES) and the city tiles js/map/t2/*.js, decoded with js/map/map.js in a vm — no
   network, no tools/.cache. Re-run it after tools/pack-map.js; tools/check-map.js checks the result (and its budget).
   Usage: node tools/pack-ov.js [--dir=js/map] [--out=js/map/ov.js] [--report]   (--report: per class / line) · exit 1 over budget.
   Content — MAP metres, integers: x east / y NORTH of MAPLINES.origin (广州塔 station), the tiles' grid. Tuning: T below (m, m²).
     lines  each lines.js track cut to its end stations, Douglas–Peucker TR with every js/data.js station kept as a vertex, QT quanta; a
            loop (Line 11) keeps its closing arc; extra = the non-playable branches (Line 3's)
     lanes  MAPLINES.lanes (river centre lines, for rivers too thin to fill at these scales): DP TL, widths per kept point in WQ
     water  LOD2 water ≥ WMIN and ≥ WTHIN wide (2·area ÷ bank length) — of the whole source feature: its tile pieces are joined by
            their shared seam points first; the sea always; holes ≥ WMIN; DP TW with the tile-edge vertices kept (pieces still meet)
     urban  built-up land: LOD2 landuse URBAN + the cells every LOD2 road passes, in Q cells; built where their share of the (2·UR + 1)²
            window around a cell is ≥ UT; specks and holes < MMIN flipped; traced (4-connected), DP TM
     green  as urban per class (GREEN: park, forest) from LOD2 green alone: window (2·GR + 1)², share ≥ GT
     roads  LOD2 motorway + trunk: tile pieces joined where two ends meet, networks < RMIN dropped; then, motorway first and long first,
            stretches ≤ DD from and within DA° of a road already kept (the second carriageway) dropped, kept ones ≥ DMIN; DP TD
   Areas, lanes and roads in Q quanta; every ring ≥ 3 points, no repeated first point, outer CCW / holes CW; repeats, spikes and
   collinear points go after quantizing (the filled shape does not change). Beyond ext (the t2 extent) there is no land data: plain
   land + js/boundaries.js, projected x = (lon − origin.lon)·mPerDegLon, y = (lat − origin.lat)·mPerDegLat (= js/px/ride.js geoXY;
   ov.js carries the constants, so the menu needs no lines.js).
   FILE  a classic script (<script> injection, file:// and http): the header, then (DECODER)(root, D) — DECODER below as it is, D =
   {v, source, osm, origin, mPerDegLat, mPerDegLon, q, qt, wq, ext, cls, lines, extra, lanes, w, g, u, r}; strings are c45
   (js/map/map.js: zigzag, base 45 over ASCII 35…125 minus the backslash):
     lines.<id> = {p, s[, c, loop:1]}: p = n, n × (dx, dy) in qt from the origin; s = the station vertex indices as deltas; c = the
       closing arc as p; extra[] = {key, branch?, p}; lanes[] = {zh, width, p (in q), w (n widths in wq as running deltas)}
     w g u (areas) = n, then per feature H = cls·2 + multi [, rings], per ring count, count × (dx, dy); r (lines) = n, then per feature
       cls, count, count × (dx, dy); dx, dy in q from the previous point of the LAYER (the first from the origin); features in Morton
       order of their first point (192 m cells), then class, then shape. The decoded shapes / API: the header this writes into ov.js.
   Byte-stable (the same tiles give the same bytes). Budget tools/lib/osm-geom.js BUDGET.ov, gz: over it green goes first, then roads.
   Dev-only, zero deps, Node ≥ 18, offline. Map data © OpenStreetMap contributors, ODbL 1.0. */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),zlib=require("zlib");
const G=require("./lib/osm-geom.js");
const REPO=path.join(__dirname,".."),t00=Date.now(),kb=v=>(v/1e3).toFixed(1)+" KB";
const args={};
for(const a of process.argv.slice(2)){const m=a.match(/^--(dir|out|report)(?:=(.+))?$/);
  if(!m){console.error("usage: node tools/pack-ov.js [--dir=js/map] [--out=js/map/ov.js] [--report]");process.exit(2)}args[m[1]]=m[2]===undefined?true:m[2]}
const DIR=path.resolve(args.dir||path.join(REPO,"js","map")),OUT=path.resolve(args.out||path.join(DIR,"ov.js")),REPORT=!!args.report;

// --- tuning ---
const T={Q:48,QT:8,WQ:16,TR:24,TL:48,TW:48,TM:120,TD:72,WMIN:8e4,WTHIN:36,UR:6,UT:.35,GR:2,GT:.5,MMIN:5e5,RMIN:3000,DD:80,DA:30,DMIN:300};
const {Q,QT,WQ,TR,TL,TW,TM,TD}=T;
const URBAN=/^(residential|commercial|industrial|construction|education|civic|railway|plaza)$/,ROADS=["motorway","trunk"],GREEN={park:"park grass golf pitch cemetery",forest:"forest wetland"};

// --- the ride's own data, decoded by the game's decoder ---
const sb={console,performance};sb.window=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(DIR,"lines.js"),"utf8"),sb,{filename:"lines.js"});
vm.runInContext(fs.readFileSync(path.join(REPO,"js","map","map.js"),"utf8"),sb,{filename:"js/map/map.js"});
const MAP=sb.MAP,ML=sb.MAPLINES,S2=MAP.LODS[2].S,CLS={};
for(const l of MAP.LAYERS)if(l.cls)CLS[l.key]=l.cls;

// --- c45 (the decoder is DECODER below / js/map/map.js) ---
const enc=MAP.c45.enc;
const encPts=P=>{const o=[P.length];let x=0,y=0;for(const p of P){o.push(p[0]-x,p[1]-y);x=p[0];y=p[1]}return enc(o)};
const deltas=a=>{const o=[];let v=0;for(const x of a){o.push(x-v);v=x}return o};

// --- geometry ---
function dpKeep(P,tol,keep=new Uint8Array(P.length)){ // Douglas–Peucker over an open run (ends kept) → keep flags
  keep[0]=keep[P.length-1]=1;const st=[[0,P.length-1]];
  while(st.length){const [i,j]=st.pop();let dm=0,k=-1;for(let m=i+1;m<j;m++){const d=G.segDist(P[m],P[i],P[j])[0];if(d>dm){dm=d;k=m}}if(dm>tol){keep[k]=1;st.push([i,k],[k,j])}}
  return keep;
}
function dpRing(r,tol,pin){ // closed ring (open form) → simplified; pin(p): vertices kept (tile edges), else the two farthest-apart anchors
  const n=r.length,a=[];for(let i=0;i<n;i++)if(pin&&pin(r[i]))a.push(i);
  if(a.length<2){const s=a.length?a[0]:0;let f=s,dm=-1;for(let i=0;i<n;i++){const d=G.dist(r[s],r[i]);if(d>dm){dm=d;f=i}}a.length=0;if(f===s)return r.slice();a.push(Math.min(s,f),Math.max(s,f))}
  const out=[];
  for(let k=0;k<a.length;k++){const i=a[k],j=k+1<a.length?a[k+1]:a[0]+n,run=[];for(let m=i;m<=j;m++)run.push(r[m%n]);
    const kp=dpKeep(run,tol);for(let m=0;m<run.length-1;m++)if(kp[m])out.push(run[m])}
  return out;
}
const qp=(p,q)=>[Math.round(p[0]/q),Math.round(p[1]/q)];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
function cleanRing(r){ // quantized ring → no repeats, no spikes, no collinear points (the filled shape does not change); null if < 3
  let o=r.slice(),ch=true;
  while(ch&&o.length>=3){ch=false;const n=o.length,out=[];
    for(let i=0;i<n;i++){const a=out.length?out[out.length-1]:o[n-1],b=o[i],c=o[(i+1)%n];
      if((a[0]===b[0]&&a[1]===b[1])||cross(a,b,c)===0){ch=true;continue}out.push(b)}
    o=out}
  return o.length>=3?o:null;
}
function cleanLine(P){const o=[];for(const p of P){const l=o[o.length-1];if(l&&l[0]===p[0]&&l[1]===p[1])continue;
  if(o.length>=2&&cross(o[o.length-2],l,p)===0&&(l[0]-o[o.length-2][0])*(p[0]-l[0])+(l[1]-o[o.length-2][1])*(p[1]-l[1])>=0)o[o.length-1]=p;else o.push(p)}return o}
const morton=(x,y)=>{let z=0;for(let b=0;b<16;b++)z+=(((x>>b)&1)*2**(2*b))+(((y>>b)&1)*2**(2*b+1));return z};
const mortonKey=p=>morton((p[0]>>2)+32768&65535,(p[1]>>2)+32768&65535);   // (4-quanta cells, 192 m)

// --- tracks: cut to the end stations, stations kept as vertices ---
function track(id){
  const L=MAP.line(id),st=L.st,n=st.length,s0=st[0],s1=st[n-1],E=[];
  for(let i=0;i<n;i++)E.push({s:st[i],p:MAP.at(id,st[i]),stn:i});
  for(let k=0;k<L.pts.length;k++)if(L.cum[k]>s0&&L.cum[k]<s1&&!st.some(s=>Math.abs(s-L.cum[k])<.5))E.push({s:L.cum[k],p:L.pts[k]});
  E.sort((a,b)=>a.s-b.s||(a.stn===undefined)-(b.stn===undefined));
  const keep=new Uint8Array(E.length),P=E.map(e=>e.p);let a=0;
  for(let k=1;k<E.length;k++)if(E[k].stn!==undefined){dpKeep(P.slice(a,k+1),TR).forEach((v,m)=>{if(v)keep[a+m]=1});a=k}
  const pts=[],sidx=[];
  E.forEach((e,k)=>{if(!keep[k])return;const q=qp(e.p,QT),l=pts[pts.length-1];
    if(!l||l[0]!==q[0]||l[1]!==q[1])pts.push(q);else if(e.stn!==undefined&&sidx.length&&sidx[sidx.length-1]===pts.length-1)throw new Error(id+": stations "+(e.stn-1)+" and "+e.stn+" share a vertex");
    if(e.stn!==undefined)sidx.push(pts.length-1)});
  const o={p:encPts(pts),s:enc(deltas(sidx))};
  if(L.close){const kp=dpKeep(L.close,TR),c=cleanLine(L.close.filter((p,i)=>kp[i]).map(p=>qp(p,QT)));c[0]=pts[pts.length-1];c[c.length-1]=pts[0];o.c=encPts(c);o.loop=1}
  return {o,n:pts.length,st:sidx.length};
}
const lines={},TK={pts:0};
for(const id of Object.keys(ML.lines)){const t=track(id);lines[id]=t.o;TK.pts+=t.n}
const extra=(ML.extra||[]).map(e=>{const P=MAP.c45.pts(e.pts),kp=dpKeep(P,TR),q=cleanLine(P.filter((p,i)=>kp[i]).map(p=>qp(p,QT)));TK.pts+=q.length;
  return Object.assign({key:e.key},e.branch?{branch:1}:{},{p:encPts(q)})});

// --- river lanes ---
const LN={pts:0};
const lanes=MAP.lanes().map(l=>{const kp=dpKeep(l.pts,TL),P=[],W=[];
  l.pts.forEach((p,i)=>{if(!kp[i])return;const q=qp(p,Q),w=Math.max(1,Math.round(l.w[i]/WQ)),z=P[P.length-1];if(z&&z[0]===q[0]&&z[1]===q[1]){W[W.length-1]=Math.max(W[W.length-1],w);return}P.push(q);W.push(w)});
  LN.pts+=P.length;return P.length>1?{zh:l.zh,width:l.width,p:encPts(P),w:enc(deltas(W))}:null}).filter(Boolean);

// --- the city tiles, one at a time ---
const t2=path.join(DIR,"t2"),keys=fs.readdirSync(t2).map(f=>f.match(/^(-?\d+)_(-?\d+)\.js$/)).filter(Boolean).map(m=>[+m[1],+m[2]]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
const RAW={w:[],g:[],u:[],ur:[],r:[]},EXT=[1e9,1e9,-1e9,-1e9];
for(const [tx,ty] of keys){
  const key=tx+"_"+ty,R=[tx*S2,ty*S2,tx*S2+S2,ty*S2+S2];
  vm.runInContext(fs.readFileSync(path.join(t2,key+".js"),"utf8"),sb,{filename:"t2/"+key+".js"});
  const f=MAP.query(R,2);for(let j=0;j<4;j++)EXT[j]=j<2?Math.min(EXT[j],R[j]):Math.max(EXT[j],R[j]);
  for(const x of f.water)RAW.w.push({c:x.c,p:x.p,R});
  for(const x of f.green)RAW.g.push({c:x.c,p:x.p});
  for(const x of f.landuse)if(URBAN.test(x.c))RAW.u.push({p:x.p});
  for(const x of f.roads){RAW.ur.push(x.pts);if(ROADS.includes(x.c))RAW.r.push({c:x.c,pts:x.pts})}
  MAP.clear();
}

// --- water: pieces joined by their seam points for the area test, thin ones dropped, simplified with the seams kept ---
function waterOf(pieces){
  const onEdge=(p,R)=>p[0]===R[0]||p[0]===R[2]||p[1]===R[1]||p[1]===R[3],par=pieces.map((_,i)=>i),seen=new Map();
  const find=i=>{while(par[i]!==i)i=par[i]=par[par[i]];return i};
  pieces.forEach((f,i)=>{f.a=Math.abs(G.signedArea(f.p[0]))-f.p.slice(1).reduce((s,r)=>s+Math.abs(G.signedArea(r)),0);
    f.l=f.p[0].reduce((s,p,k,r)=>s+(onEdge(p,f.R)&&onEdge(r[(k+1)%r.length],f.R)?0:G.dist(p,r[(k+1)%r.length])),0);   // (bank length: seams left out)
    for(const p of f.p[0])if(onEdge(p,f.R)){const k=p[0]+","+p[1],j=seen.get(k);if(j===undefined)seen.set(k,i);else par[find(i)]=find(j)}});
  const tot=new Map();pieces.forEach((f,i)=>{const r=find(i),t=tot.get(r)||{a:0,l:0};t.a+=f.a;t.l+=f.l;tot.set(r,t)});
  const out=[],st={in:pieces.length,small:0,thin:0,holes:0,gone:0};
  pieces.forEach((f,i)=>{const t=tot.get(find(i));
    if(f.c!=="sea"){if(t.a<T.WMIN){st.small++;return}if(2*t.a/t.l<T.WTHIN){st.thin++;return}}   // (2·area / bank length = the mean width)
    const pin=p=>onEdge(p,f.R),rings=[];
    f.p.forEach((r,k)=>{if(k&&Math.abs(G.signedArea(r))<T.WMIN){st.holes++;return}
      let q=cleanRing(dpRing(r,TW,pin).map(p=>qp(p,Q)));if(!q)return;const A=G.signedArea(q);if(!A)return;
      if((k===0)!==(A>0))q=q.reverse();if(k===0||rings.length)rings.push(q)});
    if(!rings.length){st.gone++;return}
    out.push({c:CLS.w.indexOf(f.c),p:rings});
  });
  return {out,st};
}
const W=waterOf(RAW.w);

// --- green, urban: evidence rasterised in Q m cells → share of it within a (2r + 1)² window ≥ t → specks / holes < MMIN flipped → traced ---
const X0=Math.floor(EXT[0]/Q),Y0=Math.floor(EXT[1]/Q),GW=Math.ceil(EXT[2]/Q)-X0,GH=Math.ceil(EXT[3]/Q)-Y0;
function rasterize(feats,m=new Uint8Array(GW*GH)){ // even-odd per feature at cell centres, union over features (as tools/lib/osm-geom.js raster)
  const ox=X0*Q,oy=Y0*Q;
  for(const f of feats){
    const b=G.bboxOf(f.p[0]),edges=[];for(const r of f.p)for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length];if(a[1]!==c[1])edges.push(a[1]<c[1]?[a[0],a[1],c[0],c[1]]:[c[0],c[1],a[0],a[1]])}
    edges.sort((p,q)=>p[1]-q[1]);let k=0,act=[];
    for(let j=Math.max(0,Math.floor((b[1]-oy)/Q));j<=Math.min(GH-1,Math.ceil((b[3]-oy)/Q));j++){
      const y=oy+(j+.5)*Q,xs=[];while(k<edges.length&&edges[k][1]<=y)act.push(edges[k++]);act=act.filter(e=>e[3]>y);
      for(const e of act)xs.push(e[0]+(y-e[1])*(e[2]-e[0])/(e[3]-e[1]));xs.sort((a,c)=>a-c);
      for(let i=0;i+1<xs.length;i+=2)for(let x=Math.max(0,Math.ceil((xs[i]-ox)/Q-.5));x<=Math.min(GW-1,Math.floor((xs[i+1]-ox)/Q-.5));x++)m[j*GW+x]=1}
  }
  return m;
}
function strokes(lines,m){ // the cells every polyline passes through
  for(const P of lines)for(let k=1;k<P.length;k++){const a=P[k-1],b=P[k],n=Math.ceil(G.dist(a,b)/(Q/2));
    for(let t=0;t<=n;t++){const i=Math.floor((a[0]+(b[0]-a[0])*t/n)/Q)-X0,j=Math.floor((a[1]+(b[1]-a[1])*t/n)/Q)-Y0;if(i>=0&&j>=0&&i<GW&&j<GH)m[j*GW+i]=1}}
  return m;
}
function sieve(m,val,min){ // 4-connected components of cells == val smaller than min cells flip (val 0: only those off the border)
  const seen=new Uint8Array(m.length),st=[],cells=[];let n=0;
  for(let s=0;s<m.length;s++){if(seen[s]||m[s]!==val)continue;st.push(s);seen[s]=1;cells.length=0;let border=false;
    while(st.length){const c=st.pop(),i=c%GW,j=(c-i)/GW;cells.push(c);if(!i||!j||i===GW-1||j===GH-1)border=true;
      for(const d of [i>0?c-1:-1,i<GW-1?c+1:-1,j>0?c-GW:-1,j<GH-1?c+GW:-1])if(d>=0&&!seen[d]&&m[d]===val){seen[d]=1;st.push(d)}}
    if(cells.length<min&&!(val===0&&border)){for(const c of cells)m[c]=1-val;n++}}
  return n;
}
function general(ev,r,t){ // box share of the evidence (summed-area table; the window is cut at the grid edge)
  const S=new Int32Array((GW+1)*(GH+1)),m=new Uint8Array(GW*GH);
  for(let j=0;j<GH;j++){let row=0;for(let i=0;i<GW;i++){row+=ev[j*GW+i];S[(j+1)*(GW+1)+i+1]=S[j*(GW+1)+i+1]+row}}
  for(let j=0;j<GH;j++){const j0=Math.max(0,j-r),j1=Math.min(GH,j+r+1);for(let i=0;i<GW;i++){const i0=Math.max(0,i-r),i1=Math.min(GW,i+r+1);
    const s=S[j1*(GW+1)+i1]-S[j0*(GW+1)+i1]-S[j1*(GW+1)+i0]+S[j0*(GW+1)+i0];m[j*GW+i]=s>=t*(j1-j0)*(i1-i0)?1:0}}
  return m;
}
function trace(m){ // cell edges with the inside on the left → rings of corner points in Q quanta (outer CCW, holes CW; saddles split: 4-connected)
  const CW=GW+1,N=CW*(GH+1),o1=new Int8Array(N).fill(-1),o2=new Int8Array(N).fill(-1),used=new Uint8Array(N*4),DX=[1,0,-1,0],DY=[0,1,0,-1];
  const at=(i,j)=>i>=0&&j>=0&&i<GW&&j<GH&&m[j*GW+i]===1,add=(i,j,d)=>{const k=j*CW+i;if(o1[k]<0)o1[k]=d;else o2[k]=d};
  for(let j=0;j<GH;j++)for(let i=0;i<GW;i++)if(m[j*GW+i]){if(!at(i,j-1))add(i,j,0);if(!at(i+1,j))add(i+1,j,1);if(!at(i,j+1))add(i+1,j+1,2);if(!at(i-1,j))add(i,j+1,3)}
  const rings=[];
  for(let k0=0;k0<N;k0++)for(const d0 of [o1[k0],o2[k0]]){if(d0<0||used[k0*4+d0])continue;
    const ring=[];let k=k0,d=d0,pd=-1;
    while(!used[k*4+d]){used[k*4+d]=1;if(d!==pd)ring.push([X0+k%CW,Y0+Math.floor(k/CW)]);pd=d;
      k=k+DX[d]+DY[d]*CW;d=o2[k]<0?o1[k]:(o1[k]===(pd+1)%4?o1[k]:o2[k])}
    if(d===pd&&ring.length)ring.shift();rings.push(ring)}
  return rings;
}
function maskAreas(m,c,st){ // → [{c, p:[outer, ...holes]}] in Q quanta, DP TM m
  const minC=Math.ceil(T.MMIN/Q/Q);st.specks=sieve(m,1,minC);st.holes=sieve(m,0,minC);st.km2=m.reduce((s,v)=>s+v,0)*Q*Q/1e6;
  const outer=[],holes=[];
  for(const r of trace(m)){const q=cleanRing(dpRing(r,TM/Q));if(!q)continue;const A=G.signedArea(q);if(!A)continue;(A>0?outer:holes).push(q)}
  const own=outer.map(r=>({c,p:[r],a:G.signedArea(r),bb:G.bboxOf(r)})).sort((a,b)=>a.a-b.a);   // a hole → the smallest outer ring holding it
  for(const h of holes){const p=[h[0][0]+.25,h[0][1]+.25],o=own.find(o=>p[0]>=o.bb[0]&&p[0]<=o.bb[2]&&p[1]>=o.bb[1]&&p[1]<=o.bb[3]&&G.pointInRing(p,o.p[0]));if(o)o.p.push(h);else st.lost=(st.lost||0)+1}
  return own.map(o=>({c,p:o.p}));
}
const U={raw:0},GS={};
const uev=strokes(RAW.ur,rasterize(RAW.u));U.raw=uev.reduce((s,v)=>s+v,0)*Q*Q/1e6;
const UR=maskAreas(general(uev,T.UR,T.UT),0,U);
const GC=Object.keys(GREEN),GRN=[];
for(const c of GC){GS[c]={};const re=new RegExp("^("+GREEN[c].replace(/ /g,"|")+")$");GRN.push(...maskAreas(general(rasterize(RAW.g.filter(f=>re.test(f.c))),T.GR,T.GT),GC.indexOf(c),GS[c]))}

// --- roads: pieces joined where exactly two ends meet (same class), networks < RMIN m dropped, the second carriageway dropped ---
const RD={in:RAW.r.length};
const RO=(()=>{
  const P=RAW.r.map(f=>({c:f.c,pts:f.pts.slice(),on:true})),ends=new Map(),K=p=>p[0]+","+p[1];
  P.forEach((f,i)=>{for(const e of [0,1]){const k=K(e?f.pts[f.pts.length-1]:f.pts[0]);if(!ends.has(k))ends.set(k,[]);ends.get(k).push(i)}});
  const out=[];
  for(let i=0;i<P.length;i++){if(!P[i].on)continue;let pts=P[i].pts;P[i].on=false;
    for(const back of [false,true])for(;;){const e=back?pts[0]:pts[pts.length-1],l=ends.get(K(e));if(l.length!==2)break;
      const j=l[0]===i||!P[l[0]].on?l[1]:l[0];if(!P[j].on||P[j].c!==P[i].c)break;P[j].on=false;
      let q=P[j].pts;const qs=K(q[0])===K(e);if(back)q=qs?q.slice().reverse():q;else q=qs?q:q.slice().reverse();
      pts=back?q.concat(pts.slice(1)):pts.concat(q.slice(1))}
    out.push({c:P[i].c,pts})}
  const par=new Map(),find=k=>{while(par.get(k)!==k){par.set(k,par.get(par.get(k)));k=par.get(k)}return k};
  for(const f of out)for(const p of [f.pts[0],f.pts[f.pts.length-1]])if(!par.has(K(p)))par.set(K(p),K(p));
  for(const f of out){const a=find(K(f.pts[0])),b=find(K(f.pts[f.pts.length-1]));if(a!==b)par.set(a,b)}
  const len=new Map();for(const f of out){f.len=G.plen(f.pts);const r=find(K(f.pts[0]));len.set(r,(len.get(r)||0)+f.len)}
  RD.chains=out.length;
  // the second carriageway: stretches ≤ DD m from, and within DA° of, a road kept before (motorway first, long first) are dropped
  const C=400,grid=new Map(),cos=Math.cos(T.DA*Math.PI/180),kept=[];
  const addSeg=(a,b)=>{const u=[(b[0]-a[0])/(G.dist(a,b)||1),(b[1]-a[1])/(G.dist(a,b)||1)];
    for(let x=Math.floor((Math.min(a[0],b[0])-T.DD)/C);x<=Math.floor((Math.max(a[0],b[0])+T.DD)/C);x++)for(let y=Math.floor((Math.min(a[1],b[1])-T.DD)/C);y<=Math.floor((Math.max(a[1],b[1])+T.DD)/C);y++){
      const k=x+","+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push([a,b,u])}};
  const cover=(p,u)=>{const l=grid.get(Math.floor(p[0]/C)+","+Math.floor(p[1]/C));if(l)for(const [a,b,v] of l)if(Math.abs(u[0]*v[0]+u[1]*v[1])>=cos&&G.segDist(p,a,b)[0]<=T.DD)return true;return false};
  const sub=(P,cum,s0,s1)=>{const at=s=>{let i=1;while(i<P.length-1&&cum[i]<s)i++;const t=(s-cum[i-1])/((cum[i]-cum[i-1])||1);return [P[i-1][0]+t*(P[i][0]-P[i-1][0]),P[i-1][1]+t*(P[i][1]-P[i-1][1])]};
    const o=[at(s0)];for(let i=0;i<P.length;i++)if(cum[i]>s0&&cum[i]<s1)o.push(P[i]);o.push(at(s1));return o};
  const big=out.filter(f=>len.get(find(K(f.pts[0])))>=T.RMIN).sort((a,b)=>ROADS.indexOf(a.c)-ROADS.indexOf(b.c)||b.len-a.len||a.pts[0][0]-b.pts[0][0]||a.pts[0][1]-b.pts[0][1]);
  RD.big=big.length;
  for(const f of big){const P=f.pts,cum=G.along(P),L=cum[cum.length-1],n=Math.max(1,Math.ceil(L/(Q/2))),cv=[];
    for(let t=0;t<=n;t++){const s=L*t/n;let i=1;while(i<P.length-1&&cum[i]<s)i++;const a=P[i-1],b=P[i],d=G.dist(a,b)||1,u=[(b[0]-a[0])/d,(b[1]-a[1])/d],w=(s-cum[i-1])/d;cv.push(cover([a[0]+w*(b[0]-a[0]),a[1]+w*(b[1]-a[1])],u))}
    for(let t=0;t<=n;){if(cv[t]){t++;continue}let e=t;while(e<n&&!cv[e+1])e++;
      const s0=L*Math.max(0,t-1)/n,s1=L*Math.min(n,e+1)/n;if(s1-s0>=T.DMIN||(t===0&&e===n)){const q=sub(P,cum,s0,s1);kept.push({c:f.c,pts:q});for(let i=1;i<q.length;i++)addSeg(q[i-1],q[i])}
      t=e+1}}
  RD.kept=kept.length;
  return kept.map(f=>{const kp=dpKeep(f.pts,TD),q=cleanLine(f.pts.filter((p,i)=>kp[i]).map(p=>qp(p,Q)));return q.length>1?{c:ROADS.indexOf(f.c),pts:q}:null}).filter(Boolean);
})();

// --- encode ---
const byMorton=(a,b)=>a.k-b.k||a.c-b.c||a.s.localeCompare(b.s);
function encAreas(F){
  const L=F.map(f=>({k:mortonKey(f.p[0][0]),c:f.c,f,s:f.p.map(r=>r.join(";")).join("|")})).sort(byMorton),o=[L.length];let x=0,y=0;
  for(const {f} of L){o.push(f.c*2+(f.p.length>1?1:0));if(f.p.length>1)o.push(f.p.length);
    for(const r of f.p){o.push(r.length);for(const p of r){o.push(p[0]-x,p[1]-y);x=p[0];y=p[1]}}}
  return enc(o);
}
function encLines(F){
  const L=F.map(f=>({k:mortonKey(f.pts[0]),c:f.c,f,s:f.pts.join(";")})).sort(byMorton),o=[L.length];let x=0,y=0;
  for(const {f} of L){o.push(f.c,f.pts.length);for(const p of f.pts){o.push(p[0]-x,p[1]-y);x=p[0];y=p[1]}}
  return enc(o);
}

/* The decoder, written into ov.js as it is (the file's header documents what it builds). */
function DECODER(root,D){
  'use strict';
  const DEC=new Uint8Array(128);for(let c=35,i=0;c<=125;c++)if(c!==92)DEC[c]=i++;
  const rd=s=>{let p=0;const f=()=>{let c=DEC[s.charCodeAt(p++)],v=0,m=1;while(c>=45){v+=(c-45)*m;m*=45;c=DEC[s.charCodeAt(p++)]}v+=c*m;return v%2?-(v+1)/2:v/2};
    f.end=()=>{if(p!==s.length)throw new Error('MAPOV: corrupt data');};f.more=()=>p<s.length;return f};
  const bbOf=(P,b)=>{b=b||[Infinity,Infinity,-Infinity,-Infinity];for(const p of P){if(p[0]<b[0])b[0]=p[0];if(p[1]<b[1])b[1]=p[1];if(p[0]>b[2])b[2]=p[0];if(p[1]>b[3])b[3]=p[1]}return b};
  const pl=(s,q)=>{const f=rd(s),n=f(),o=new Array(n);let x=0,y=0;for(let i=0;i<n;i++){x+=f();y+=f();o[i]=[x*q,y*q]}f.end();return o};
  const run=(s,q)=>{const f=rd(s),o=[];let v=0;while(f.more())o.push((v+=f())*q);return o};
  const layer=(s,cls,area)=>{const o=[];if(!s)return o;const f=rd(s),n=f(),q=D.q;let x=0,y=0;
    const pts=c=>{const P=new Array(c);for(let i=0;i<c;i++){x+=f();y+=f();P[i]=[x*q,y*q]}return P};
    for(let k=0;k<n;k++){const h=f();
      if(area){const nr=h&1?f():1,p=[];for(let r=0;r<nr;r++)p.push(pts(f()));o.push(cls?{c:cls[h>>1],p,bb:bbOf(p[0])}:{p,bb:bbOf(p[0])})}
      else{const P=pts(f());o.push({c:cls[h],pts:P,bb:bbOf(P)})}}
    f.end();return o};
  const M={v:D.v,source:D.source,osm:D.osm,origin:D.origin,mPerDegLat:D.mPerDegLat,mPerDegLon:D.mPerDegLon,q:D.q,ext:D.ext,lines:{},net:null};
  for(const id in D.lines){const o=D.lines[id],P=pl(o.p,D.qt),L={id,pts:P,st:run(o.s,1),loop:!!o.loop,close:o.c?pl(o.c,D.qt):null,bb:bbOf(P)};
    if(L.close)bbOf(L.close,L.bb);M.lines[id]=L;M.net=bbOf([[L.bb[0],L.bb[1]],[L.bb[2],L.bb[3]]],M.net)}
  M.extra=D.extra.map(e=>{const P=pl(e.p,D.qt);return Object.assign({key:e.key},e.branch?{branch:1}:{},{pts:P,bb:bbOf(P)})});
  M.lanes=D.lanes.map(l=>{const P=pl(l.p,D.q);return {zh:l.zh,width:l.width,w:run(l.w,D.wq),pts:P,bb:bbOf(P)}});
  M.water=layer(D.w,D.cls.w,1);M.green=layer(D.g,D.cls.g,1);M.urban=layer(D.u,null,1);M.roads=layer(D.r,D.cls.r,0);
  root.MAPOV=M;
}

// --- write, over budget: drop green, then roads ---
const L={w:encAreas(W.out),g:encAreas(GRN),u:encAreas(UR),r:encLines(RO)},dropped=[];
const js=o=>JSON.stringify(o).replace(/"([A-Za-z_]\w*)":/g,"$1:"),gzl=s=>zlib.gzipSync(s,{level:9}).length;
function build(){
  const D=`{v:1,source:${js(ML.source)},osm:${js(ML.osm||"")},origin:${js(ML.origin)},mPerDegLat:${ML.mPerDegLat},mPerDegLon:${ML.mPerDegLon},
q:${Q},qt:${QT},wq:${WQ},ext:${js(EXT)},
cls:${js({w:CLS.w,g:GC,r:ROADS})},
lines:{
${Object.entries(lines).map(([k,v])=>k+":"+js(v)).join(",\n")}
},
extra:[${extra.map(js).join(",\n")}],
lanes:[
${lanes.map(js).join(",\n")}
],
w:${js(L.w)},
g:${js(L.g)},
u:${js(L.u)},
r:${js(L.r)}}`;
  return `/* Generated by tools/pack-ov.js — do not edit by hand (format + tuning: its header). The overview map of the menu and of the
   end-of-ride whole-line view (48–512 m/px): the tracks, river lanes, water, large green, the built-up mask and motorway + trunk roads,
   from js/map/lines.js and the city tiles js/map/t2. Needs nothing else; decodes itself when it runs.
   API  MAPOV = {v, source, osm, origin: {lat, lon}, mPerDegLat, mPerDegLon, q, ext, net, lines, extra, lanes, water, green, urban, roads}
     metres, integers: x east / y NORTH of origin (广州塔 station), the tiles' grid (js/map/map.js); a lat/lon (js/boundaries.js) is at
     x = (lon − origin.lon)·mPerDegLon, y = (lat − origin.lat)·mPerDegLat. ext = [x0, y0, x1, y1] of the land data (beyond: plain land);
     net = the tracks' bbox; q = the quantum of everything but the tracks (48 m).
     lines.<id> = {id, pts: [[x, y]…], st: [the vertex of each js/data.js station, in its order], loop, close: the loop's closing arc
       (pts end → pts[0]) | null, bb}: a track from its first to its last station, stations exact vertices (≤ 60 m from js/geo.js)
     extra = [{key, branch?, pts, bb}] (non-playable branches)   lanes = [{zh, width, w: [m at each point], pts, bb}] (river centre lines)
     water = [{c: 'river'|'lake'|'sea', p: [outer, ...holes], bb}]   green = [{c: 'park'|'forest', p, bb}]
     urban = [{p, bb}] (built-up land)   roads = [{c: 'motorway'|'trunk', pts, bb}]
     Rings: ≥ 3 points, not closed by a repeated point, outer CCW / holes CW (y north); area pieces cut by the 16 km tile grid meet exactly.
   Map data © OpenStreetMap contributors, ODbL 1.0 — openstreetmap.org/copyright */
(${DECODER.toString()})(typeof window!=='undefined'?window:globalThis,${D});
`;
}
let txt=build(),gz=gzl(txt);
const BUDGET=G.BUDGET.ov;
if(gz>BUDGET){dropped.push("green");L.g="";txt=build();gz=gzl(txt)}
if(gz>BUDGET){dropped.push("roads");L.r="";txt=build();gz=gzl(txt)}

// --- verify: decode what is written, as the page will ---
const vb={};vb.window=vb;vm.createContext(vb);const td=performance.now();vm.runInContext(txt,vb,{filename:"ov.js"});const decMs=performance.now()-td,O=vb.MAPOV;
for(const id of Object.keys(ML.lines)){const o=O.lines[id],Ln=MAP.line(id);if(!o)throw new Error("verify: "+id+" missing");
  if(o.st.length!==Ln.st.length)throw new Error("verify: "+id+" has "+o.st.length+" stations, lines.js "+Ln.st.length);
  o.st.forEach((v,i)=>{const d=G.dist(o.pts[v],MAP.at(id,Ln.st[i]));if(d>QT)throw new Error("verify: "+id+" station "+i+" moved "+d.toFixed(1)+" m")})}
if(O.water.length!==W.out.length||O.urban.length!==UR.length||O.green.length!==(L.g?GRN.length:0)||O.roads.length!==(L.r?RO.length:0))throw new Error("verify: feature counts differ");
const old=fs.existsSync(OUT)?fs.readFileSync(OUT,"utf8"):null;if(old!==txt)fs.writeFileSync(OUT,txt);

// --- report ---
const npts=F=>F.reduce((s,f)=>s+(f.p?f.p.reduce((a,r)=>a+r.length,0):f.pts.length),0);
const part=(nm,s,extraTxt)=>`  ${nm.padEnd(6)} ${kb(Buffer.byteLength(s)).padStart(9)} raw ${kb(gzl(s)).padStart(8)} gz  ${extraTxt}`;
const linesTxt=Object.values(lines).map(js).join("")+extra.map(js).join(""),lanesTxt=lanes.map(js).join("");
console.log(`pack-ov ${path.relative(REPO,OUT)}: ${kb(Buffer.byteLength(txt))} raw / ${kb(gz)} gz (budget ${kb(BUDGET)})${dropped.length?" — dropped "+dropped.join(", ")+" to fit":""}${old===txt?" · unchanged":""}`);
console.log(part("lines",linesTxt,`${Object.keys(lines).length} tracks + ${extra.length} extra, ${TK.pts} points (DP ${TR} m, ${QT} m quanta, stations kept)`));
console.log(part("lanes",lanesTxt,`${lanes.length} river lanes, ${LN.pts} points (DP ${TL} m)`));
console.log(part("water",L.w,`${W.out.length} pieces, ${npts(W.out)} points (of ${W.st.in}: ${W.st.small} < ${T.WMIN/1e4} ha, ${W.st.thin} < ${T.WTHIN} m wide, ${W.st.holes} holes dropped, ${W.st.gone} vanished; DP ${TW} m)`));
const ms=o=>`${o.km2.toFixed(0)} km², ${o.specks} specks / ${o.holes} holes < ${T.MMIN/1e4} ha${o.lost?", "+o.lost+" holes without an outer ring":""}`;
console.log(part("green",L.g,`${GRN.length} areas, ${npts(GRN)} points (${GC.map(c=>c+" "+ms(GS[c])).join(" · ")}; DP ${TM} m)${dropped.includes("green")?" DROPPED":""}`));
console.log(part("urban",L.u,`${UR.length} areas, ${npts(UR)} points (evidence ${U.raw.toFixed(0)} km² → ${ms(U)}; DP ${TM} m)`));
console.log(part("roads",L.r,`${RO.length} chains, ${npts(RO)} points (${RD.in} tile pieces → ${RD.chains} chains → ${RD.big} in networks ≥ ${T.RMIN/1e3} km → ${RD.kept} after the second carriageways; DP ${TD} m)${dropped.includes("roads")?" DROPPED":""}`));
const nb=O.net;console.log(`  decode ${decMs.toFixed(1)} ms (node vm) · net bbox x ${(nb[0]/1e3).toFixed(1)}…${(nb[2]/1e3).toFixed(1)} km, y ${(nb[1]/1e3).toFixed(1)}…${(nb[3]/1e3).toFixed(1)} km (${((nb[2]-nb[0])/1e3).toFixed(1)} × ${((nb[3]-nb[1])/1e3).toFixed(1)} km) · land data ${EXT.map(v=>v/1e3).join(", ")} km · ${((Date.now()-t00)/1000).toFixed(1)} s`);
if(REPORT){const by=(F,cls)=>{const o={};for(const f of F){const k=cls?cls[f.c]:"urban";o[k]=(o[k]||0)+1}return JSON.stringify(o)};
  console.log("  water by class "+by(W.out,CLS.w)+" · green "+by(GRN,GC)+" · roads "+by(RO,ROADS));
  for(const id of Object.keys(lines))console.log(`  ${id}: ${O.lines[id].pts.length} points, ${O.lines[id].st.length} stations${O.lines[id].loop?" (loop)":""}`)}
if(gz>BUDGET){console.error(`ov.js ${kb(gz)} gz is over the budget ${kb(BUDGET)} even without green and roads`);process.exitCode=1}
