#!/usr/bin/env node
/* Regenerates the subsetted webfonts in assets/fonts/ from full source fonts.
   Usage: node tools/subset-fonts.js [src-dir]   (default src-dir: tools/fonts-src)
   Dev-only; the game never fetches at runtime.

   Prereqs (dev machine only, not a project dependency):
     pip3 install --user "fonttools[woff]" brotli
   Source fonts expected in src-dir (all SIL OFL 1.1):
     ResourceHanRoundedCN-Regular.ttf, ResourceHanRoundedCN-Bold.ttf
       — https://github.com/CyanoHao/Resource-Han-Rounded/releases (RHR-CN 7z)
     Nunito-VF.ttf  — google/fonts ofl/nunito Nunito[wght].ttf
     Sono-VF.ttf    — google/fonts ofl/sono Sono[MONO,wght].ttf

   CJK charset = every CJK char rendered by the game (scanned from index.html,
   js/data.js, js/game.js, js/cloud.js — catches rare place chars like 滘)
   ∪ tools/hanzi-3500.txt (通用规范汉字表 一级, so leaderboard nicknames render)
   ∪ CJK punctuation + fullwidth forms. Re-run after adding lines/strings. */
"use strict";
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");

const ROOT=path.join(__dirname,"..");
const SRC=process.argv[2]||path.join(__dirname,"fonts-src");
const OUT=path.join(ROOT,"assets","fonts");
const PY="python3";

const SCAN=["index.html","js/data.js","js/game.js","js/cloud.js","js/geo.js"];
const LATIN="U+0000-00FF,U+0100-017F,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+FEFF,U+FFFD";

function cjkCharset(){
  const set=new Set();
  const grab=s=>{for(const c of s){const cp=c.codePointAt(0);
    // 0x20000-0x2FA1F: CJK Ext-B+ (𧒽岗 on the Guangfo line) — kept in the charset even
    // though current RHR builds lack those glyphs, so a future font update picks them up
    if((cp>=0x3400&&cp<=0x9FFF)||(cp>=0x20000&&cp<=0x2FA1F)||(cp>=0x3000&&cp<=0x303F)||(cp>=0xFF01&&cp<=0xFF5E)||cp===0x2014||(cp>=0x2018&&cp<=0x201D)||cp===0x2026)set.add(c);}};
  for(const f of SCAN)grab(fs.readFileSync(path.join(ROOT,f),"utf8"));
  grab(fs.readFileSync(path.join(__dirname,"hanzi-3500.txt"),"utf8"));
  grab("、。，·：；！？（）《》〈〉「」『』【】〇々～");
  return[...set].sort().join("");
}

function subset(srcFile,outName,extra){
  const src=path.join(SRC,srcFile),out=path.join(OUT,outName);
  if(!fs.existsSync(src)){console.error(`missing ${src} — see header comment for download sources`);process.exit(1);}
  execFileSync(PY,["-m","fontTools.subset",src,"--flavor=woff2","--no-hinting",
    `--output-file=${out}`,...extra],{stdio:["ignore","inherit","inherit"]});
  console.log(`${outName}  ${(fs.statSync(out).size/1024).toFixed(0)} KB`);
}

fs.mkdirSync(OUT,{recursive:true});
const chars=cjkCharset();
const charFile=path.join(__dirname,".charset.tmp.txt");
fs.writeFileSync(charFile,chars);
console.log(`CJK charset: ${[...chars].length} chars`);

// Sono: pin the MONO axis to 1 (monospace) first, keep wght variable.
const sonoMono=path.join(SRC,"Sono-mono.tmp.ttf");
execFileSync(PY,["-m","fontTools.varLib.instancer",path.join(SRC,"Sono-VF.ttf"),"MONO=1","-o",sonoMono],{stdio:["ignore","ignore","inherit"]});

subset("ResourceHanRoundedCN-Regular.ttf","RHR-Regular.woff2",[`--text-file=${charFile}`,`--unicodes=${LATIN}`]);
subset("ResourceHanRoundedCN-Bold.ttf","RHR-Bold.woff2",[`--text-file=${charFile}`,`--unicodes=${LATIN}`]);
subset("Nunito-VF.ttf","Nunito-VF.woff2",[`--unicodes=${LATIN}`]);
subset("Sono-mono.tmp.ttf","Sono-VF.woff2",[`--unicodes=${LATIN}`]);

fs.unlinkSync(charFile);fs.unlinkSync(sonoMono);
console.log("done → assets/fonts/");
