#!/usr/bin/env node
/* Regenerates js/boundaries.js from OpenStreetMap (Overpass API).
   City outlines (Guangzhou + Foshan, solid) and Guangzhou's 11 districts (dashed),
   used as a non-interactive geographic backdrop under the metro network on the maps.
   Usage: node tools/fetch-boundaries.js
   Dev-only; the game never fetches at runtime. Data © OpenStreetMap contributors, ODbL 1.0. */
"use strict";
const fs=require("fs"),path=require("path");

const API="https://overpass-api.de/api/interpreter";
const UA="guangzhou-metro-typing/0.4.9 (https://github.com/JamieStudio-lab/guangzhou-metro-typing)";

// OSM admin relations: Guangzhou & Foshan are sub-provincial cities (admin_level 5);
// Guangzhou's districts are admin_level 6 (the 11 members of the GZ area).
const GZ_REL=3287346, FS_REL=3464719, GZ_AREA=3600000000+GZ_REL;
const EN={"广州市":"Guangzhou","佛山市":"Foshan",
  "越秀区":"Yuexiu","天河区":"Tianhe","海珠区":"Haizhu","荔湾区":"Liwan","白云区":"Baiyun",
  "黄埔区":"Huangpu","番禺区":"Panyu","南沙区":"Nansha","花都区":"Huadu","增城区":"Zengcheng","从化区":"Conghua"};

const SIMPLIFY_TOL=0.0016; // Douglas–Peucker tolerance in degrees (~170 m) — stylized backdrop, not survey-grade
const MIN_RING_PTS=6;      // drop assembled rings smaller than this after simplify (tiny enclaves/slivers)
const MIN_RING_AREA=6e-5;  // drop rings whose shoelace area (deg²) is below this (specks/islets)
const COORD_DP=4;          // baked-file coordinate precision (~11 m)

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function overpass(q,tries=4){
  for(let i=1;;i++){
    const res=await fetch(API,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/x-www-form-urlencoded"},
      body:"data="+encodeURIComponent("[out:json][timeout:120];"+q)});
    if(res.ok)return res.json();
    if(i>=tries)throw new Error(`Overpass ${res.status} after ${tries} tries: ${q.slice(0,80)}`);
    process.stderr.write(`  retry ${i} (${res.status})\n`);await sleep(8000*i);
  }
}

// --- geometry helpers (lat/lon treated as planar at this scale) ---
const key=p=>p[0].toFixed(7)+","+p[1].toFixed(7);

// stitch a relation's outer ways (each an array of [lat,lon]) into closed rings
function assemble(ways){
  const segs=ways.filter(w=>w.length>1).map(w=>w.slice());
  const rings=[];
  while(segs.length){
    let ring=segs.pop(),grew=true;
    while(grew&&key(ring[0])!==key(ring[ring.length-1])){
      grew=false;
      for(let i=0;i<segs.length;i++){
        const s=segs[i],head=key(ring[0]),tail=key(ring[ring.length-1]);
        if(key(s[0])===tail){ring=ring.concat(s.slice(1));}
        else if(key(s[s.length-1])===tail){ring=ring.concat(s.slice(0,-1).reverse());}
        else if(key(s[s.length-1])===head){ring=s.slice(0,-1).concat(ring);}
        else if(key(s[0])===head){ring=s.slice().reverse().slice(0,-1).concat(ring);}
        else continue;
        segs.splice(i,1);grew=true;break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

function perp(p,a,b){ // distance from point p to segment a-b (x=lon, y=lat)
  const x=p[1],y=p[0],x1=a[1],y1=a[0],x2=b[1],y2=b[0],dx=x2-x1,dy=y2-y1,L2=dx*dx+dy*dy;
  if(L2===0)return Math.hypot(x-x1,y-y1);
  let t=((x-x1)*dx+(y-y1)*dy)/L2;t=Math.max(0,Math.min(1,t));
  return Math.hypot(x-(x1+t*dx),y-(y1+t*dy));
}
function rdp(pts,tol){
  if(pts.length<3)return pts.slice();
  let dmax=0,idx=0;const a=pts[0],b=pts[pts.length-1];
  for(let i=1;i<pts.length-1;i++){const d=perp(pts[i],a,b);if(d>dmax){dmax=d;idx=i}}
  if(dmax>tol){const l=rdp(pts.slice(0,idx+1),tol),r=rdp(pts.slice(idx),tol);return l.slice(0,-1).concat(r)}
  return [a,b];
}
function ringArea(r){let a=0;for(let i=0,n=r.length;i<n;i++){const p=r[i],q=r[(i+1)%n];a+=p[1]*q[0]-q[1]*p[0]}return Math.abs(a)/2}

function relToRings(rel){
  const ways=[];
  for(const m of rel.members){
    if(m.type!=="way"||m.role==="inner"||!m.geometry)continue; // outer perimeter only (skip enclaves/holes)
    ways.push(m.geometry.map(g=>[g.lat,g.lon]));
  }
  return assemble(ways)
    .map(r=>rdp(r,SIMPLIFY_TOL))
    .filter(r=>r.length>=MIN_RING_PTS&&ringArea(r)>=MIN_RING_AREA)
    .map(r=>r.map(p=>[+p[0].toFixed(COORD_DP),+p[1].toFixed(COORD_DP)]))
    .sort((a,b)=>ringArea(b)-ringArea(a)); // largest ring first
}

const fmtRings=rings=>"["+rings.map(r=>"\n   ["+r.map(p=>"["+p[0]+","+p[1]+"]").join(",")+"]").join(",")+"]";
const entry=o=>` {"ref":${JSON.stringify(o.ref)},"zh":${JSON.stringify(o.zh)},"en":${JSON.stringify(o.en)},"rings":${fmtRings(o.rings)}}`;

(async()=>{
  process.stderr.write("Cities (广州市 + 佛山市)…");
  const cd=await overpass(`rel(id:${GZ_REL},${FS_REL});out geom;`);
  const crels=cd.elements.filter(e=>e.type==="relation");
  const cities=[GZ_REL,FS_REL].map(id=>{
    const rel=crels.find(e=>e.id===id);if(!rel)throw new Error(`city relation ${id} not returned`);
    const zh=rel.tags.name,rings=relToRings(rel);
    if(!rings.length)throw new Error(`city ${zh} produced no rings`);
    return {ref:zh==="佛山市"?"FS":"GZ",zh,en:EN[zh]||rel.tags["name:en"]||"",rings};
  });
  process.stderr.write(` ${cities.map(c=>c.zh+":"+c.rings.length+"r").join(" ")}\n`);
  await sleep(2500);

  process.stderr.write("Guangzhou districts (admin_level 6)…");
  const dd=await overpass(`area(${GZ_AREA})->.gz;rel(area.gz)["boundary"="administrative"]["admin_level"="6"];out geom;`);
  const drels=dd.elements.filter(e=>e.type==="relation"&&/区$/.test(e.tags.name||""));
  const districts=drels.map(rel=>{
    const zh=rel.tags.name,rings=relToRings(rel);
    return {ref:(rel.tags["ref"]||zh),zh,en:EN[zh]||rel.tags["name:en"]||"",rings};
  }).filter(d=>d.rings.length).sort((a,b)=>a.zh.localeCompare(b.zh,"zh"));
  process.stderr.write(` ${districts.length} districts\n`);
  if(districts.length!==11)process.stderr.write(`  WARN: expected 11 districts, got ${districts.length}\n`);

  const out=`/* Generated by tools/fetch-boundaries.js — do not edit by hand.
   Non-interactive geographic backdrop: Guangzhou + Foshan city outlines (solid) and
   Guangzhou's 11 districts (dashed). Rings are [lat,lon], simplified for a stylized map.
   Map data © OpenStreetMap contributors, ODbL 1.0 — openstreetmap.org/copyright */
const BOUNDARIES={fetched:"${new Date().toISOString().slice(0,10)}",
source:"Map data © OpenStreetMap contributors, ODbL 1.0",
cities:[
${cities.map(entry).join(",\n")}
],
districts:[
${districts.map(entry).join(",\n")}
]};
`;
  fs.writeFileSync(path.join(__dirname,"..","js","boundaries.js"),out);
  const pts=[...cities,...districts].reduce((a,o)=>a+o.rings.reduce((s,r)=>s+r.length,0),0);
  console.log(`js/boundaries.js written: ${cities.length} cities, ${districts.length} districts, ${pts} points, ${(out.length/1024).toFixed(1)} KB`);
})().catch(e=>{console.error(e);process.exit(1)});
