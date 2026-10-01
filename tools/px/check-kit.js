#!/usr/bin/env node
/* Checks the pixel UI kit (css/style.css, section "PIXEL UI KIT" … "end of the pixel UI kit"; rules: mockups/pixel-menu/SPEC.md §3):
   · every --px-* token default (both themes) equals its PAL role (js/data.js + js/px/palette.js in a vm) — ROLE below is the kit's table;
     onaccent / onbad = the better of text / textOutline on accent-sign / bad-sign; tag-* = their role + ≥ 4.5:1 on fill and fill2;
     text colours ≥ 4.5:1 on the surfaces they sit on; every line's PAL lsh ink ≥ 4.5:1 on its sign
   · js/game.js pxChrome()'s PXC map (it repaints the tokens at runtime) names the same roles
   · lint of the kit section (with the world map's, mockups/pixel-world/SPEC.md): border-radius ≠ 0, blur, backdrop-filter, filter,
     opacity < 1, soft (blurred) box / text shadows (hard 1 art px outlines are fine), transitions / animations without steps(), gradients
     that are not hard stops, alpha colours (rgba / hsla / #rgba / color-mix), raw hexes outside custom properties and var() fallbacks,
     custom properties outside the kit's own (--px-* --lc* --pk-* --pki-* --pw-*, the safe-area insets --sit --sir --sib --sil and the few
     game.js sets: --nx --gpl --gx --gy --by …)
   · icons: every <use href="#…"> in index.html, every literal href="#…" in js/game.js / js/cloud.js and every BADGE_DEFS icon
     (js/cloud.js) has its <symbol> in index.html
   · the menu set: gz bytes of js/game.js PX_MENU's files ≤ 280 KB (plan §6: the menu map's first frame); js/px/ovlife.js ≤ 16 KB gz on
     its own (ovmap.js injects it after that first frame)
   Usage: node tools/px/check-kit.js · exit 1 on any error. Dev-only, zero deps, Node ≥ 18. */
"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),zlib=require("zlib");
const REPO=path.join(__dirname,"..",".."),rd=f=>fs.readFileSync(path.join(REPO,f),"utf8");
const errs=[],warns=[],err=m=>errs.push(m),warn=m=>warns.push(m),MENU_MAX=280e3,LIFE_MAX=16e3;

/* ---------- PAL ---------- */
const sb={console};sb.window=sb;vm.createContext(sb);
vm.runInContext(rd("js/data.js")+"\n;this.LINES=LINES;",sb,{filename:"js/data.js"});
vm.runInContext(rd("js/px/palette.js"),sb,{filename:"js/px/palette.js"});
const PAL=sb.PAL,LINES=sb.LINES,TH=["night","day"];
const at=(P,k)=>k.split(".").reduce((o,x)=>o&&o[x],P);
const lum=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255).map(c=>c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);
const cr=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
// token → PAL role (one, or [night, day])
const ROLE={page:"bg",ground:"land.d1",fill:["ui.panel","ui.panel2"],fill2:["ui.panel2","ui.panel"],off:"ui.panel2",edge:"ui.edge",hi:"ui.hi",
  lo:"ui.lo",shadow:"shadow",ink:"ink",text:"text",dim:"ui.dim",outline:"textOutline",accent:"ui.accent","accent-lo":"ui.accentLo",
  "accent-hi":["fire.core","fire.t2"],"accent-tx":"ui.accentTx","accent-sign":"ui.accentSign","bad-sign":"ui.badSign",good:"hud.good",warn:"hud.warn",
  bad:"hud.bad",paper:"stn.fill","paper-lo":"stn.lo",screen:"led.bg",led:"led.on","led-off":"led.off","led-glow":"led.glow","fire-t3":"fire.t3",
  "fire-t2":"fire.t2","fire-core":"fire.core","tag-good":["hud.good","green.d0"],"tag-mid":["ui.accentTx","boat.wood.lo"],"tag-hard":["fire.t1","veh.taxi.face"],
  "tag-bad":["hud.bad","veh.c3.lo"]};
const ON={onaccent:"accent-sign",onbad:"bad-sign"},TEXT=["text","dim","accent-tx"],SURF=["fill","fill2","page","screen"];
const roleOf=(k,i)=>Array.isArray(ROLE[k])?ROLE[k][i]:ROLE[k];

/* ---------- css: the kit section, its token blocks, the per-line rules ---------- */
const css=rd("css/style.css"),A=css.indexOf("PIXEL UI KIT ("),B=css.indexOf("end of the pixel UI kit");
if(A<0||B<A){console.error("check-kit: css/style.css has no PIXEL UI KIT … end of the pixel UI kit section");process.exit(1)}
const kit=css.slice(css.lastIndexOf("/*",A),B).replace(/\/\*[\s\S]*?\*\//g,"");
const block=sel=>{const i=kit.indexOf(sel+"{");if(i<0){err(`token block ${sel} missing`);return{}}
  return Object.fromEntries([...kit.slice(i,kit.indexOf("}",i)).matchAll(/--px-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m=>[m[1],m[2].toLowerCase()]))};
const TOK=[block(":root,[data-theme=dark]"),block(":root[data-theme=light],[data-theme=light]")];
TH.forEach((th,i)=>{const P=PAL[th],T=TOK[i],name=`${th} --px-`;
  for(const k of [...Object.keys(ROLE),...Object.keys(ON)])if(!T[k])err(`${name}${k} missing`);
  for(const k in T){
    if(ON[k]){const bg=T[ON[k]],c=[P.text,P.textOutline].sort((x,y)=>cr(y,bg)-cr(x,bg))[0];if(bg&&T[k]!==c.toLowerCase())err(`${name}${k} ${T[k]} ≠ the better of text / textOutline on ${ON[k]} (${c})`);continue}
    const r=roleOf(k,i),v=r&&at(P,r);
    if(!r)err(`${name}${k}: not in the kit's role table`);else if(!v)err(`${name}${k}: PAL.${th}.${r} missing`);else if(v.toLowerCase()!==T[k])err(`${name}${k} ${T[k]} ≠ PAL.${th}.${r} ${v}`)}
  const need=(fg,bgs,min=4.5)=>{for(const b of bgs)if(T[fg]&&T[b]&&cr(T[fg],T[b])<min)err(`${name}${fg} on ${b}: ${cr(T[fg],T[b]).toFixed(2)}:1 < ${min}:1`)};
  TEXT.forEach(k=>need(k,SURF));["tag-good","tag-mid","tag-hard","tag-bad"].forEach(k=>need(k,["fill","fill2"]));need("onaccent",["accent-sign"]);need("onbad",["bad-sign"]);
  for(const L of LINES){const s=P.lsh[L.id];   // ([data-lc] rules: game.js pxLc() from PAL)
    if(!s||!["sign","ink","hi","lo"].every(k=>s[k]))err(`PAL.${th}.lsh.${L.id}: sign / ink / hi / lo missing`);
    else if(cr(s.sign,s.ink)<4.5)err(`PAL.${th}.lsh.${L.id}: ink on sign ${cr(s.sign,s.ink).toFixed(2)}:1 < 4.5:1`)}});

/* ---------- game.js pxChrome's PXC (runtime copies of the tokens) ---------- */
const game=rd("js/game.js");
const lit=name=>{const m=game.match(new RegExp(`\\b${name}\\s*=\\s*([\\[{])`));if(!m)return null;
  let i=m.index+m[0].length-1,d=0,q=null;for(let j=i;j<game.length;j++){const c=game[j];
    if(q){if(c==="\\")j++;else if(c===q)q=null;continue}if(c==='"'||c==="'"||c==="`"){q=c;continue}
    if(c==="["||c==="{")d++;else if(c==="]"||c==="}"){if(!--d)return vm.runInNewContext("("+game.slice(i,j+1)+")",{})}}return null};
const PXC=lit("PXC");
if(!PXC)warn("js/game.js: no PXC map found (pxChrome)");
else for(const k in PXC)TH.forEach((th,i)=>{const r=Array.isArray(PXC[k])?PXC[k][i]:PXC[k],v=at(PAL[th],r),t=TOK[i][k];
  if(t===undefined)return;if(!v)err(`game.js PXC.${k}: PAL.${th}.${r} missing`);else if(v.toLowerCase()!==t)err(`game.js PXC.${k} → PAL.${th}.${r} ${v} ≠ css --px-${k} ${t} (pxChrome would repaint it)`)});

/* ---------- lint ---------- */
const OKVAR=/^--(px-|lc|pk-|pki-|pw-|pxu$|pxkm?$|gut$|dock$|si[trbl]$|mono$|pxbb$|pxtl$|pxtw$|pxn$|nx$|gpl$|gx$|gy$|by$)/;
const split=(s,sep)=>{const o=[];let d=0,cur="";for(const c of s){if(c==="(")d++;else if(c===")")d--;if(!d&&sep.test(c)){o.push(cur);cur=""}else cur+=c}o.push(cur);return o.map(x=>x.trim()).filter(Boolean)};
const isColour=t=>/^(#|var\(--(px-|lc|pk-[fehlc2]|pki-)|transparent$|currentcolor$|rgb|hsl|color-mix)/i.test(t);
function decls(src,ctx){let i=0;const out=[];
  while(i<src.length){const o=src.indexOf("{",i);if(o<0)break;const sel=src.slice(i,o).trim();let d=1,j=o+1;for(;j<src.length&&d;j++){if(src[j]==="{")d++;else if(src[j]==="}")d--}
    const body=src.slice(o+1,j-1);
    if(body.includes("{"))out.push(...decls(body,sel));
    else for(const dcl of split(body,/;/)){const c=dcl.indexOf(":");if(c>0)out.push({sel:ctx?ctx+" "+sel:sel,p:dcl.slice(0,c).trim().toLowerCase(),v:dcl.slice(c+1).trim()})}
    i=j}return out}
function hardStops(g){const args=split(g,/,/);if(/^(from|at|to\s|circle|ellipse|-?[\d.]+(deg|turn|rad))/.test(args[0]))args.shift();
  return args.every((a,n)=>{const t=split(a,/\s/),pos=t.slice(1);return pos.length&&(n?/^0(%|px)?$/.test(pos[0]):true)&&(pos.length===2||n===args.length-1)})}
const hard=v=>split(v,/,/).every(sh=>{const t=split(sh,/\s/).filter(x=>x!=="inset"&&!isColour(x));return t.length<3||/^0(px)?$/.test(t[2])});
for(const{sel,p,v:v0}of decls(kit)){const v=v0.replace(/\s*!important$/i,""),at_=`${sel} { ${p}: ${v.slice(0,70)} }`,lv=v.toLowerCase();
  if(sel.startsWith("@property"))continue;
  if(/radius/.test(p)&&!/^0(px)?$/.test(v))err(`radius: ${at_}`);
  if(/blur\(/.test(lv))err(`blur: ${at_}`);
  if(/(^|-)(backdrop-)?filter$/.test(p)&&lv!=="none")err(`filter: ${at_}`);
  if(p==="opacity"&&parseFloat(v)<1)err(`opacity < 1: ${at_}`);
  if(/^(transition|animation)(-name|-duration)?$/.test(p)&&!/^(none|0s?)$/.test(lv)&&!/steps\(/.test(lv))err(`${p} without steps(): ${at_}`);
  if(/^(box|text)-shadow$/.test(p)&&lv!=="none"&&!hard(v))err(`soft shadow: ${at_}`);
  for(const m of lv.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\(/g)){let d=1,j=m.index+m[0].length;for(;j<lv.length&&d;j++){if(lv[j]==="(")d++;else if(lv[j]===")")d--}
    if(!hardStops(v.slice(m.index+m[0].length,j-1)))err(`gradient without hard stops: ${at_}`)}
  if(/rgba\(|hsla\(|color-mix\(|#([0-9a-f]{4}|[0-9a-f]{8})\b/.test(lv))err(`alpha colour: ${at_}`);
  if(!p.startsWith("--")&&/#[0-9a-f]{3,8}\b/.test(lv.replace(/var\(--[\w-]+,\s*#[0-9a-f]{3,8}\)/g,"")))err(`raw hex (use a --px-* token): ${at_}`);
  for(const m of v.matchAll(/var\((--[\w-]+)/g))if(!OKVAR.test(m[1]))err(`non-kit custom property ${m[1]}: ${at_}`)}

/* ---------- icons ---------- */
const html=rd("index.html"),syms=new Set([...html.matchAll(/<symbol id="([\w-]+)"/g)].map(m=>m[1]));
for(const m of html.matchAll(/<use href="#([\w-]+)"/g))if(!syms.has(m[1]))err(`index.html: <use href="#${m[1]}"> has no <symbol>`);
for(const f of["js/game.js","js/cloud.js"])for(const m of rd(f).matchAll(/href=\\?["']#([\w-]+)(\$\{)?/g))   // (an id completed by ${…} is not checked)
  if(!m[2]&&!syms.has(m[1]))err(`${f}: href="#${m[1]}" has no <symbol> in index.html`);
const cloud=rd("js/cloud.js"),bd=cloud.slice(cloud.indexOf("BADGE_DEFS=["),cloud.indexOf("]];",cloud.indexOf("BADGE_DEFS=[")));
const ics=[...bd.matchAll(/\[(?:"\w+"|L\.id),"(\w+)"/g)].map(m=>m[1]);
if(!ics.length)err("js/cloud.js: no BADGE_DEFS icons found");
for(const n of ics)if(!syms.has("pki-"+n))err(`js/cloud.js BADGE_DEFS icon "${n}": index.html has no #pki-${n}`);

/* ---------- the menu set's bytes ---------- */
const MENU=lit("PX_MENU");let menu="";
if(!MENU)warn("js/game.js: no PX_MENU list yet — menu-set budget not measured");
else{let raw=0,gz=0;const rows=[];
  for(const e of MENU){const f="js/"+(Array.isArray(e)?e[0]:e)+".js";if(!fs.existsSync(path.join(REPO,f))){err(`PX_MENU: ${f} missing`);continue}
    const b=fs.readFileSync(path.join(REPO,f)),z=zlib.gzipSync(b,{level:9}).length;raw+=b.length;gz+=z;rows.push(`${f} ${(z/1e3).toFixed(1)}`)}
  menu=`menu set (PX_MENU, ${MENU.length} files — the menu map's first frame): ${(gz/1e3).toFixed(1)} KB gz / ${(raw/1e3).toFixed(0)} KB raw, budget ${MENU_MAX/1e3} KB gz\n    ${rows.join(" · ")}`;
  if(gz>MENU_MAX)err(`menu set ${(gz/1e3).toFixed(1)} KB gz > ${MENU_MAX/1e3} KB`)}
// its life: ovmap.js injects js/px/ovlife.js once the mounted map shows its first view (trains / badges / START sign) — its own budget
{const LF="js/px/ovlife.js";if(!fs.existsSync(path.join(REPO,LF)))err(`${LF} missing (ovmap.js injects it)`);
  else{const b=fs.readFileSync(path.join(REPO,LF)),z=zlib.gzipSync(b,{level:9}).length;
    menu+=`${menu?"\n  ":""}map life (${LF}, after the first frame): ${(z/1e3).toFixed(1)} KB gz / ${(b.length/1e3).toFixed(0)} KB raw, budget ${LIFE_MAX/1e3} KB gz`;
    if(z>LIFE_MAX)err(`${LF} ${(z/1e3).toFixed(1)} KB gz > ${LIFE_MAX/1e3} KB`)}}

const kitGz=zlib.gzipSync(Buffer.from(css.slice(A,B)),{level:9}).length;
console.log(`check-kit: ${Object.keys(TOK[0]).length} tokens × 2 themes, ${LINES.length} lines, kit section ${(kitGz/1e3).toFixed(1)} KB gz`+(menu?"\n  "+menu:""));
for(const w of warns)console.log("  warn: "+w);
for(const e of errs)console.log("  ERROR: "+e);
console.log(errs.length?`check-kit: ${errs.length} error(s)`:"check-kit: ok");
process.exit(errs.length?1:0);
