#!/usr/bin/env node
/* Regenerates js/geo.js from OpenStreetMap (Overpass API).
   Usage: node tools/fetch-geo.js
   Dev-only; the game never fetches at runtime. Data © OpenStreetMap contributors, ODbL 1.0. */
"use strict";
const fs=require("fs"),path=require("path");

const API="https://overpass-api.de/api/interpreter";
const UA="guangzhou-metro-typing/0.0.7 (https://github.com/JamieStudio-lab/guangzhou-metro-typing)";

// Official colors: Wikipedia Module:Adjacent stations/Guangzhou Metro (matches OSM colour tags).
// kind:"master" = route_master relation (first member route used);
// kind:"route"  = directional route relation used as-is.
const TABLE=[
 {ref:"1",  zh:"1号线",  en:"Line 1",  color:"#F3D03E", kind:"master", rel:3936877},
 {ref:"2",  zh:"2号线",  en:"Line 2",  color:"#00629B", kind:"master", rel:3244073},
 {ref:"3",  zh:"3号线",  en:"Line 3",  color:"#ECA154", kind:"master", rel:9841063},
 {ref:"4",  zh:"4号线",  en:"Line 4",  color:"#00843D", kind:"master", rel:9607978},
 {ref:"5",  zh:"5号线",  en:"Line 5",  color:"#C5003E", kind:"master", rel:3967180},
 {ref:"6",  zh:"6号线",  en:"Line 6",  color:"#80225F", kind:"master", rel:7322006},
 {ref:"7",  zh:"7号线",  en:"Line 7",  color:"#97D700", kind:"master", rel:5971692},
 {ref:"8",  zh:"8号线",  en:"Line 8",  color:"#008C95", kind:"master", rel:443998},
 {ref:"9",  zh:"9号线",  en:"Line 9",  color:"#71CC98", kind:"master", rel:9924027},
 {ref:"10", zh:"10号线", en:"Line 10", color:"#7389B2", kind:"route",  rel:19283541},
 {ref:"11", zh:"11号线", en:"Line 11", color:"#FFB40C", kind:"route",  rel:18132492, loop:true}, // 外圈
 {ref:"12", zh:"12号线", en:"Line 12", color:"#505D12", kind:"route",  rel:19283546, note:"east segment; west segment not yet in OSM"},
 {ref:"13", zh:"13号线", en:"Line 13", color:"#8E8C13", kind:"master", rel:7895357},
 {ref:"14", zh:"14号线", en:"Line 14", color:"#81312F", kind:"master", rel:6728233},
 {ref:"18", zh:"18号线", en:"Line 18", color:"#0047BA", kind:"master", rel:13246294},
 {ref:"21", zh:"21号线", en:"Line 21", color:"#201747", kind:"master", rel:9611531},
 {ref:"22", zh:"22号线", en:"Line 22", color:"#CD5228", kind:"master", rel:13988001},
 {ref:"GF", zh:"广佛线", en:"Guangfo Line", color:"#C4D600", kind:"master", rel:9612493},
 {ref:"APM",zh:"APM线", en:"APM",     color:"#00B5E2", kind:"master", rel:9611409},
];

// OSM name → name used in js/data.js (none needed today; add here if OSM renames)
const ALIAS={};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function overpass(q,tries=4){
  for(let i=1;;i++){
    const res=await fetch(API,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/x-www-form-urlencoded"},
      body:"data="+encodeURIComponent("[out:json][timeout:90];"+q)});
    if(res.ok)return res.json();
    if(i>=tries)throw new Error(`Overpass ${res.status} after ${tries} tries: ${q.slice(0,80)}`);
    process.stderr.write(`  retry ${i} (${res.status})\n`);await sleep(8000*i);
  }
}

async function fetchLine(t){
  let routeId=t.rel;
  if(t.kind==="master"){
    const d=await overpass(`relation(${t.rel});out body;`);
    const m=d.elements[0].members.filter(x=>x.type==="relation");
    if(!m.length)throw new Error(`route_master ${t.rel} has no route members`);
    routeId=m[0].ref;
    await sleep(2000);
  }
  const d=await overpass(`relation(${routeId});out body;node(r);out body;`);
  const rel=d.elements.find(e=>e.type==="relation"&&e.id===routeId);
  const nodes=new Map(d.elements.filter(e=>e.type==="node").map(e=>[e.id,e]));
  const st=[];
  for(const m of rel.members){
    if(m.type!=="node"||!/^stop/.test(m.role||""))continue;
    const n=nodes.get(m.ref);if(!n||!n.tags||!n.tags.name)continue;
    const zh=ALIAS[n.tags.name]||n.tags.name;
    if(st.length&&st[st.length-1].zh===zh)continue;
    st.push({zh,en:n.tags["name:en"]||"",lat:+n.lat.toFixed(5),lon:+n.lon.toFixed(5)});
  }
  if(t.loop&&st.length>1&&st[0].zh===st[st.length-1].zh)st.pop();
  if(st.length<2)throw new Error(`line ${t.ref}: only ${st.length} stops extracted from relation ${routeId}`);
  return {route:routeId,stations:st};
}

// Cross-check every playable station name in js/data.js against the fetched line
function crossCheck(geoLines){
  const src=fs.readFileSync(path.join(__dirname,"..","js","data.js"),"utf8");
  const data=src.match(/\/\*__DATA__\*\/([\s\S]*)\/\*__END_DATA__\*\//)[1];
  const LINES=new Function(data+";return LINES;")();
  const byRef=new Map(geoLines.map(l=>[l.ref,new Set(l.stations.map(s=>s.zh))]));
  const missing=[];
  for(const L of LINES){
    const set=byRef.get(L.num);
    for(const s of L.st)if(!set||!set.has(s[0]))missing.push(`${L.id} ${s[0]}`);
  }
  return missing;
}

(async()=>{
  const lines=[];
  for(const t of TABLE){
    process.stderr.write(`Line ${t.ref}…`);
    const {route,stations}=await fetchLine(t);
    process.stderr.write(` ${stations.length} stations\n`);
    lines.push({ref:t.ref,zh:t.zh,en:t.en,color:t.color,loop:!!t.loop,relation:t.rel,route,
      ...(t.note?{note:t.note}:{}),stations});
    await sleep(2500);
  }
  const missing=crossCheck(lines);
  if(missing.length){
    console.error("FATAL: playable stations missing from fetched data (add to ALIAS?):\n  "+missing.join("\n  "));
    process.exit(1);
  }
  const body=lines.map(l=>{
    const head=JSON.stringify({ref:l.ref,zh:l.zh,en:l.en,color:l.color,loop:l.loop,relation:l.relation,route:l.route,...(l.note?{note:l.note}:{})}).slice(0,-1);
    return " "+head+',"stations":[\n  '+l.stations.map(s=>JSON.stringify(s)).join(",\n  ")+"\n ]}";
  }).join(",\n");
  const out=`/* Generated by tools/fetch-geo.js — do not edit by hand.
   Map data © OpenStreetMap contributors, ODbL 1.0 — openstreetmap.org/copyright */
const GEO={fetched:"${new Date().toISOString().slice(0,10)}",
source:"Map data © OpenStreetMap contributors, ODbL 1.0",
lines:[
${body}
]};
`;
  fs.writeFileSync(path.join(__dirname,"..","js","geo.js"),out);
  const n=lines.reduce((a,l)=>a+l.stations.length,0);
  console.log(`js/geo.js written: ${lines.length} lines, ${n} stations, ${(out.length/1024).toFixed(1)} KB`);
})().catch(e=>{console.error(e);process.exit(1)});
