/* Shared zero-dep helpers for the pixel-map tools (tools/fetch-map.js, tools/pack-map.js): projection, OSM way/relation →
   ring/line assembly, Douglas–Peucker, clipping, feature classifiers, building heights, traffic chains and river lanes.
   Moved from mockups/pixel-ride/tools/fetch-l3.js with the same maths, so Line 3 packs exactly like the mockup's data/l3.js.
   Coordinates: metres east (x) / NORTH (y) of ORIGIN (广州塔 station), equirectangular; features are rounded to integers.
   Areas {c, p:[outer, ...holes]}: outer rings CCW, holes CW (y north); rings are open (no repeated first point).
   Element geometry may be Overpass `out geom` ([{lat,lon}]) or the compact `convert … ::geom=geom()` form
   ({type:"LineString",coordinates:[[lon,lat]]}) that tools/fetch-map.js caches for ways — pg() reads both.
   Data © OpenStreetMap contributors, ODbL 1.0. */
"use strict";

// --- projection (constants fixed so every tool and the mockup agree to the metre) ---
const ORIGIN={lat:23.10904,lon:113.31804},MLAT=110745.52,MLON=102439.97;
const P=(lat,lon)=>[(lon-ORIGIN.lon)*MLON,(lat-ORIGIN.lat)*MLAT];
const LL=(x,y)=>[ORIGIN.lat+y/MLAT,ORIGIN.lon+x/MLON];
const llBox=(R,dp=5)=>{const a=LL(R[0],R[1]),b=LL(R[2],R[3]);return [a[0],a[1],b[0],b[1]].map(v=>+v.toFixed(dp))}; // → [s,w,n,e]
const pg=g=>Array.isArray(g)?g.map(n=>P(n.lat,n.lon)):g&&g.coordinates?g.coordinates.map(c=>P(c[1],c[0])):[];
const normalize=e=>e.geometry&&!Array.isArray(e.geometry)&&e.geometry.coordinates // compact convert form → standard out geom
  ?Object.assign({},e,{geometry:e.geometry.coordinates.map(c=>({lat:c[1],lon:c[0]}))}):e;

// --- geometry (metres, y north) ---
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const signedArea=r=>{let a=0;for(let i=0,n=r.length;i<n;i++){const p=r[i],q=r[(i+1)%n];a+=p[0]*q[1]-q[0]*p[1]}return a/2};
const bboxOf=pts=>{const b=[1/0,1/0,-1/0,-1/0];for(const p of pts){if(p[0]<b[0])b[0]=p[0];if(p[1]<b[1])b[1]=p[1];if(p[0]>b[2])b[2]=p[0];if(p[1]>b[3])b[3]=p[1]}return b};
const hits=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
function segDist(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy;let t=L?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L:0;t=Math.max(0,Math.min(1,t));return [Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy),t]}
const rectPtDist=(R,p)=>Math.hypot(Math.max(R[0]-p[0],0,p[0]-R[2]),Math.max(R[1]-p[1],0,p[1]-R[3]));
function rectSegDist(R,a,b){ // 0 when the segment touches rect R=[x0,y0,x1,y1]
  if(clipLine([a,b],R).length)return 0;
  return Math.min(rectPtDist(R,a),rectPtDist(R,b),...[[R[0],R[1]],[R[2],R[1]],[R[0],R[3]],[R[2],R[3]]].map(c=>segDist(c,a,b)[0]));
}
function rdp(pts,tol){ // Douglas–Peucker, iterative
  if(pts.length<3)return pts.slice();
  const keep=new Uint8Array(pts.length),st=[[0,pts.length-1]];keep[0]=keep[pts.length-1]=1;
  while(st.length){const [i,j]=st.pop();let dm=0,k=-1;for(let m=i+1;m<j;m++){const d=segDist(pts[m],pts[i],pts[j])[0];if(d>dm){dm=d;k=m}}if(dm>tol){keep[k]=1;st.push([i,k],[k,j])}}
  return pts.filter((_,i)=>keep[i]);
}
const roundPts=pts=>{const o=[];for(const p of pts){const q=[Math.round(p[0]),Math.round(p[1])];const l=o[o.length-1];if(!l||l[0]!==q[0]||l[1]!==q[1])o.push(q)}return o};
function clipRing(ring,R){ // Sutherland–Hodgman against rect R=[x0,y0,x1,y1] (ring open, no repeated first point)
  let out=ring;
  for(const [ax,v,keepHigh] of [[0,R[0],1],[0,R[2],0],[1,R[1],1],[1,R[3],0]]){
    const inp=out;out=[];if(!inp.length)break;
    const inside=p=>keepHigh?p[ax]>=v:p[ax]<=v;
    for(let i=0;i<inp.length;i++){
      const a=inp[(i+inp.length-1)%inp.length],b=inp[i],ia=inside(a),ib=inside(b);
      if(ia!==ib){const t=(v-a[ax])/(b[ax]-a[ax]),q=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];q[ax]=v;out.push(q)}
      if(ib)out.push(b);
    }
  }
  return out;
}
function clipLine(pts,R){ // Liang–Barsky per segment → continuous pieces inside R
  const pieces=[];let cur=null;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1];let t0=0,t1=1,ok=true;
    for(const [p,q] of [[-dx,a[0]-R[0]],[dx,R[2]-a[0]],[-dy,a[1]-R[1]],[dy,R[3]-a[1]]]){
      if(p===0){if(q<0){ok=false;break}continue}
      const r=q/p;if(p<0){if(r>t1){ok=false;break}if(r>t0)t0=r}else{if(r<t0){ok=false;break}if(r<t1)t1=r}
    }
    if(!ok){cur=null;continue}
    const A=[a[0]+t0*dx,a[1]+t0*dy],B=[a[0]+t1*dx,a[1]+t1*dy];
    if(!cur||t0>0){cur=[A];pieces.push(cur)}
    cur.push(B);if(t1<1)cur=null;
  }
  return pieces;
}
// join ways (in relation order, any direction) into continuous pieces; a gap > `gap` m starts a new piece
function chain(ways,gap=2){
  const pieces=[];let cur=null;ways=ways.filter(w=>w.length>1);
  for(let i=0;i<ways.length;i++){
    let w=ways[i];
    if(!cur){const n=ways[i+1];
      if(n&&Math.min(dist(w[0],n[0]),dist(w[0],n[n.length-1]))<Math.min(dist(w[w.length-1],n[0]),dist(w[w.length-1],n[n.length-1])))w=w.slice().reverse();
      pieces.push(cur=w.slice());continue}
    const end=cur[cur.length-1];
    if(dist(w[w.length-1],end)<dist(w[0],end))w=w.slice().reverse();
    if(dist(w[0],end)>gap){cur=null;i--;continue}
    for(let k=1;k<w.length;k++)cur.push(w[k]);
  }
  return pieces;
}
// stitch multipolygon member ways into rings (open: no repeated first point); unclosable ends are closed if < 150 m apart
const assembleStats={open:0,dropped:0};
function assemble(ways,stats=assembleStats){
  const segs=ways.filter(w=>w.length>1).map(w=>w.slice()),rings=[],eq=(a,b)=>dist(a,b)<.05;
  while(segs.length){
    let r=segs.pop(),grew=true;
    while(grew&&!eq(r[0],r[r.length-1])){
      grew=false;
      for(let i=0;i<segs.length;i++){
        const s=segs[i],h=r[0],t=r[r.length-1];
        if(eq(s[0],t))r=r.concat(s.slice(1));else if(eq(s[s.length-1],t))r=r.concat(s.slice(0,-1).reverse());
        else if(eq(s[s.length-1],h))r=s.slice(0,-1).concat(r);else if(eq(s[0],h))r=s.slice().reverse().slice(0,-1).concat(r);
        else continue;
        segs.splice(i,1);grew=true;break;
      }
    }
    if(eq(r[0],r[r.length-1]))r.pop();
    else if(dist(r[0],r[r.length-1])<150)stats.open++;
    else{stats.dropped++;continue}
    if(r.length>=3)rings.push(r);
  }
  return rings;
}
function pointInRing(p,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
const centroid=r=>[r.reduce((s,p)=>s+p[0],0)/r.length,r.reduce((s,p)=>s+p[1],0)/r.length];
const plen=pts=>{let s=0;for(let i=1;i<pts.length;i++)s+=dist(pts[i-1],pts[i]);return s};
const along=pl=>{const cum=[0];for(let i=1;i<pl.length;i++)cum.push(cum[i-1]+dist(pl[i-1],pl[i]));return cum};
// nearest point of polyline pl (cum = along(pl)) to p → [offset m, metres along pl, [x,y] on pl]
const locate=(p,pl,cum)=>{let best=[1/0,0,p];for(let i=1;i<pl.length;i++){const [d,t]=segDist(p,pl[i-1],pl[i]);if(d<best[0])best=[d,cum[i-1]+t*(cum[i]-cum[i-1]),[pl[i-1][0]+t*(pl[i][0]-pl[i-1][0]),pl[i-1][1]+t*(pl[i][1]-pl[i-1][1])]]}return best};
function resample(pts,step){const out=[pts[0]];let carry=0;
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],l=dist(a,b);let s=step-carry;while(s<=l){out.push([a[0]+(b[0]-a[0])*s/l,a[1]+(b[1]-a[1])*s/l]);s+=step}carry=l-(s-step)}
  if(dist(out[out.length-1],pts[pts.length-1])>step/2)out.push(pts[pts.length-1]);return out}
function smoothPath(q,step=20){ // Catmull–Rom through points q, sampled every ~step m (track fallback where OSM has gaps)
  const out=[];
  for(let i=0;i<q.length-1;i++){const p0=q[Math.max(0,i-1)],p1=q[i],p2=q[i+1],p3=q[Math.min(q.length-1,i+2)],n=Math.max(2,Math.ceil(dist(p1,p2)/step));
    for(let k=0;k<n;k++){const t=k/n,t2=t*t,t3=t2*t;out.push([0,1].map(j=>.5*(2*p1[j]+(-p0[j]+p2[j])*t+(2*p0[j]-5*p1[j]+4*p2[j]-p3[j])*t2+(-p0[j]+3*p1[j]-3*p2[j]+p3[j])*t3)))}}
  out.push(q[q.length-1]);return out;
}

// --- OSM elements → features ---
// simplify tolerance (m) and minimum area (m²): fine detail vs coarse context (outside opts.fine)
const TOL={line3:1,metro:2,road:2,rail:2,area:1.5,building:.5,coarse:6};
const MIN_AREA={area:40,building:8,coarse:2500};
// closed way / multipolygon relation → [[outer,...holes], ...] (open rings, metres, unclipped), [] otherwise
function polysOf(e,stats=assembleStats){
  const t=e.tags||{};
  if(e.type==="way"){const g=pg(e.geometry);if(g.length<4||g[0][0]!==g[g.length-1][0]||g[0][1]!==g[g.length-1][1])return [];return [[g.slice(0,-1)]]}
  if(e.type!=="relation"||t.type!=="multipolygon")return [];
  const mw=role=>e.members.filter(m=>m.type==="way"&&m.geometry&&(role==="inner"?m.role==="inner":m.role!=="inner")).map(m=>pg(m.geometry));
  const polys=assemble(mw("outer"),stats).map(o=>[o]);
  for(const h of assemble(mw("inner"),stats)){const p=polys.find(q=>pointInRing(h[0],q[0]));if(p)p.push(h)}
  return polys;
}
// areas: closed ways + multipolygon relations → [{c, p:[outer,...holes], ...extra}], clipped to R (if given)
function areas(els,classify,{R,fine,tol=TOL.area,min=MIN_AREA.area,coarseTol=TOL.coarse,coarseMin=MIN_AREA.coarse,extra,stats}={}){
  const out=[];
  for(const e of els){
    const t=e.tags||{},c=classify(t);if(!c)continue;
    for(const rings of polysOf(e,stats)){
      const f=!fine||hits(bboxOf(rings[0]),fine),tl=f?tol:Math.max(tol,coarseTol),mn=f?min:Math.max(min,coarseMin);
      const done=[];
      for(let k=0;k<rings.length;k++){
        let r=R?clipRing(rings[k],R):rings[k];if(r.length<3){if(!k)break;continue}
        r=rdp(r.concat([r[0]]),tl);r=roundPts(r);if(r.length>1&&r[0][0]===r[r.length-1][0]&&r[0][1]===r[r.length-1][1])r.pop();
        const a=signedArea(r);
        if(r.length<3||Math.abs(a)<mn){if(!k)break;continue}
        if((k===0)!==(a>0))r.reverse();   // outer CCW, holes CW (y north)
        done.push(r);
      }
      if(done.length)out.push(Object.assign({c},extra&&extra(t,done,e),{p:done}));
    }
  }
  return out;
}
// OSM oneway → 1 (along the way), -1 (against it), 0; implied for motorways and roundabouts
function oneway(t){const v=t.oneway||"";if(v==="-1")return -1;if(/^(yes|1|true)$/.test(v))return 1;if(v)return 0;
  return /^motorway(_link)?$/.test(t.highway||"")||/^(roundabout|circular)$/.test(t.junction||"")?1:0}
// lines: open ways → [{c, pts, ...flags}], clipped to R (if given); flags b bridge, t tunnel/covered, link ramp, o one-way, n lanes
function lines(els,classify,{R,fine,tol=TOL.road,coarseTol=TOL.coarse}={}){
  const out=[];
  for(const e of els){
    if(e.type!=="way"||!e.geometry)continue;
    const t=e.tags||{},c=classify(t);if(!c)continue;
    const f={};
    if(t.bridge&&t.bridge!=="no")f.b=1;
    if(t.tunnel&&t.tunnel!=="no"||t.covered==="yes")f.t=1;
    if(/_link$/.test(t.highway||""))f.link=1;
    if(t.highway){const o=oneway(t),n=Math.round(parseFloat(t.lanes));if(o)f.o=o;if(n>0)f.n=n}
    const g=pg(e.geometry);
    for(const piece of R?clipLine(g,R):[g]){
      const tl=!fine||hits(bboxOf(piece),fine)?tol:Math.max(tol,coarseTol),pts=roundPts(rdp(piece,tl));
      if(pts.length>1)out.push(Object.assign({c},f,{pts}));
    }
  }
  return out;
}
// join lines of the same class/flags that meet end-to-end at a node shared by exactly two of them (OSM splits roads a lot);
// one-way pieces are only joined head-to-tail, so pts keep the OSM direction
function merge(feats,tol=TOL.road){
  const groups=new Map(),out=[],K=p=>p[0]+","+p[1];
  for(const f of feats){const k=[f.c,f.b,f.t,f.link,f.o,f.n].join("|");if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f)}
  for(const g of groups.values()){
    const ends=new Map(),used=new Uint8Array(g.length);
    g.forEach((f,i)=>{for(const p of [f.pts[0],f.pts[f.pts.length-1]]){const k=K(p);if(!ends.has(k))ends.set(k,[]);ends.get(k).push(i)}});
    for(let i=0;i<g.length;i++){
      if(used[i])continue;used[i]=1;let pts=g[i].pts.slice();
      for(let pass=0;pass<2;pass++){ // grow the tail, then flip and grow the other end
        for(let own=i;;){const a=ends.get(K(pts[pts.length-1]));if(!a||a.length!==2)break;
          const j=a[0]===own?a[1]:a[1]===own?a[0]:-1;if(j<0||used[j])break;
          let q=g[j].pts;const fw=K(q[0])===K(pts[pts.length-1]);if(g[i].o&&fw!==!pass)break;
          used[j]=1;if(!fw)q=q.slice().reverse();pts=pts.concat(q.slice(1));own=j}
        pts.reverse();
      }
      out.push(Object.assign({},g[i],{pts:roundPts(rdp(pts,tol))}));
    }
  }
  return out;
}
// polygon lookup: smallest feature (by outer area) containing a point, holes excluded
function areaIndex(feats,cell=500){const G=new Map(),A=new Map();feats.forEach(f=>{const b=bboxOf(f.p[0]);A.set(f,Math.abs(signedArea(f.p[0])));for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let y=Math.floor(b[1]/cell);y<=Math.floor(b[3]/cell);y++){const k=x+","+y;if(!G.has(k))G.set(k,[]);G.get(k).push(f)}});
  return p=>{let best=null,ba=1/0;for(const f of G.get(Math.floor(p[0]/cell)+","+Math.floor(p[1]/cell))||[]){if(!pointInRing(p,f.p[0])||f.p.slice(1).some(h=>pointInRing(p,h)))continue;const a=A.get(f);if(a<ba){ba=a;best=f}}return best}}

// --- classifiers: OSM tags → class code (null = not this layer) ---
const cWater=t=>t.natural==="water"?(/^(river|canal|stream|oxbow|ditch|drain|riverbank)$/.test(t.water||"")?"river":"lake")
  :t.waterway==="riverbank"?"river":/^(reservoir|basin)$/.test(t.landuse||"")?"lake":null;
const cCoast=t=>t.natural==="coastline"?"coast":null; // open ways, land on the left — needs coastline assembly, not areas()
const cGreen=t=>{const l=t.leisure,u=t.landuse,n=t.natural;
  return /^(pitch|track|playground)$/.test(l)?"pitch":l==="golf_course"?"golf"
    :/^(park|garden|recreation_ground|nature_reserve)$/.test(l)||/^(recreation_ground|village_green)$/.test(u)?"park"
    :/^(grass|meadow)$/.test(u)||/^(grassland|heath)$/.test(n)?"grass":u==="forest"||/^(wood|scrub)$/.test(n)?"forest"
    :n==="wetland"?"wetland":u==="cemetery"?"cemetery":null};
const cLand=t=>{const u=t.landuse||"",a=t.amenity||"";
  return u==="residential"?"residential":/^(commercial|retail)$/.test(u)?"commercial":u==="industrial"?"industrial"
    :/^(construction|brownfield|greenfield)$/.test(u)?"construction":u==="education"||/^(university|college|school|kindergarten)$/.test(a)?"education"
    :a==="hospital"||/^(religious|military)$/.test(u)?"civic":/^(farmland|orchard|farmyard|plant_nursery|greenhouse_horticulture)$/.test(u)?"farm"
    :u==="aquaculture"?"aquaculture":u==="railway"?"railway":t.place==="square"||(t.highway==="pedestrian"&&(t.area==="yes"||t.type==="multipolygon"))?"plaza":null};
const ROAD={motorway:"motorway",trunk:"trunk",primary:"primary",secondary:"secondary",tertiary:"tertiary",residential:"residential",
  unclassified:"residential",living_street:"residential",service:"service",pedestrian:"path",footway:"path",path:"path",cycleway:"path",steps:"path"};
const ROAD_RANK=["motorway","trunk","primary","secondary","tertiary","residential","service","path"];
const cRoad=t=>{if(t.area==="yes")return null;const h=(t.highway||"").replace(/_link$/,""),c=ROAD[h];
  if(c==="service"&&/^(parking_aisle|drive-through)$/.test(t.service||""))return null;
  if(h==="footway"&&/^(sidewalk|crossing)$/.test(t.footway||""))return null;
  return c||null};
const cRail=t=>{const r=t.railway||""; // GZ light_rail = trams (海珠/黄埔) + the tunnelled APM (drawn from the metro routes instead)
  if(r==="tram"||r==="light_rail")return t.tunnel==="yes"||/旅客自动输送/.test(t.name||"")?null:"tram";
  return /^(rail|narrow_gauge)$/.test(r)?(/^(yard|siding|spur|crossover)$/.test(t.service||"")?"siding":"rail"):null};
const cMetro=t=>t.railway==="subway"?"subway":null;
const cWaterway=t=>/^(river|canal)$/.test(t.waterway||"")?t.waterway:/^(stream|drain|ditch)$/.test(t.waterway||"")?"stream":null;
const cBuilding=t=>t.building&&t.building!=="no"?"b":null;
const cBridge=t=>t.man_made==="bridge"?"bridge":null;

// --- building heights (integer m) for EVERY building: OSM height / building:levels×3.2 when tagged, else a deterministic
// estimate from building type, landuse zone, footprint area/compactness and a hash of the footprint (same input → same h) ---
const ZONES=[["cbd",[-1150,600,1300,2250]],["tianhe",[-1300,2250,1600,4900]],["pazhou",[1500,-1100,7000,200]]]; // m: 珠江新城 core, 天河路/天河北, 琶洲 (tuned for Line 3)
const LM_BLD={cantonTower:[t=>t.man_made==="tower"&&/^广州塔$/.test(t.name||""),600],ifc:[t=>/^广州国际金融中心/.test(t.name||""),440],
  ctf:[t=>/^广州周大福金融中心/.test(t.name||""),530],operaHouse:[t=>/^广州大剧院$/.test(t.name||""),43],haixinsha:[null,24]}; // haixinsha = big footprints on the islet (stands + roof)
const hash01=r=>{let h=2166136261;for(const v of [r[0][0],r[0][1],r.length,r[r.length>>1][0],r[r.length>>1][1]]){h=Math.imul(h^(v&0xffff),16777619);h=Math.imul(h^(v>>>16&0xffff),16777619)}return (h>>>0)/4294967296};
function estHeight(t,ring,zone,lu){
  const a=Math.abs(signedArea(ring)),r=hash01(ring),b=t.building||"yes",comp=4*Math.PI*a/Math.pow(plen(ring.concat([ring[0]])),2);
  const lerp=(lo,hi,f)=>Math.round(lo+(hi-lo)*Math.max(0,Math.min(1,f)));
  const by=(lo,hi,a0,a1)=>lerp(lo,hi,.55*Math.log(Math.max(a,a0)/a0)/Math.log(a1/a0)+.45*r); // bigger footprint → taller, jittered by the hash
  if(/^(roof|carport|canopy|shelter|kiosk|hut|shed|garage|garages|toilets|gatehouse|guardhouse|service|cabin|container|ruins)$/.test(b))return lerp(3,6,r);
  if(b==="bridge")return lerp(6,9,r);
  if(a<80)return lerp(6,9,r);
  if(zone&&/^(yes|commercial|office|hotel|apartments|residential|retail|mixed_use|construction)$/.test(b)){ // tower districts
    if(a>=6000)return lerp(20,40,r);                                  // podiums, malls
    if(a>=1200&&comp>.45)return zone==="cbd"?by(120,300,1200,5000):by(80,200,1200,5000);
    if(a>=500)return zone==="cbd"?by(60,150,500,2000):by(40,100,500,2000);
    return by(15,30,80,500);
  }
  if(/^(house|detached|semidetached_house|terrace|bungalow|villa|static_caravan)$/.test(b))return lerp(8,15,r);
  if(/^(industrial|warehouse|factory|manufacture|storage_tank|silo|hangar)$/.test(b)||lu==="industrial"&&b==="yes")return by(8,15,100,5000);
  if(/^(farm|farm_auxiliary|greenhouse|barn|cowshed|sty|stable)$/.test(b)||/^(farm|aquaculture)$/.test(lu)&&b==="yes")return lerp(6,9,r);
  if(/^(train_station|transportation)$/.test(b))return lerp(12,20,r);
  if(b==="kindergarten")return lerp(8,12,r);
  if(b==="hospital")return by(20,45,300,5000);
  if(/^(school|university|college|dormitory|public|civic|government|church|temple|sports_hall|stadium)$/.test(b)||/^(education|civic)$/.test(lu)&&b==="yes")return by(12,24,150,4000);
  if(b==="retail")return by(10,25,150,8000);
  if(/^(commercial|office|hotel)$/.test(b)||lu==="commercial"&&b==="yes")return a>8000?lerp(20,35,r):by(30,60,200,3000);
  if(b==="construction"||lu==="construction")return lerp(6,15,r);
  if(lu==="park")return lerp(6,12,r);
  return by(18,35,80,1500);                                            // residential (tagged, zoned or unknown)
}
// → extra() for areas(): {h, lm?, _s} (_s = height source osm|est|lm|zero). luAt/parkAt from areaIndex(), isletRing = 海心沙 outline
function heightOf({zones=ZONES,lm=LM_BLD,luAt=()=>null,parkAt=()=>null,isletRing=null}={}){
  return (t,rings)=>{
    const c=centroid(rings[0]),a=Math.abs(signedArea(rings[0])),oh=parseFloat(t.height),ol=parseFloat(t["building:levels"]);
    let id=Object.keys(lm).find(k=>lm[k][0]&&lm[k][0](t));
    if(!id&&isletRing&&lm.haixinsha&&a>=5000&&pointInRing(c,isletRing))id="haixinsha";
    let h=oh>0&&oh<700?oh:ol>0&&ol<130?ol*3.2:null,src=h!=null?"osm":"est";
    if(id&&(h==null||h<lm[id][1]/2))h=lm[id][1],src="lm";                                  // CTF is tagged with its 4-level podium, the tower with 37 levels
    else if(h==null&&(t.location==="underground"||parseFloat(t.layer)<0))h=0,src="zero";   // underground / sunken: flat footprint
    else if(h==null){const z=zones.find(z=>c[0]>=z[1][0]&&c[0]<=z[1][2]&&c[1]>=z[1][1]&&c[1]<=z[1][3]),l=luAt(c);h=estHeight(t,rings[0],z&&z[0],l?l.c:parkAt(c)?"park":null)}
    return id?{h:Math.round(h),lm:id,_s:src}:{h:Math.round(h),_s:src}};
}

// --- stitching: greedy end-to-end joins of polylines (endpoints within `join` m, turn < `turn`°), longest seeds first ---
function stitch(E,{join=2,turn=35,ok=()=>true,cost=()=>0}){
  const G=new Map(),C=4,key=(x,y)=>Math.floor(x/C)+","+Math.floor(y/C),used=new Uint8Array(E.length),out=[];
  E.forEach((e,i)=>[0,1].forEach(end=>{const p=end?e.pts[e.pts.length-1]:e.pts[0],k=key(p[0],p[1]);if(!G.has(k))G.set(k,[]);G.get(k).push([i,end])}));
  const near=p=>{const r=[],cx=Math.floor(p[0]/C),cy=Math.floor(p[1]/C);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const h of G.get((cx+dx)+","+(cy+dy))||[]){const e=E[h[0]];if(dist(p,h[1]?e.pts[e.pts.length-1]:e.pts[0])<=join)r.push(h)}
    return r};
  const dirAt=(pts,atEnd)=>{ // unit travel direction over the first/last ~20 m
    const i=atEnd?pts.length-1:0,s=atEnd?-1:1;let j=i;while(j+s>=0&&j+s<pts.length&&dist(pts[i],pts[j])<20)j+=s;
    const a=atEnd?pts[j]:pts[i],b=atEnd?pts[i]:pts[j],l=dist(a,b)||1;return [(b[0]-a[0])/l,(b[1]-a[1])/l]};
  const ang=(u,v)=>Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1])))*180/Math.PI;
  const P=p=>p.rev?p.e.pts.slice().reverse():p.e.pts;
  for(let s=0;s<E.length;s++){
    if(used[s])continue;used[s]=1;const parts=[{e:E[s],rev:false}];
    for(const fwd of [true,false])for(;;){ // forward: the next part must START at our tail; backward: the previous must END at our head
      const pts=P(fwd?parts[parts.length-1]:parts[0]),at=fwd?pts[pts.length-1]:pts[0],d=dirAt(pts,fwd);let best=null;
      for(const [j,je] of near(at)){
        if(used[j])continue;const rev=fwd?je===1:je===0;if(!ok(E[s],E[j],rev))continue;
        const a=ang(d,dirAt(P({e:E[j],rev}),!fwd));if(a>turn)continue;
        const c=a+cost(E[s],E[j]);if(!best||c<best.c)best={j,rev,c};
      }
      if(!best)break;used[best.j]=1;const p={e:E[best.j],rev:best.rev};if(fwd)parts.push(p);else parts.unshift(p);
    }
    out.push(parts.map(p=>Object.assign({},p,{pts:P(p)})));
  }
  return out;
}

// --- traffic chains: long drivable pieces of tertiary+ roads for cars. One-way chains run in pts order (oneway=-1 ways are
// reversed first); two-way chains carry both directions (drive on the right). Links, roundabouts, reversible ways are skipped;
// tunnels stay in the chain but are listed as [s0,s1] metre spans so cars can fade out at the portals ---
const CH={cls:/^(motorway|trunk|primary|secondary|tertiary)$/,rank:{motorway:0,trunk:1,primary:2,secondary:3,tertiary:4},turn:35,join:2,min:600,minOpen:300,tol:1};
function trafficChains(els,R){
  const E=[];
  for(const e of els){
    const t=e.tags||{};if(e.type!=="way"||!e.geometry||!CH.cls.test(t.highway||"")||t.area==="yes"||/^(roundabout|circular)$/.test(t.junction||"")
      ||/^(reversible|alternating)$/.test(t.oneway||"")||/^(no|private)$/.test(t.access||"")&&!t.oneway)continue;
    const o=oneway(t),g=pg(e.geometry);if(o<0)g.reverse();
    const tn=t.tunnel&&t.tunnel!=="no"||t.covered==="yes"?1:0,n=Math.round(parseFloat(t.lanes))||0;
    for(const piece of clipLine(g,R)){const pts=rdp(piece,CH.tol);if(pts.length>1)E.push({pts,o:o?1:0,c:t.highway,tn,n,len:plen(pts)})}
  }
  E.sort((a,b)=>CH.rank[a.c]-CH.rank[b.c]||b.len-a.len);
  const out=[];
  for(const parts of stitch(E,{join:CH.join,turn:CH.turn,ok:(s,e,rev)=>e.o===s.o&&!(e.o&&rev),cost:(s,e)=>10*Math.abs(CH.rank[s.c]-CH.rank[e.c])})){
    const pts=[],rng=[];
    for(const p of parts){const q=roundPts(p.pts),l=pts[pts.length-1];let i0=pts.length;
      if(l&&l[0]===q[0][0]&&l[1]===q[0][1]){i0--;q.shift()}pts.push(...q);rng.push([i0,pts.length-1,p.e])}
    if(pts.length<2)continue;
    const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+dist(pts[i-1],pts[i]));
    const len=cum[cum.length-1],tunnel=[],byC={},byN={};
    for(const [i0,i1,e] of rng){const a=cum[Math.max(0,i0)],b=cum[i1],l=b-a;byC[e.c]=(byC[e.c]||0)+l;if(e.n)byN[e.n]=(byN[e.n]||0)+l;
      if(e.tn){const z=tunnel[tunnel.length-1];if(z&&a-z[1]<1)z[1]=b;else tunnel.push([a,b])}}
    const tl=tunnel.reduce((s,z)=>s+z[1]-z[0],0);if(len<CH.min||len-tl<CH.minOpen)continue;
    const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1])[0],nn=top(byN),f={c:top(byC)[0],o:parts[0].e.o};
    if(nn&&nn[1]>=len/2)f.n=+nn[0];
    const L=Math.floor(len);out.push(Object.assign(f,{len:L,tunnel:tunnel.map(z=>z.map(v=>Math.min(L,Math.round(v)))),pts}));
  }
  return out.sort((a,b)=>CH.rank[a.c]-CH.rank[b.c]||b.len-a.len);
}

// --- river lanes for boats: waterway=river centrelines stitched, then re-centred between the banks of the DRAWN water
// polygons (normal rays on a 4 m water raster), smoothed, split where the channel narrows below RL.minW or leaves the water ---
const RL={res:4,step:20,iters:6,smooth:7,maxShift:30,maxRay:1500,med:12,spike:1.25,minW:50,minMed:80,min:3000,tol:1};
function raster(feats,R,res){ // even-odd scanline fill (per feature) into a grid of cell centres; features overlap as a union
  const W=Math.ceil((R[2]-R[0])/res),H=Math.ceil((R[3]-R[1])/res),m=new Uint8Array(W*H);
  for(const f of feats){
    const b=bboxOf(f.p[0]);if(!hits(b,R))continue;
    const edges=[];for(const r of f.p)for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length];if(a[1]!==c[1])edges.push(a[1]<c[1]?[a[0],a[1],c[0],c[1]]:[c[0],c[1],a[0],a[1]])}
    edges.sort((p,q)=>p[1]-q[1]);let k=0,act=[];
    for(let j=Math.max(0,Math.floor((b[1]-R[1])/res));j<=Math.min(H-1,Math.ceil((b[3]-R[1])/res));j++){
      const y=R[1]+(j+.5)*res,xs=[];while(k<edges.length&&edges[k][1]<=y)act.push(edges[k++]);act=act.filter(e=>e[3]>y);
      for(const e of act)xs.push(e[0]+(y-e[1])*(e[2]-e[0])/(e[3]-e[1]));xs.sort((a,c)=>a-c);
      for(let i=0;i+1<xs.length;i+=2)for(let x=Math.max(0,Math.ceil((xs[i]-R[0])/res-.5));x<=Math.min(W-1,Math.floor((xs[i+1]-R[0])/res-.5));x++)m[j*W+x]=1;
    }
  }
  return (x,y)=>{const i=Math.floor((x-R[0])/res),j=Math.floor((y-R[1])/res);return i>=0&&j>=0&&i<W&&j<H&&m[j*W+i]===1};
}
function rasterSparse(feats,R,res){ // raster() for network-sized R: 256×256-cell bit blocks, allocated only where water is
  const W=Math.ceil((R[2]-R[0])/res),H=Math.ceil((R[3]-R[1])/res),BX=Math.ceil(W/256),blk=new Array(BX*Math.ceil(H/256)).fill(null);
  for(const f of feats){
    const b=bboxOf(f.p[0]);if(!hits(b,R))continue;
    const edges=[];for(const r of f.p)for(let i=0;i<r.length;i++){const a=r[i],c=r[(i+1)%r.length];if(a[1]!==c[1])edges.push(a[1]<c[1]?[a[0],a[1],c[0],c[1]]:[c[0],c[1],a[0],a[1]])}
    edges.sort((p,q)=>p[1]-q[1]);let k=0,act=[];
    for(let j=Math.max(0,Math.floor((b[1]-R[1])/res));j<=Math.min(H-1,Math.ceil((b[3]-R[1])/res));j++){
      const y=R[1]+(j+.5)*res,xs=[];while(k<edges.length&&edges[k][1]<=y)act.push(edges[k++]);act=act.filter(e=>e[3]>y);
      for(const e of act)xs.push(e[0]+(y-e[1])*(e[2]-e[0])/(e[3]-e[1]));xs.sort((a,c)=>a-c);
      for(let i=0;i+1<xs.length;i+=2)for(let x=Math.max(0,Math.ceil((xs[i]-R[0])/res-.5));x<=Math.min(W-1,Math.floor((xs[i+1]-R[0])/res-.5));x++){
        const bi=(j>>8)*BX+(x>>8),a=blk[bi]||(blk[bi]=new Uint32Array(2048)),q=((j&255)<<8)|(x&255);a[q>>5]|=1<<(q&31)}
    }
  }
  return (x,y)=>{const i=Math.floor((x-R[0])/res),j=Math.floor((y-R[1])/res);if(i<0||j<0||i>=W||j>=H)return false;const a=blk[(j>>8)*BX+(i>>8)];if(!a)return false;const q=((j&255)<<8)|(i&255);return (a[q>>5]>>>(q&31)&1)===1};
}
function riverLanes(els,water,R,wetFn){ // wetFn: optional (x,y) → in water (e.g. rasterSparse), else raster(water, R)
  const wet=wetFn||raster(water,R,RL.res),ray=(p,n)=>{let d=0;while(d<RL.maxRay&&wet(p[0]+n[0]*(d+2),p[1]+n[1]*(d+2)))d+=2;return d+1};
  const E=els.filter(e=>e.type==="way"&&e.geometry&&e.tags.waterway==="river").map(e=>({pts:pg(e.geometry),zh:e.tags.name||""}))
    .map(e=>(e.len=plen(e.pts),e)).sort((a,b)=>b.len-a.len);
  const measure=S=>{ // → per sample {c: centre, w: width} or null where the sample is off the water
    const M=S.map((p,i)=>{
      const a=S[Math.max(0,i-2)],b=S[Math.min(S.length-1,i+2)],l=dist(a,b)||1,n=[-(b[1]-a[1])/l,(b[0]-a[0])/l];
      let q=p;if(!wet(q[0],q[1])){q=null;for(let s=4;s<=200&&!q;s+=4)for(const k of [1,-1])if(!q&&wet(p[0]+n[0]*s*k,p[1]+n[1]*s*k))q=[p[0]+n[0]*s*k,p[1]+n[1]*s*k];if(!q)return null}
      return {q,n,dl:ray(q,n),dr:ray(q,[-n[0],-n[1]])}});
    const med=(i,k)=>{const v=[];for(let j=Math.max(0,i-RL.med);j<=Math.min(M.length-1,i+RL.med);j++)if(M[j])v.push(M[j][k]);v.sort((x,y)=>x-y);return v[v.length>>1]};
    return M.map((m,i)=>{if(!m)return null; // a ray that escapes up a side channel / harbour mouth is clamped to 1.5× its local median
      const dl=Math.min(m.dl,RL.spike*med(i,"dl")),dr=Math.min(m.dr,RL.spike*med(i,"dr")),{q,n}=m;
      return {c:[q[0]+n[0]*(dl-dr)/2,q[1]+n[1]*(dl-dr)/2],w:dl+dr}})};
  const cand=[];
  for(const parts of stitch(E,{join:2,turn:50,cost:(s,e)=>s.zh!==e.zh?15:0})){
    let pl=[];for(const p of parts)pl=pl.length&&dist(pl[pl.length-1],p.pts[0])<2?pl.concat(p.pts.slice(1)):pl.concat(p.pts);
    const names={};for(const p of parts)if(p.e.zh)names[p.e.zh]=(names[p.e.zh]||0)+p.e.len;const zh=(Object.entries(names).sort((a,b)=>b[1]-a[1])[0]||[""])[0];
    for(const piece of clipLine(pl,R)){
      if(plen(piece)<RL.min)continue;let S=resample(piece,RL.step),M;
      for(let it=0;it<RL.iters;it++){ // re-centre (shift capped) → moving-average smooth → resample
        M=measure(S);S=S.map((p,i)=>{const m=M[i];if(!m)return p;const dx=m.c[0]-p[0],dy=m.c[1]-p[1],l=Math.hypot(dx,dy),k=l>RL.maxShift?RL.maxShift/l:1;return [p[0]+dx*k,p[1]+dy*k]});
        S=S.map((p,i)=>{const k=Math.max(2,Math.min(RL.smooth,Math.round((M[i]?M[i].w:0)/60)));let x=0,y=0,n=0; // window ∝ channel width
          for(let j=Math.max(0,i-k);j<=Math.min(S.length-1,i+k);j++){x+=S[j][0];y+=S[j][1];n++}return [x/n,y/n]});
        S=resample(S,RL.step);
      }
      M=measure(S);let run=[];const flush=()=>{if(run.length>1&&plen(run.map(r=>r[0]))>=RL.min)cand.push({zh,S:run});run=[]};
      for(let i=0;i<S.length;i++){const ok=M[i]&&wet(S[i][0],S[i][1])&&M[i].w>=RL.minW&&(!i||wet((S[i][0]+S[i-1][0])/2,(S[i][1]+S[i-1][1])/2));
        if(ok)run.push([S[i],M[i].w]);else flush()}
      flush();
    }
  }
  // de-duplicate: a later (shorter) candidate loses the samples that run within max(40 m, w/3) of an accepted lane
  cand.sort((a,b)=>b.S.length-a.S.length);const acc=[],grid=new Map(),GK=(x,y)=>Math.floor(x/200)+","+Math.floor(y/200);
  const taken=(p,w)=>{const r=Math.max(40,w/3),cx=Math.floor(p[0]/200),cy=Math.floor(p[1]/200);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const q of grid.get((cx+dx)+","+(cy+dy))||[])if(dist(p,q)<r)return true;return false};
  const wide=run=>{const w=run.map(r=>r[1]).sort((x,y)=>x-y);return w[w.length>>1]>=RL.minMed};
  for(const c of cand){const n0=acc.length;let run=[];const flush=()=>{if(run.length>1&&plen(run.map(r=>r[0]))>=RL.min&&wide(run))acc.push({zh:c.zh,S:run});run=[]};
    for(const s of c.S){if(taken(s[0],s[1]))flush();else run.push(s)}flush();
    for(const a of acc.slice(n0))for(const s of a.S){const k=GK(s[0][0],s[0][1]);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s[0])}}
  const hd=(a,b)=>Math.atan2(b[1]-a[1],b[0]-a[0]),turn=(u,v)=>Math.abs(((u-v)*180/Math.PI+540)%360-180);
  const trim=S=>{for(let k=0;k<10&&S.length>8&&turn(hd(S[S.length-2][0],S[S.length-1][0]),hd(S[S.length-7][0],S[S.length-5][0]))>25;k++)S.pop();return S}; // hooks where a lane was cut
  return acc.map(a=>{ // trim hooked ends, simplify (keep the widths of the kept samples)
    a.S=trim(trim(a.S).reverse()).reverse();const ws=a.S.map(s=>s[1]).sort((x,y)=>x-y);
    const pts=a.S.map(s=>s[0]),keep=new Uint8Array(pts.length),st=[[0,pts.length-1]];keep[0]=keep[pts.length-1]=1;
    while(st.length){const [i,j]=st.pop();let dm=0,k=-1;for(let m=i+1;m<j;m++){const d=segDist(pts[m],pts[i],pts[j])[0];if(d>dm){dm=d;k=m}}if(dm>RL.tol){keep[k]=1;st.push([i,k],[k,j])}}
    const P=[],W=[];for(let i=0;i<pts.length;i++)if(keep[i]){const q=[Math.round(pts[i][0]),Math.round(pts[i][1])],l=P[P.length-1];if(!l||l[0]!==q[0]||l[1]!==q[1]){P.push(q);W.push(Math.round(a.S[i][1]))}}
    return {zh:a.zh,len:Math.floor(plen(P)),width:Math.round(ws[ws.length>>1]),w:W,pts:P};
  }).filter(l=>l.len>=RL.min).sort((a,b)=>b.len-a.len);
}

// --- sea from natural=coastline (ways run with the land on their LEFT) ---
// coastChains: ways ([[x,y],…] in OSM direction) joined head-to-tail at shared nodes → maximal chains (closed ones end on their first point)
function coastChains(ways){
  const K=p=>Math.round(p[0]*100)+","+Math.round(p[1]*100),H=new Map(),T=new Map(),used=new Uint8Array(ways.length),out=[];
  const add=(M,k,i)=>{if(!M.has(k))M.set(k,[]);M.get(k).push(i)};
  ways.forEach((w,i)=>{add(H,K(w[0]),i);add(T,K(w[w.length-1]),i)});
  const next=(M,k)=>(M.get(k)||[]).find(j=>!used[j]);
  for(let i=0;i<ways.length;i++){
    if(used[i]||ways[i].length<2)continue;used[i]=1;let c=ways[i].slice(),j;
    while(K(c[0])!==K(c[c.length-1])&&(j=next(H,K(c[c.length-1])))!==undefined){used[j]=1;c=c.concat(ways[j].slice(1))}
    while(K(c[0])!==K(c[c.length-1])&&(j=next(T,K(c[0])))!==undefined){used[j]=1;c=ways[j].slice(0,-1).concat(c)}
    out.push(c);
  }
  return out;
}
// coastSide(chains, {maxD, gap}) → p => true when p lies on the sea side (right of the nearest coastline; angle-weighted normal at
// vertices) — only when that is decidable: the coastline is ≤ maxD m away, p's nearest point is not the loose end of an open chain
// (a coastline cut off by the fetch area / a partial cache) nor on a chain marked .bad (broken: see coastBroken), and no uncached area
// is nearer than it (gap(p) → m: a closer coastline could be missing there); else false (land — OSM water areas still draw their own)
function coastSide(chains,{cell=2000,maxD=1/0,gap=null}={}){
  const G=new Map(),S=[];
  for(const c of chains){const open=dist(c[0],c[c.length-1])>=.05;for(let i=1;i<c.length;i++){const a=c[i-1],b=c[i];if(dist(a,b)<1e-9)continue;const k=S.length;S.push([a,b,c,i,open,!!c.bad]);
    for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)for(let y=Math.floor(Math.min(a[1],b[1])/cell);y<=Math.floor(Math.max(a[1],b[1])/cell);y++){const q=x+","+y;if(!G.has(q))G.set(q,[]);G.get(q).push(k)}}}
  const nrm=(a,b)=>{const l=dist(a,b)||1;return [-(b[1]-a[1])/l,(b[0]-a[0])/l]}; // left normal
  return (p,md=maxD)=>{
    if(!S.length)return false;
    const cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell);let best=null,bd=1/0;
    const look=(x,y)=>{for(const k of G.get(x+","+y)||[]){const [a,b]=S[k],[d,t]=segDist(p,a,b);if(d<bd-1e-9){bd=d;best=[k,t]}}};
    for(let r=0;r<400&&!(best&&(r-1)*cell>bd)&&(r-1)*cell<=md;r++){if(!r){look(cx,cy);continue}   // square rings of cells outwards
      for(let x=cx-r;x<=cx+r;x++){look(x,cy-r);look(x,cy+r)}for(let y=cy-r+1;y<cy+r;y++){look(cx-r,y);look(cx+r,y)}}
    if(!best||bd>md||(gap&&gap(p)<bd))return false;
    const [a,b,c,i,open,bad]=S[best[0]],t=best[1];let n=nrm(a,b),v=a;
    if(bad||(open&&((t<=1e-9&&i===1)||(t>=1-1e-9&&i===c.length-1))))return false;
    if(t<=1e-9&&i>1){const m=nrm(c[i-2],a);n=[n[0]+m[0],n[1]+m[1]]}
    else if(t>=1-1e-9&&i<c.length-1){const m=nrm(b,c[i+1]);n=[n[0]+m[0],n[1]+m[1]];v=b}
    else if(t>1e-9)v=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
    return (p[0]-v[0])*n[0]+(p[1]-v[1])*n[1]<0;
  };
}
// coastPolys(chains, R, isSea) → sea polygons [[outer CCW, ...holes CW]] inside rect R, clipped exactly to its edges.
// Coast pieces are walked with the sea on their left, joined counter-clockwise along the rect; a rect no coast crosses is all sea
// when isSea() says so at its centre and every corner outside the islands (islands inside become holes). A piece that ends inside R
// or comes from a chain marked .bad (the coastline is incomplete there) makes the rect land: stats.dangling counts the pieces that
// end inside, stats.incomplete such rects.
// coastBroken(chains, gap) → the open chains with an end where the water cells are cached (gap(end) > 0): a coastline cut by the fetch
// area ends in an uncached cell, so one ending among cached cells is broken (OSM data, a way not fetched) — which side is the sea
// cannot be told along it. coastGapZone(broken, gap) → R => true when rect R is near where the missing piece must run: the segment from
// each such loose end to the nearest other one, ± max(2 km, ¼ of its length) (± 5 km round a lone end); islands there would flood it
const coastBroken=(chains,gap)=>chains.filter(c=>dist(c[0],c[c.length-1])>=.05&&(gap(c[0])>0||gap(c[c.length-1])>0));
function coastGapZone(broken,gap){
  const E=broken.flatMap(c=>[c[0],c[c.length-1]]).filter(p=>gap(p)>0),Z=E.map(p=>{let q=null,d=1/0;for(const o of E)if(o!==p&&dist(o,p)<d){d=dist(o,p);q=o}
    return q?[p,q,Math.max(2000,d/4)]:[p,p,5000]});
  return R=>Z.some(([a,b,w])=>rectSegDist(R,a,b)<=w);
}
function coastPolys(chains,R,isSea,stats={}){
  const W=R[2]-R[0],H=R[3]-R[1],per=2*(W+H),E=1e-6;
  const snapB=p=>{const q=p.slice();for(const [ax,v] of [[0,R[0]],[0,R[2]],[1,R[1]],[1,R[3]]])if(Math.abs(q[ax]-v)<E)q[ax]=v;return q};
  const onB=p=>p[0]===R[0]||p[0]===R[2]||p[1]===R[1]||p[1]===R[3];
  const T=p=>p[1]===R[1]&&p[0]<R[2]?p[0]-R[0]:p[0]===R[2]&&p[1]<R[3]?W+p[1]-R[1]:p[1]===R[3]&&p[0]>R[0]?W+H+R[2]-p[0]:2*W+H+R[3]-p[1];
  const CORNER=[[W,[R[2],R[1]]],[W+H,[R[2],R[3]]],[2*W+H,[R[0],R[3]]],[0,[R[0],R[1]]]];
  const open=[],closed=[],inR=p=>p[0]>R[0]&&p[0]<R[2]&&p[1]>R[1]&&p[1]<R[3];
  let loose=0;
  for(let c of chains){
    const bb=bboxOf(c);if(!hits(bb,R))continue;
    const ring=dist(c[0],c[c.length-1])<.05;if(ring&&c.length<4)continue;   // an islet simplified away
    if(ring){const o=c.findIndex(p=>!inR(p));if(o<0){closed.push(c.slice(0,-1).reverse());continue}if(o>0)c=c.slice(o,-1).concat(c.slice(0,o+1))}
    for(let pc of clipLine(c,R)){
      pc=pc.map(snapB);if(pc.length<2||(pc.length===2&&dist(pc[0],pc[1])<E))continue;
      if(!onB(pc[0])||!onB(pc[pc.length-1])){stats.dangling=(stats.dangling||0)+1;loose++;continue}
      if(c.bad){loose++;continue}
      open.push(pc.reverse());
    }
  }
  if(loose){stats.incomplete=(stats.incomplete||0)+1;return []}
  const outers=[];
  if(open.length){
    const st=open.map(p=>T(p[0])),en=open.map(p=>T(p[p.length-1])),used=new Uint8Array(open.length);
    for(let i=0;i<open.length;i++){
      if(used[i])continue;const ring=[];let j=i;
      for(let guard=0;guard<=open.length;guard++){
        used[j]=1;for(const p of open[j])ring.push(p);
        const t0=en[j];let best=-1,bd=1/0;
        for(let k=0;k<open.length;k++){if(used[k]&&k!==i)continue;const d=((st[k]-t0)%per+per)%per;if(d<bd){bd=d;best=k}}
        for(const [tc,pt] of CORNER.map(([tc,pt])=>[((tc-t0)%per+per)%per,pt]).sort((a,b)=>a[0]-b[0]))if(tc>E&&tc<bd-E)ring.push(pt);
        if(best===i||best<0)break;j=best;
      }
      const r=[];for(const p of ring){const l=r[r.length-1];if(!l||dist(l,p)>E)r.push(p)}if(r.length>2&&dist(r[0],r[r.length-1])<=E)r.pop();
      if(r.length>=3&&signedArea(r)>0)outers.push([r]);
    }
  }else{
    const probes=[[(R[0]+R[2])/2,(R[1]+R[3])/2],[R[0]+E,R[1]+E],[R[2]-E,R[3]-E],[R[0]+E,R[3]-E],[R[2]-E,R[1]+E]].filter(p=>!closed.some(r=>pointInRing(p,r)));
    if(probes.length&&probes.every(p=>isSea(p)))outers.push([[[R[0],R[1]],[R[2],R[1]],[R[2],R[3]],[R[0],R[3]]]]);
  }
  for(const r of closed){const a=signedArea(r);if(a>0){outers.push([r]);continue}const o=outers.find(o=>pointInRing(r[0],o[0]));if(o)o.push(r)}
  return outers;
}

// --- the fetch plan of tools/fetch-map.js (cells per kind: 16 km over the station bbox + 8 km, 4 km bands around the tracks,
// split cells → their quarters) replayed against its manifest → per kind {ok:[{key,R,file,osm}], missing:[{key,R}], planned}, hole(kind, R),
// gap(kind) → p => m to the nearest uncached point ---
function fetchCoverage(M,GEO,routes,dir){
  const fs=require("fs"),path=require("path"),segs=[];
  for(const l of GEO.lines){
    const S=l.stations.map(s=>P(s.lat,s.lon));if(l.loop)S.push(S[0]);for(let i=1;i<S.length;i++)segs.push([S[i-1],S[i]]);
    const rel=routes&&routes.elements.find(e=>e.type==="relation"&&e.id===l.route);
    if(rel)for(const m of rel.members)if(m.type==="way"&&m.geometry&&!/^(platform|stop)/.test(m.role||"")){const p=rdp(pg(m.geometry),25);for(let i=1;i<p.length;i++)segs.push([p[i-1],p[i]])}
  }
  const SB=bboxOf(GEO.lines.flatMap(l=>l.stations.map(s=>P(s.lat,s.lon)))),PAD=8000;   // = fetch-map.js PAD
  const near=(R,band)=>segs.some(([a,b])=>Math.min(a[0],b[0])-band<=R[2]&&Math.max(a[0],b[0])+band>=R[0]&&Math.min(a[1],b[1])-band<=R[3]&&Math.max(a[1],b[1])+band>=R[1]&&rectSegDist(R,a,b)<=band);
  const cells={},gaps={};
  for(const [kind,K] of Object.entries(M.kinds||{})){
    if(!K.grid)continue;const size=K.grid,list=[];
    if(K.band){const seen=new Set();for(const [a,b] of segs){
      const x0=Math.floor((Math.min(a[0],b[0])-K.band)/size),x1=Math.floor((Math.max(a[0],b[0])+K.band)/size),y0=Math.floor((Math.min(a[1],b[1])-K.band)/size),y1=Math.floor((Math.max(a[1],b[1])+K.band)/size);
      for(let ix=x0;ix<=x1;ix++)for(let iy=y0;iy<=y1;iy++){const k=ix+"_"+iy;if(!seen.has(k)&&rectSegDist([ix*size,iy*size,(ix+1)*size,(iy+1)*size],a,b)<=K.band){seen.add(k);list.push([ix,iy])}}}}
    else for(let ix=Math.floor((SB[0]-PAD)/size);ix<=Math.floor((SB[2]+PAD)/size);ix++)for(let iy=Math.floor((SB[1]-PAD)/size);iy<=Math.floor((SB[3]+PAD)/size);iy++)list.push([ix,iy]);
    const st=cells[kind]={ok:[],missing:[],planned:0,lost:0};
    const walk=(size,ix,iy)=>{const key=`${size/1000}k_${ix}_${iy}`,R=[ix*size,iy*size,(ix+1)*size,(iy+1)*size],e=M.cells[kind+"."+key];
      if(e&&e.split){for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]]){const c=[ix*2+dx,iy*2+dy],s=size/2,CR=[c[0]*s,c[1]*s,(c[0]+1)*s,(c[1]+1)*s];if(!K.band||near(CR,K.band))walk(s,c[0],c[1])}return}
      st.planned++;if(e&&e.file&&fs.existsSync(path.join(dir,e.file)))st.ok.push({key,R,file:e.file,osm:e.osm_base});else{if(e&&e.file)st.lost++;st.missing.push({key,R})}};
    for(const [ix,iy] of list)walk(size,ix,iy);
    gaps[kind]=st.missing.map(c=>c.R);
  }
  const hole=(kind,R)=>(gaps[kind]||[]).some(g=>hits(g,R)&&!(g[2]===R[0]||g[0]===R[2]||g[3]===R[1]||g[1]===R[3]));
  const gap=kind=>{ // p → m to the nearest point no cached cell of kind covers (a missing cell or outside the fetch plan)
    const ok=(cells[kind]||{ok:[]}).ok,g=Math.min(...ok.map(c=>c.R[2]-c.R[0])),on=new Set();
    for(const {R} of ok)for(let x=Math.round(R[0]/g);x<Math.round(R[2]/g);x++)for(let y=Math.round(R[1]/g);y<Math.round(R[3]/g);y++)on.add(x+"_"+y);
    return p=>{if(!ok.length)return 0;const cx=Math.floor(p[0]/g),cy=Math.floor(p[1]/g);let bd=1/0;
      const look=(x,y)=>{if(!on.has(x+"_"+y))bd=Math.min(bd,rectPtDist([x*g,y*g,x*g+g,y*g+g],p))};
      for(let r=0;r<64&&(r-1)*g<=bd;r++){if(!r){look(cx,cy);continue}for(let x=cx-r;x<=cx+r;x++){look(x,cy-r);look(x,cy+r)}for(let y=cy-r+1;y<cy+r;y++){look(cx-r,y);look(cx+r,y)}}
      return bd}};
  return {cells,hole,gap};
}

// --- landmarks: id, name regex, preferred tags (the metro station of the same name must not win) ---
const LANDMARKS=[
  ["cantonTower","^广州塔$",t=>t.man_made==="tower"],
  ["operaHouse","^广州大剧院$",t=>t.building||t.amenity||t.tourism],
  ["haixinsha","^海心沙",t=>t.place||t.leisure||t.tourism],
  ["huachengSquare","^花城广场$",t=>t.place||t.leisure||t.highway],
  ["tianheSports","^天河体育中心$",t=>t.leisure||t.building],
  ["ifc","^广州国际金融中心",t=>t.building],
  ["ctf","^广州周大福金融中心",t=>t.building],
  ["museum","^广东省博物馆",t=>t.tourism||t.building],
  ["library","^广州图书馆",t=>t.amenity||t.building],
  ["chimelong","^长隆野生动物世界$",t=>t.tourism||t.leisure]];
const landmarkQuery=B=>`nwr["name"~"${LANDMARKS.map(l=>l[1].replace(/[$^]/g,"")).join("|")}"](${B});out center tags;`;
function pickLandmark(els,[id,re,pref]){ // best `out center tags` element for a LANDMARKS entry, or null
  const rx=new RegExp(re),c=els.filter(e=>rx.test(e.tags.name||"")&&!e.tags.railway&&!e.tags.public_transport&&!/^(bus_stop|platform)$/.test(e.tags.highway||"")
    &&!/^(train_station|trn)$/.test(e.tags.building||"")&&!/站/.test(e.tags.wikipedia||""));
  const score=e=>(pref(e.tags)?4:0)+(e.type==="node"?0:2)+(e.tags.wikidata?1:0);
  return c.sort((a,b)=>score(b)-score(a))[0]||null;
}

// --- the first frame of a ride: the views js/px/ride.js RIDE.prepare hands MAP.loadFor (p0Views after aim()), replayed for the budget
// check — mix zoom at the start of hop 0 (its overview level; the focus = the hop's box centre pulled by the camera's keep-in / cluster
// rules with 14 px station boxes: labels are not measured), integer focus from a camera at 0, 0 (the session's first ride), the layout of
// js/px/ui.js UI.layout (no keyboard / safe area, one attribution line), the track smoothed as js/px/train.js does. Mirror of ride.js:
// re-check against it (a headless capture of MAP.loadFor's views) when its camera or p0Views change. The overview box is padded by one
// level px (the focus may round either way), a phone's by 13 (labels are not measured: a long one pushes a phone camera 12–16 px in 5
// rides): against the real game (19 lines × 2 directions × desktop + phone, 2026-09-29) the tile set is a superset every time, equal in
// 72 of 76, ≤ 25.5 KB heavier; the two outliers (a label pushing the camera 37 / 47 px: l7 phone fwd, l4 desk rev) stay inside its tiles. ---
const RLV=[2,2.5,3.2,4,5,6.3,8,10,12.5,16,24,48];
const RIDE_VIEWS=[{id:"desk",W:720,H:450,top:29},{id:"phone",W:195,H:422,top:29}];   // 1440×900 / 390×844 CSS px at pixel scale 2
// (any integer dpr); top = the cluster's top edge below the page's floating chips (game.js pxChips → RIDE.set before prepare), art px
function rideLayout(W,H,top=0){
  const portrait=W<H,M=portrait?4:6,tp=Math.max(M,top),cw=portrait?W-2*M-1:203,ch=cw-8<175?3*15+2+8:2*30+1+8,cluster={x:W-M-cw-1,y:tp,w:cw,h:ch};
  const room=W-2*M-1,bw=portrait?room:Math.min(room,Math.max(320,Math.round(W*.6))),bh=82+(portrait?22:0),board={x:portrait?M:Math.max(M,(W-bw)>>1),y:H-M-bh-1,w:bw,h:bh};
  return {W,H,portrait,cluster,board,attrY:portrait?board.y-11:H-M-8};
}
function smoothCurve(P,len){ // → s => {x, y}: P resampled every metre of its arc scaled to len, Gaussian σ 14 m (±42 m), ends extrapolated
  const cum=along(P),k=len/cum[cum.length-1],N=Math.floor(len)+2,rx=new Float64Array(N),ry=new Float64Array(N);
  for(let i=0,j=1;i<N;i++){const s=Math.min(i,len)/k;while(j<P.length-1&&cum[j]<s)j++;const f=Math.max(0,Math.min(1,(s-cum[j-1])/((cum[j]-cum[j-1])||1)));
    rx[i]=P[j-1][0]+(P[j][0]-P[j-1][0])*f;ry[i]=P[j-1][1]+(P[j][1]-P[j-1][1])*f}
  const wt=[];for(let q=0;q<=42;q++)wt.push(Math.exp(-q*q/392));
  const SX=new Float64Array(N),SY=new Float64Array(N);
  for(let i=0;i<N;i++){const h=Math.min(42,i,N-1-i);let ax=0,ay=0,aw=0;for(let q=-h;q<=h;q++){const w=wt[Math.abs(q)];ax+=rx[i+q]*w;ay+=ry[i+q]*w;aw+=w}SX[i]=ax/aw;SY[i]=ay/aw}
  const ang=i=>{const a=Math.max(0,i-4),b=Math.min(N-1,i+4);return Math.atan2(-(SY[b]-SY[a]),SX[b]-SX[a])};
  return s=>{if(s<=0||s>=N-1){const i=s<=0?0:N-1,a=ang(i),e=s-i;return {x:SX[i]+Math.cos(a)*e,y:SY[i]-Math.sin(a)*e}}
    const i=Math.floor(s),f=s-i;return {x:SX[i]+(SX[i+1]-SX[i])*f,y:SY[i]+(SY[i+1]-SY[i])*f}};
}
function rideViews(T,dir,lay,landmarks=[]){ // T = MAP.line(id) → {near, lvl, close, views:[{lod, bbox}]}
  const rev=dir<0,P=smoothCurve(rev?T.pts.slice().reverse():T.pts,T.len),n=T.st.length,d=i=>rev?T.len-T.st[n-1-i]:T.st[i];
  const {W,H,portrait,cluster:c}=lay,top=portrait?c.y+c.h:0,f={x:0,y:top,w:W,h:(portrait?Math.min(lay.board.y,lay.attrY-1):lay.board.y)-top};
  const ax=W>>1,ay=Math.round(f.y+f.h/2),E=14,span=l=>l<=5?90*l:l<=16?20*l:0,levelFor=m=>RLV.reduce((a,l)=>l<=m+1e-9?l:a,RLV[0]);
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(let s=d(0);;s=Math.min(d(1),s+20)){const p=P(s);x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);if(s>=d(1))break}
  const bw=x1-x0+80,bh=y1-y0+80,need=Math.max(bw/f.w,bh/f.h)/1.5;let over=RLV[RLV.length-1],cl=RLV[0];
  for(const l of RLV){const ex=span(l)/l+20;if(bw/l+ex<=f.w&&bh/l+ex<=f.h){over=l;break}}
  for(const l of RLV)if(Math.abs(Math.log(l/need))<Math.abs(Math.log(cl/need)))cl=l;
  cl=Math.min(4,Math.max(3.2,cl));const m=Math.max(over,cl),A=P(d(0)),B=P(d(1)),bd=[T.bb[0]-9000,T.bb[1]-9000,T.bb[2]+9000,T.bb[3]+9000];
  let fx=(x0+x1)/2,fy=(y0+y1)/2;
  const scr=p=>[ax+(p.x-fx)/m,ay-(p.y-fy)/m],lim=(v,a,b)=>Math.max(a,Math.min(b,v)),sb=[-7,-7,7,7],cb=[-9,-9,9,9];
  const keepIn=(p,g,bx=[0,0,0,0])=>{const [sx,sy]=scr(p),l=sx+bx[0],t=sy+bx[1],r=sx+bx[2],b=sy+bx[3];
    if(l<f.x+g)fx-=(f.x+g-l)*m;else if(r>f.x+f.w-g)fx+=(r-(f.x+f.w-g))*m;
    if(t<f.y+g)fy+=(f.y+g-t)*m;else if(b>f.y+f.h-g)fy-=(b-(f.y+f.h-g))*m};
  const across=Math.abs(B.y-A.y)>=Math.abs(B.x-A.x),off=(p,bx)=>{if(portrait)return;const [sx,sy]=scr(p),g=6;
    const pl=sx+bx[2]-(c.x-g),pr=c.x+c.w+g-(sx+bx[0]),pt=sy+bx[3]-(c.y-g),pb=c.y+c.h+g-(sy+bx[1]);
    if(pl>0&&pr>0&&pt>0&&pb>0){if(across)fx+=Math.min(pl,pt,pb)*m;else fy+=Math.min(pb,pl,pr)*m}};
  const tail=P(d(0)-span(levelFor(m))),LM={cantonTower:[110,600],ifc:[70,440],ctf:[75,530]};
  keepIn(B,4,sb);keepIn(tail,E);keepIn(A,E+6);
  for(const l of landmarks){const t=LM[l.id];if(!t||Math.min(Math.hypot(l.x-A.x,l.y-A.y),Math.hypot(l.x-B.x,l.y-B.y))>900)continue;
    const hw=t[0]/2/m;off(l,[-hw,-((l.h||t[1])*.4+t[0]/2)/m,hw,t[0]/2/m])}
  off(A,sb);off(B,sb);for(const q of [tail,P(d(0)-span(levelFor(m))/2),A])off(q,cb);
  keepIn(tail,E);keepIn(A,E+6);fx=lim(fx,bd[0]+ax*m,Math.max(bd[0]+ax*m,bd[2]-(W-ax)*m));fy=lim(fy,bd[1]+(H-ay)*m,Math.max(bd[1]+(H-ay)*m,bd[3]-ay*m));
  const rd=v=>v>1e-3?Math.ceil(v-.05):v<-1e-3?Math.floor(v+.05):Math.round(v),ox=rd(fx/m)-ax,oy=rd(-fy/m)-ay;
  const hw=Math.min(1000,(W/2+16)*cl)-.5,hh=Math.min(1000,(H/2+16)*cl)-.5;   // = p0Views: LOD0 only round the train
  const lod=m<=5?0:m<=16?1:2,C=6000,ph=Math.min(W,H)<240,g=ph?29:17;let vb=[(ox-g)*m,-(oy+H+g)*m,(ox+W+g)*m,-(oy-g)*m];   // = p0Views (+ the pad above): a phone's (shorter side < 240 art px)
  if(lod===2&&ph)vb=[Math.max(vb[0],A.x-C),Math.max(vb[1],A.y-C),Math.min(vb[2],A.x+C),Math.min(vb[3],A.y+C)];   // city overview: ±6 km of the train
  return {near:[A.x,A.y],lvl:m,close:cl,views:[{lod,bbox:vb},{lod:0,bbox:[A.x-hw,A.y-hh,A.x+hw,A.y+hh]}]};
}
// --- size budgets of the packed map (tools/pack-map.js, tools/check-map.js; MB / KB = 10^6 / 10^3 bytes, gz = gzip -9 per file):
// the whole network (tiles + lines.js) ≤ 16 MB raw; a line's cold ride (lines.js + every tile of MAP.tiles(id)) ≤ 1.5 MB gz (Line 3
// 1.3 MB: the plan's caps); the first frame (the P0 of the replayed views, both directions, desktop + phone) ≤ 160 KB gz; the overview
// js/map/ov.js (tools/pack-ov.js: part of the menu's load) ≤ 120 KB gz ---
const BUDGET={net:16e6,ride:1.5e6,rideOf:{l3:1.3e6},first:160e3,ov:120e3};
const rideCap=id=>BUDGET.rideOf[id]||BUDGET.ride;
// --- a hop's track length ÷ its js/data.js segKm outside this band is a warning (tools/check-map.js, tools/pack-map.js) ---
const HOP_BAND=[.85,1.2];
function budgets(MAP,ML,gzOf,linesGz){ // → per line {id, km, ride, cap, first, at, bad: [what is over]}
  const rows=[];
  for(const id of Object.keys(ML.lines)){
    const T=MAP.tiles(id),ride=linesGz+T.reduce((s,l,lod)=>s+l.reduce((a,x)=>a+gzOf(lod,x.key),0),0),km=ML.lines[id].len/1000,cap=rideCap(id),Ln=MAP.line(id);
    let first=-1,at="";
    for(const pr of RIDE_VIEWS)for(const dir of [1,-1]){const r=rideViews(Ln,dir,rideLayout(pr.W,pr.H,pr.top),MAP.landmarks),P0=MAP.plan(id,{dir,near:r.near,views:r.views}).P0;
      const b=P0.reduce((a,x)=>a+gzOf(x.lod,x.key),0);if(b>first){first=b;at=`${pr.id} ${dir>0?"fwd":"rev"}, ${r.lvl} m/px, ${P0.length} tiles`}}
    rows.push({id,km,ride,cap,first,at,bad:[ride>cap&&"cold ride",first>BUDGET.first&&"first frame"].filter(Boolean)});
  }
  return rows;
}

module.exports={ORIGIN,MLAT,MLON,P,LL,llBox,pg,normalize,
  dist,signedArea,bboxOf,hits,segDist,rectPtDist,rectSegDist,rdp,roundPts,clipRing,clipLine,chain,assemble,assembleStats,
  pointInRing,centroid,plen,along,locate,resample,smoothPath,
  TOL,MIN_AREA,polysOf,areas,oneway,lines,merge,areaIndex,
  cWater,cCoast,cGreen,cLand,ROAD,ROAD_RANK,cRoad,cRail,cMetro,cWaterway,cBuilding,cBridge,
  ZONES,LM_BLD,hash01,estHeight,heightOf,stitch,CH,trafficChains,RL,raster,rasterSparse,riverLanes,coastChains,coastSide,coastBroken,coastGapZone,coastPolys,fetchCoverage,LANDMARKS,landmarkQuery,pickLandmark,
  RLV,RIDE_VIEWS,rideLayout,smoothCurve,rideViews,BUDGET,rideCap,budgets,HOP_BAND};
