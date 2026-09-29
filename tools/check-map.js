#!/usr/bin/env node
/* Checks the packed pixel-ride map (tools/pack-map.js → js/map/): every tile decodes with js/map/map.js (the game's own decoder)
   and matches the MAPLINES.have lists; the header extent (e) is the decoded one; area rings are oriented (outer CCW, holes CW);
   clipped features stay inside their tile, buildings / chains sit in the tile of their bbox centre / arc midpoint; feature ids never
   collide; every playable station (js/geo.js position) is ≤ 60 m from its line's track at st[i], st increasing; hop track length ÷
   segKm outside 0.85–1.2 (tools/lib/osm-geom.js HOP_BAND) is a warning; sea that looks flipped is a warning (a tile all sea whose neighbours are ≥ 3 built land tiles
   without sea, ≥ 5 buildings — LOD1/LOD2: whole built land-use areas — or ≥ 500 m of road that is no bridge standing in the sea);
   size budgets (tools/lib/osm-geom.js BUDGET, as pack-map.js: network ≤ 16 MB raw, cold ride ≤ 1.5 MB gz (Line 3 ≤ 1.3 MB), the first
   frame from the views js/px/ride.js asks for, replayed, ≤ 160 KB gz); the fetch cache's missing cells (tools/.cache/map/manifest.json, or --cache /
   FETCH_MAP_CACHE).
   Usage: node tools/check-map.js [--dir=js/map] [--cache=DIR] [--strict]   (--strict: missing cache cells fail too) · exit 1 on any error.
   Dev-only, zero deps, Node ≥ 18. */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),zlib=require("zlib");
const G=require("./lib/osm-geom.js");
const REPO=path.join(__dirname,"..");
const args={};for(const a of process.argv.slice(2)){const m=a.match(/^--(dir|cache|strict)(?:=(.+))?$/);if(!m){console.error("usage: node tools/check-map.js [--dir=js/map] [--cache=DIR] [--strict]");process.exit(2)}args[m[1]]=m[2]===undefined?true:m[2]}
const CACHE=typeof args.cache==="string"?path.resolve(args.cache):process.env.FETCH_MAP_CACHE?path.resolve(process.env.FETCH_MAP_CACHE):path.join(__dirname,".cache","map");
const DIR=path.resolve(args.dir||path.join(REPO,"js","map")),NEAR=60,BIG=400,BUDGET=G.BUDGET,[HOP0,HOP1]=G.HOP_BAND;
const errs=[],warns=[],err=m=>{if(errs.length<60)errs.push(m);else errs.more=(errs.more||0)+1},warn=m=>warns.push(m),kb=v=>(v/1e3).toFixed(0)+" KB";
const t0=Date.now();

const sb={console,performance};sb.window=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(DIR,"lines.js"),"utf8"),sb,{filename:"lines.js"});
vm.runInContext(fs.readFileSync(path.join(REPO,"js","map","map.js"),"utf8"),sb,{filename:"js/map/map.js"});
const MAP=sb.MAP,ML=sb.MAPLINES,LODS=MAP.LODS,LAY=MAP.LAYERS;
const GEO=vm.runInNewContext(fs.readFileSync(path.join(REPO,"js","geo.js"),"utf8")+"\n;GEO",{});
const LINES=new Function(fs.readFileSync(path.join(REPO,"js","data.js"),"utf8").match(/\/\*__DATA__\*\/([\s\S]*)\/\*__END_DATA__\*\//)[1]+";return LINES;")();
const lineKey=ref=>ref==="GF"?"lgf":ref==="APM"?"lapm":"l"+ref;

// --- tiles ---
const have=ML.have.map(h=>{const a=MAP.c45.dec(h),o=new Set();let x=0,y=0;for(let i=1;i+1<a.length;i+=2){x+=a[i];y+=a[i+1];o.add(x+"_"+y)}return o});
const size=new Map(),ids=[],sids=new Map(),st={tiles:[0,0,0],feats:0,pts:0,rings:0,pieces:0,decMs:0};let raw=0,gz=0;
const SEA=LAY.find(l=>l.key==="w").cls.indexOf("sea"),BUILT=[0,1,2].map(i=>LAY.find(l=>l.key==="u").cls.indexOf(["residential","commercial","industrial"][i]));
const TI=[new Map(),new Map(),new Map()];   // per tile: sea area + rings, built land-use area, centres of buildings (LOD0) / built land use
const area=(XY,a,b)=>{let s=0;for(let k=a;k<b;k++){const j=k+1<b?k+1:a;s+=XY[2*k]*XY[2*j+1]-XY[2*j]*XY[2*k+1]}return s/2};
for(let lod=0;lod<3;lod++){
  const d=path.join(DIR,"t"+lod),files=fs.existsSync(d)?fs.readdirSync(d).filter(f=>/^-?\d+_-?\d+\.js$/.test(f)):[],on=new Set(files.map(f=>f.slice(0,-3)));
  for(const k of have[lod])if(!on.has(k))err(`t${lod}/${k}.js listed in lines.js but missing`);
  for(const k of on)if(!have[lod].has(k))err(`t${lod}/${k}.js not listed in lines.js have`);
  const {S,q}=LODS[lod];
  for(const f of files){
    const key=f.slice(0,-3),txt=fs.readFileSync(path.join(d,f),"utf8"),[tx,ty]=key.split("_").map(Number),R=[tx*S,ty*S,tx*S+S,ty*S+S];
    raw+=txt.length;const g=zlib.gzipSync(txt,{level:9}).length;gz+=g;size.set(lod+"/"+key,g);
    if(!txt.startsWith(`MAPT(${lod},"${key}",{`)){err(`t${lod}/${f}: header is not MAPT(${lod},"${key}",…)`);continue}
    const t1=performance.now();let T;try{vm.runInContext(txt,sb,{filename:f});T=MAP.tile(lod,key,true)}catch(e){err(`t${lod}/${f}: ${e.message}`);continue}st.decMs+=performance.now()-t1;
    if(!T||!T.dec){err(`t${lod}/${f}: not registered`);continue}
    const bad=LAY.filter((l,li)=>T.raw[l.key]&&!T.dec[li]).map(l=>l.key);if(bad.length)err(`t${lod}/${f}: layer ${bad.join(" ")} does not decode`);   // (map.js reads a corrupt layer as empty)
    const X=R.slice();T.dec.forEach(L=>{if(L)for(let f=0;f<L.n;f++)for(let j=0;j<4;j++)X[j]=j<2?Math.min(X[j],L.BB[4*f+j]):Math.max(X[j],L.BB[4*f+j])});
    if(X.join()!==T.ext.join())err(`t${lod}/${f}: header extent ${T.ext} ≠ decoded ${X}`);
    st.tiles[lod]++;ids.push([T.base,T.base+T.n,lod+"/"+key]);const ti={sea:0,rings:[],built:0,bc:[],road:0};TI[lod].set(key,ti);
    T.dec.forEach((L,li)=>{if(!L)return;const kind=LAY[li].kind,nm=`t${lod}/${key} ${LAY[li].key}`;
      for(let f=0;f<L.n;f++){
        st.feats++;const r0=L.FR[f],r1=L.FR[f+1],B=[L.BB[4*f],L.BB[4*f+1],L.BB[4*f+2],L.BB[4*f+3]];
        for(let r=r0;r<r1;r++){const a=L.RP[r],b=L.RP[r+1];st.rings++;st.pts+=b-a;
          if(kind==="area"||kind==="bld"){if(b-a<3){err(`${nm}#${f}: ring with ${b-a} points`);continue}
            const A=area(L.XY,a,b);if(r===r0?!(A>0):!(A<0))err(`${nm}#${f}: ring ${r-r0} ${r===r0?"outer not CCW":"hole not CW"} (area ${A})`)}
          else if(b-a<2)err(`${nm}#${f}: line with ${b-a} points`)}
        if(L.SID[f]>=0){const k=lod+"/"+LAY[li].key+"/"+L.SID[f],v=(L.SC?L.SC[2*f]+","+L.SC[2*f+1]:"")+"|"+(kind==="line"?L.H[f]%LAY[li].cls.length:L.H[f]>>2);
          if(!sids.has(k))sids.set(k,v);else if(sids.get(k)!==v)err(`${nm}#${f}: sid ${L.SID[f]} differs from its other pieces (${v} vs ${sids.get(k)})`);st.pieces++}
        if(kind==="area"||kind==="line"||(kind==="bld"&&L.SID[f]>=0)){                                // clipped: inside the tile
          if(B[0]<R[0]||B[1]<R[1]||B[2]>R[2]||B[3]>R[3])err(`${nm}#${f}: bbox ${B} outside the tile ${R}`)}
        else if(kind==="bld"){const cx=Math.floor((B[0]+B[2])/2/S),cy=Math.floor((B[1]+B[3])/2/S);if(cx!==tx||cy!==ty)err(`${nm}#${f}: bbox centre in tile ${cx}_${cy}`)}
        else{const P=[];for(let k=L.RP[r0];k<L.RP[r0+1];k++)P.push([L.XY[2*k],L.XY[2*k+1]]);const c=G.along(P),h=c[c.length-1]/2;let i=1;while(i<c.length-1&&c[i]<h)i++;
          const u=(h-c[i-1])/(c[i]-c[i-1]||1),mx=P[i-1][0]+u*(P[i][0]-P[i-1][0]),my=P[i-1][1]+u*(P[i][1]-P[i-1][1]);
          if(Math.floor(mx/S)!==tx||Math.floor(my/S)!==ty)err(`${nm}#${f}: chain midpoint ${Math.round(mx)},${Math.round(my)} outside the tile`);
          if(Math.abs(L.LEN[f]-c[c.length-1])>2)err(`${nm}#${f}: chain len ${L.LEN[f]} ≠ ${c[c.length-1].toFixed(0)}`);
          if(c[c.length-1]>4000+q*4)warn(`${nm}#${f}: chain ${c[c.length-1].toFixed(0)} m > 4 km`)}
        if(kind==="area"||kind==="line"||kind==="bld")for(let k=L.RP[r0];k<L.RP[r1];k++)if((L.XY[2*k]-R[0])%q||(L.XY[2*k+1]-R[1])%q){err(`${nm}#${f}: point off the ${q} m grid`);break}
        const lk=LAY[li].key,c=L.H[f]>>2;
        if((lk==="w"&&c===SEA)||(lk==="u"&&BUILT.includes(c)))for(let r=r0;r<r1;r++){const a=area(L.XY,L.RP[r],L.RP[r+1]);
          if(lk==="u")ti.built+=a;else{ti.sea+=a;const P=[];for(let k=L.RP[r];k<L.RP[r+1];k++)P.push([L.XY[2*k],L.XY[2*k+1]]);ti.rings.push(P)}}
        if(lod?lk==="u"&&BUILT.includes(c)&&L.SID[f]<0:lk==="b")ti.bc.push([(B[0]+B[2])/2,(B[1]+B[3])/2]);   // built things: buildings / whole built land use
        if(lk==="r"&&ti.rings.length&&!(Math.floor(L.H[f]/LAY[li].cls.length)&6))for(let k=L.RP[r0]+1;k<L.RP[r1];k++){   // roads (not bridge / tunnel) in the sea
          const p=[(L.XY[2*k-2]+L.XY[2*k])/2,(L.XY[2*k-1]+L.XY[2*k+1])/2];let n=0;for(const r of ti.rings)if(G.pointInRing(p,r))n++;
          if(n%2)ti.road+=Math.hypot(L.XY[2*k]-L.XY[2*k-2],L.XY[2*k+1]-L.XY[2*k-1])}
      }});
    MAP.clear();
  }
}
ids.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ids.length;i++)if(ids[i][0]<ids[i-1][1])err(`feature ids overlap: ${ids[i-1][2]} [${ids[i-1][0]},${ids[i-1][1]}) and ${ids[i][2]} from ${ids[i][0]}`);
if(ids.length&&ids[ids.length-1][1]>=2**31)err("feature ids ≥ 2^31");

// --- sea that looks flipped (a partial coastline decided a whole tile the wrong way) ---
let seaWarn=0;
for(let lod=0;lod<3;lod++){const A=LODS[lod].S**2,M=TI[lod];
  for(const [key,ti] of M){if(!ti.sea)continue;const [tx,ty]=key.split("_").map(Number);
    const inSea=p=>{let n=0;for(const r of ti.rings)if(G.pointInRing(p,r))n++;return n%2===1},wet=ti.bc.filter(inSea).length;   // (holes: even-odd)
    const land=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>{const o=M.get((tx+dx)+"_"+(ty+dy));return o&&!o.sea&&(lod?o.built>=.05*A:o.bc.length>=10)}).length;
    if(ti.sea>=.99*A&&land>=3){seaWarn++;warn(`t${lod}/${key}: all sea, but ${land} of its 4 neighbours are built land without sea (coastline side flipped?)`)}
    if(wet>=5||ti.road>=500){seaWarn++;warn(`t${lod}/${key}: ${wet} ${lod?"built land-use areas":"buildings"} and ${(ti.road/1000).toFixed(1)} km of road (no bridge) in the sea (${(100*ti.sea/A).toFixed(0)} % of the tile)`)}}}

// --- tracks ---
const lj=fs.readFileSync(path.join(DIR,"lines.js"));
let lineWarn=0;
for(const L of LINES){
  const o=ML.lines[L.id];if(!o){if(Object.keys(ML.lines).length>1)err(`${L.id}: no track in lines.js`);continue}
  const T=MAP.line(L.id),g=GEO.lines.find(x=>lineKey(x.ref)===L.id),n=L.st.length;
  if(T.st.length!==n){err(`${L.id}: ${T.st.length} arcs for ${n} stations`);continue}
  if(Math.abs(T.cum[T.cum.length-1]-T.len)>1)err(`${L.id}: len ${T.len} ≠ track ${T.cum[T.cum.length-1].toFixed(1)}`);
  let worst=0;
  for(let i=0;i<n;i++){
    const s=g.stations.find(x=>x.zh===L.st[i][0]);if(!s){err(`${L.id}: ${L.st[i][0]} not in geo.js`);continue}
    const p=G.P(s.lat,s.lon),a=MAP.at(L.id,T.st[i]),d=G.dist(p,a);worst=Math.max(worst,d);
    if(d>NEAR)err(`${L.id}: ${L.st[i][0]} is ${d.toFixed(0)} m from the track at st[${i}] = ${T.st[i]}`);
    if(i&&!(T.st[i]>T.st[i-1]))err(`${L.id}: st not increasing at ${i} (${T.st[i-1]} → ${T.st[i]})`);
    if(i&&L.segKm[i-1]){const r=(T.st[i]-T.st[i-1])/(L.segKm[i-1]*1000);if(r<HOP0||r>HOP1){lineWarn++;warn(`${L.id} hop ${i-1} ${L.st[i-1][0]}→${L.st[i][0]}: track ${((T.st[i]-T.st[i-1])/1000).toFixed(2)} km ÷ segKm ${L.segKm[i-1]} = ${r.toFixed(2)}`)}}
  }
  if(!!L.loop!==T.loop)err(`${L.id}: loop flag ${T.loop} vs data.js ${!!L.loop}`);
  if(T.loop){if(!T.close)err(`${L.id}: loop without close`);else{const a=T.close[0],b=T.close[T.close.length-1],z=T.pts[T.pts.length-1];
    if(G.dist(a,z)>1)err(`${L.id}: close does not start at the track end`);if(G.dist(b,T.pts[0])>1)err(`${L.id}: close does not end at the track start`)}}
  if(T.src!=="osm")warn(`${L.id}: track is a curve fallback`);
  st[L.id]=worst;
}

// --- budgets (as tools/pack-map.js) ---
const ljz=zlib.gzipSync(lj,{level:9}).length,net=raw+lj.length,bud=[];
if(net>BUDGET.net)err(`whole network ${(net/1e6).toFixed(2)} MB raw > ${BUDGET.net/1e6} MB`);
for(const b of G.budgets(MAP,ML,(lod,key)=>size.get(lod+"/"+key)||0,ljz)){
  if(b.ride>b.cap)err(`${b.id}: cold ride ${kb(b.ride)} gz > ${kb(b.cap)}`);
  if(b.first>BUDGET.first)err(`${b.id}: first frame ${kb(b.first)} gz > ${kb(BUDGET.first)} (${b.at})`);
  bud.push(`${b.id} ${kb(b.ride)} / ${kb(b.first)}`);
}

// --- the fetch cache ---
let cache="";
if(fs.existsSync(path.join(CACHE,"manifest.json"))&&fs.existsSync(path.join(CACHE,"routes.net.json"))){
  const M=JSON.parse(fs.readFileSync(path.join(CACHE,"manifest.json"),"utf8")),cov=G.fetchCoverage(M,GEO,JSON.parse(fs.readFileSync(path.join(CACHE,"routes.net.json"),"utf8")),CACHE);
  const miss=Object.values(cov.cells).reduce((s,c)=>s+c.missing.length,0),plan=Object.values(cov.cells).reduce((s,c)=>s+c.planned,0),lost=Object.values(cov.cells).reduce((s,c)=>s+c.lost,0);
  cache=`cache: ${plan-miss}/${plan} planned cells cached, ${miss} missing (${Object.entries(cov.cells).filter(([,c])=>c.missing.length).map(([k,c])=>k+" "+c.missing.length).join(", ")||"none"})${lost?`, ${lost} listed but their file is gone`:""}`;
  if(lost)err(`${lost} manifest cells point at missing files`);if(miss&&args.strict)err(`${miss} cache cells missing (--strict)`);
}else cache="cache: no tools/.cache/map/manifest.json (skipped)";

console.log(`check-map ${path.relative(REPO,DIR)||"."}: ${st.tiles.join("/")} tiles, ${st.feats} features (${st.pieces} tile-split pieces of ${sids.size} sources), ${st.rings} rings, ${st.pts} points decoded in ${st.decMs.toFixed(0)} ms (vm) · ${(raw/1e6).toFixed(2)} MB raw, ${(gz/1e6).toFixed(2)} MB gz + lines.js ${kb(lj.length)}/${kb(ljz)}`);
console.log(`tracks: ${Object.keys(ML.lines).length} (${Object.values(ML.lines).filter(l=>l.src==="osm").length} OSM), worst station offset ${Math.max(0,...LINES.map(l=>st[l.id]||0)).toFixed(1)} m, ${lineWarn} hop warnings`);
console.log(`budgets, gz (cold ride, cap ${kb(BUDGET.ride)}, ${Object.entries(BUDGET.rideOf).map(([k,v])=>k+" "+kb(v)).join(", ")} / first frame of the replayed ride views, cap ${kb(BUDGET.first)}; network ${(net/1e6).toFixed(2)} MB raw, cap ${(BUDGET.net/1e6).toFixed(0)} MB): ${bud.join(" · ")}`);
console.log(`sea: ${[0,1,2].map(l=>[...TI[l].values()].filter(t=>t.sea).length).join("/")} tiles with sea, ${seaWarn} suspicious`);
console.log(cache);
for(const w of warns)console.log("WARN "+w);
for(const e of errs)console.log("ERROR "+e);if(errs.more)console.log(`… ${errs.more} more errors`);
console.log(`${errs.length?errs.length+(errs.more||0)+" error(s)":"OK"} · ${warns.length} warning(s) · ${((Date.now()-t0)/1000).toFixed(1)} s`);
if(errs.length)process.exitCode=1;
