const APP_VERSION="0.0.2";

// normalize station tuples → objects, compute keys
for(const L of LINES){
  L.stations=L.st.map(t=>({zh:t[0],py:t[1],x:t[2],y:t[3],lb:t[4],tr:t[5]||null,key:normPy(t[1])}));
  delete L.st;
  L.km=L.segKm.reduce((a,b)=>a+b,0);
  L.avgLen=L.stations.reduce((a,s)=>a+s.key.length,0)/L.stations.length;
  L.diff=L.avgLen+L.stations.length*0.09;
}
// Boss list: the longest unique station names across all lines
const BOSS=(()=>{const seen=new Set(),all=[];
  for(const L of LINES)for(const s of L.stations){if(!seen.has(s.key)){seen.add(s.key);all.push(s)}}
  return all.filter(s=>s.key.length>=14).sort((a,b)=>b.key.length-a.key.length)})();

/* ============================================================
   HELPERS
============================================================ */
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const easeIO=p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
const fmtT=ms=>{const s=Math.floor(ms/1000);return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const alpha=(hex,a)=>hex+Math.round(a*255).toString(16).padStart(2,"0");
function diffOf(len){return len<=7?{k:"good",t:"短 SHORT"}:len<=12?{k:"mid",t:"中 MEDIUM"}:{k:"bad",t:"长 LONG"}}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

/* ---------- sound ---------- */
let AC=null,muted=false;
function ac(){if(!AC){try{AC=new(window.AudioContext||window.webkitAudioContext)()}catch(e){}}
  if(AC&&AC.state==="suspended")AC.resume();return AC}
function tone(f,d,dl=0,type="sine",g=.11){const a=ac();if(!a||muted)return;
  const t=a.currentTime+dl,o=a.createOscillator(),v=a.createGain();
  o.type=type;o.frequency.value=f;
  v.gain.setValueAtTime(.0001,t);v.gain.exponentialRampToValueAtTime(g,t+.012);
  v.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.connect(v).connect(a.destination);o.start(t);o.stop(t+d+.05)}
const sDing=()=>{tone(784,.1);tone(1046.5,.16,.09)};
const sErr =()=>tone(140,.11,0,"square",.05);
const sCombo=()=>{tone(659,.07);tone(784,.07,.06);tone(988,.12,.12)};
const sWin =()=>{[523,659,784,1046].forEach((f,i)=>tone(f,.16,i*.11))};
const sLose=()=>{tone(330,.18);tone(262,.26,.16)};
$("soundBtn").onclick=()=>{muted=!muted;$("soundBtn").textContent=muted?"🔇 静音":"🔊 音效"};

function confetti(){const fx=$("fx"),cols=["#f3d03e","#1d80c4","#f0862b","#2fbf71","#ffb020"];
  for(let i=0;i<30;i++){const e=document.createElement("i");
    e.style.left=Math.random()*100+"vw";e.style.background=cols[i%cols.length];
    e.style.animationDuration=1.5+Math.random()*1.2+"s";e.style.animationDelay=Math.random()*.3+"s";
    fx.appendChild(e);setTimeout(()=>e.remove(),3200)}}

/* ============================================================
   MAP BUILDING (schematic SVG)
============================================================ */
const RIVERS=[
 "M 40 762 C 200 772 320 640 420 612 C 520 585 604 588 700 575 C 800 564 900 586 960 588",
 "M 40 905 C 250 912 350 894 430 885 C 560 872 620 792 700 757 C 780 726 900 744 960 740"];

function buildRegistry(){const reg=new Map();
  for(const L of LINES)for(const s of L.stations){
    if(!reg.has(s.zh))reg.set(s.zh,{zh:s.zh,py:s.py,x:s.x,y:s.y,lb:s.lb,tr:s.tr,lines:[]});
    reg.get(s.zh).lines.push(L)}
  return reg}
const REG=buildRegistry();

function labelMarkup(st){
  const rows=[],tr=st.tr?("⇄ "+st.tr.join("·")):null;
  const zh=`<text class="st-zh" data-zh="${st.zh}">${st.zh}</text>`;
  const py=`<text class="st-py">${st.py}</text>`;
  const trt=tr?`<text class="st-tr">${tr}</text>`:"";
  const A={};
  const set=(anchor,x,zy,py2,ty)=>{A.anchor=anchor;A.x=x;A.zy=zy;A.py=py2;A.ty=ty};
  switch(st.lb){
    case"l": st.tr?set("end",st.x-16,st.y-8,st.y+5,st.y+16):set("end",st.x-16,st.y-2,st.y+11,0);break;
    case"r": st.tr?set("start",st.x+16,st.y-8,st.y+5,st.y+16):set("start",st.x+16,st.y-2,st.y+11,0);break;
    case"a": set("middle",st.x,st.y-20,st.y-8,st.y-32);break;
    case"b": set("middle",st.x,st.y+22,st.y+35,st.y+47);break;
    case"ul":set("end",st.x-11,st.y-16,st.y-4,st.y-28);break;
    case"bl":set("end",st.x-12,st.y+30,st.y+44,st.y+56);break;
  }
  let out=`<g text-anchor="${A.anchor}">`;
  out+=zh.replace("<text ",`<text x="${A.x}" y="${A.zy}" `);
  out+=py.replace("<text ",`<text x="${A.x}" y="${A.py}" `);
  if(trt)out+=trt.replace("<text ",`<text x="${A.x}" y="${A.ty}" `);
  return out+"</g>"}

function buildMap(svg,opts){
  let s="";
  for(const r of RIVERS)s+=`<path class="riv" d="${r}"/>`;
  for(const L of LINES){
    const d=L.stations.map((p,i)=>(i?"L":"M")+p.x+" "+p.y).join(" ");
    s+=`<path class="lpath" data-line="${L.id}" d="${d}" stroke="${L.color}"/>`}
  for(const [zh,st] of REG){
    const inter=st.lines.length>1;
    s+=`<g class="stg" data-st="${zh}">`;
    s+=`<circle class="pulseHolder" data-p="${zh}" cx="${st.x}" cy="${st.y}" r="9" fill="none" stroke="#ffb020" stroke-width="2" opacity="0"/>`;
    s+=`<circle class="heat" data-h="${zh}" cx="${st.x}" cy="${st.y}" r="${inter?12:10}" fill="none" stroke="none" stroke-width="2.5"/>`;
    if(inter)s+=`<circle class="dot" data-d="${zh}" cx="${st.x}" cy="${st.y}" r="8" fill="#e9eef6" stroke="#0a0f1a" stroke-width="3"/>`;
    else s+=`<circle class="dot" data-d="${zh}" cx="${st.x}" cy="${st.y}" r="5.5" fill="#0a0f1a" stroke="${st.lines[0].color}" stroke-width="3"/>`;
    s+=labelMarkup(st)+"</g>"}
  if(opts&&opts.train){
    s+=`<g id="trainG" opacity="0"><g id="trainR">
      <rect x="-16" y="-9" width="32" height="18" rx="7" fill="#dfe7f3" stroke="#0a0f1a" stroke-width="2"/>
      <rect id="trainBand" x="-16" y="-2" width="32" height="4" fill="#ffb020"/>
      <rect x="-10" y="-6" width="6" height="4" rx="1" fill="#22304a"/>
      <rect x="-1" y="-6" width="6" height="4" rx="1" fill="#22304a"/>
      <circle cx="14" cy="0" r="2.4" fill="#fff6d8"/>
    </g></g>`}
  svg.innerHTML=s}

/* ============================================================
   GAME STATE + ENGINE
============================================================ */
const S={screen:"menu",mode:null,line:null,rev:false,seq:[],segs:[],
  idx:1,key:"",typed:0,firstT:null,errSt:false,done:false,
  t0:null,endT:null,correct:0,errors:0,combo:0,maxCombo:0,score:0,
  heats:[],times:[],perfs:[],dist:0,distDone:0,topV:0,dispV:0,tgtV:0,
  travels:[],trav:null,
  bossList:[],bossI:0,lives:3,bossDone:0,deadline:0,bossSec:10,revealing:false};
const dirState={},bests={};
let lastRun=null;

const gMap=$("gMap"),mapWrap=$("mapWrap"),inp=$("pyin");
let cam={cx:500,cy:575,w:1100},camT={cx:500,cy:575,w:1100},camFollow=false;
let nodes=null; // {dot,heat,pulse,zh} per 汉字 for game map

function collectNodes(){nodes={};
  gMap.querySelectorAll("[data-d]").forEach(e=>{(nodes[e.dataset.d]=nodes[e.dataset.d]||{}).dot=e});
  gMap.querySelectorAll("[data-h]").forEach(e=>{(nodes[e.dataset.h]=nodes[e.dataset.h]||{}).heat=e});
  gMap.querySelectorAll("[data-p]").forEach(e=>{(nodes[e.dataset.p]=nodes[e.dataset.p]||{}).pulse=e});
  gMap.querySelectorAll("[data-zh]").forEach(e=>{(nodes[e.dataset.zh]=nodes[e.dataset.zh]||{}).zh=e})}

function applyCam(){const asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight));
  const h=cam.w/asp;gMap.setAttribute("viewBox",`${cam.cx-cam.w/2} ${cam.cy-h/2} ${cam.w} ${h}`)}
function fitAll(instant){const bb=gMap.getBBox(),pad=42,
  asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight));
  camT={cx:bb.x+bb.width/2,cy:bb.y+bb.height/2,w:Math.max(bb.width+pad*2,(bb.height+pad*2)*asp)};
  camFollow=false;if(instant){cam={...camT};applyCam()}}

const HEATC={good:"#2fbf71",mid:"#f0b429",bad:"#e5484d"};

/* ---------- screens ---------- */
function show(name){S.screen=name;
  $("menu").hidden=name!=="menu";$("game").hidden=name!=="game";$("result").hidden=name!=="result";
  $("homeBtn").hidden=name!=="game";
  document.body.classList.toggle("boss",name==="game"&&S.mode==="boss")}

/* ---------- start runs ---------- */
function resetStats(){Object.assign(S,{idx:1,typed:0,firstT:null,errSt:false,done:false,
  t0:null,endT:null,correct:0,errors:0,combo:0,maxCombo:0,score:0,
  heats:[],times:[],perfs:[],dist:0,distDone:0,topV:0,dispV:0,tgtV:0,travels:[],trav:null,revealing:false});
  $("cCombo").textContent="0";$("cScore").textContent="0";$("cWpm").textContent="0";
  $("cAcc").firstChild.nodeValue="100";$("cTime").textContent="0:00";$("cDist").firstChild.nodeValue="0.0"}

function startLine(L,rev){S.mode="line";S.line=L;S.rev=rev;lastRun={mode:"line",L,rev};
  S.seq=rev?[...L.stations].reverse():L.stations.slice();
  S.segs=rev?[...L.segKm].reverse():L.segKm.slice();
  resetStats();show("game");
  document.body.style.setProperty("--lc",L.color);
  $("board").style.setProperty("--lc",L.color);
  $("board").style.setProperty("--lcg",alpha(L.color,.38));
  $("toast").style.setProperty("--lc",L.color);
  $("zhChip").textContent=L.num;$("zhChip").style.background=L.color;
  buildMap(gMap,{train:true});collectNodes();
  $("trainBand").setAttribute("fill",L.color);
  // dim other lines + their exclusive stations
  const mine=new Set(S.seq.map(s=>s.zh));
  gMap.querySelectorAll(".lpath").forEach(p=>p.classList.toggle("dimline",p.dataset.line!==L.id));
  gMap.querySelectorAll(".stg").forEach(g=>{g.style.opacity=mine.has(g.dataset.st)?"1":".22"});
  // origin visuals
  const o=S.seq[0];
  if(REG.get(o.zh).lines.length<=1)nodes[o.zh].dot.setAttribute("fill",L.color);
  buildPbar();setGauge(0,L.cap);
  placeTrain(o.x,o.y,angleTo(0,1));$("trainG").setAttribute("opacity","1");
  requestAnimationFrame(()=>{fitAll(true);setTimeout(()=>{camFollow=true},700)});
  S.idx=1;setPrompt();movePulse();
  announce(`始发站 ${o.zh} · 输入下一站拼音即发车 Type the next stop to depart`);
  setTimeout(()=>inp.focus(),80)}

function startBoss(){S.mode="boss";S.line=null;lastRun={mode:"boss"};
  S.bossList=shuffle(BOSS);S.bossI=0;S.lives=3;S.bossDone=0;
  resetStats();show("game");
  const c="#e5484d";
  document.body.style.setProperty("--lc",c);
  $("board").style.setProperty("--lc",c);$("board").style.setProperty("--lcg",alpha(c,.35));
  $("zhChip").textContent="★";$("zhChip").style.background=c;
  $("lives").textContent="♥♥♥";buildPbar();
  setBossPrompt();setTimeout(()=>inp.focus(),80)}

/* ---------- prompt / board ---------- */
function paintPy(){const el=$("py");el.classList.remove("reveal");
  const st=curStation();if(!st){el.innerHTML="";return}
  let n=0,html="",word="";
  const flush=()=>{if(word){html+=`<span class="w">${word}</span>`;word=""}};
  for(const ch of st.py){const base=TONE[ch.toLowerCase()]||ch.toLowerCase();
    if(base>="a"&&base<="z"){const cls=n<S.typed?"done":n===S.typed?"next":"todo";
      word+=`<span class="c ${cls}">${ch}</span>`;n++}
    else flush()}
  flush();el.innerHTML=html}

function curStation(){return S.mode==="boss"?S.bossList[S.bossI]:S.seq[S.idx]}

function setPrompt(){const st=S.seq[S.idx];
  if(!st){ // terminus reached (all names typed) — waiting on final arrival
    $("zhTxt").textContent="终点站 · Terminus";$("py").innerHTML="";
    $("brdLabel").textContent="即将到达 ARRIVING";$("cnt").textContent="";
    $("dTag").hidden=true;inp.value="";inp.disabled=true;S.key="";updPbar();return}
  S.key=st.key;S.typed=0;S.firstT=null;S.errSt=false;
  inp.disabled=false;inp.value="";
  $("brdLabel").textContent="下一站 NEXT STOP";
  $("zhTxt").textContent=st.zh;
  const d=diffOf(st.key.length);const tg=$("dTag");tg.hidden=false;tg.className="tag "+d.k;tg.textContent=d.t;
  $("cnt").textContent=S.idx+"/"+(S.seq.length-1);
  paintPy();updPbar();flashBoard()}

function setBossPrompt(){const st=S.bossList[S.bossI];
  S.key=st.key;S.typed=0;S.firstT=null;S.errSt=false;S.revealing=false;
  inp.disabled=false;inp.value="";
  $("brdLabel").textContent="限时挑战 BEAT THE CLOCK";
  $("zhTxt").textContent=st.zh;
  const d=diffOf(st.key.length);const tg=$("dTag");tg.hidden=false;tg.className="tag "+d.k;tg.textContent=d.t+" · "+st.key.length;
  $("cnt").textContent=(S.bossI+1)+"/"+S.bossList.length;
  S.bossSec=Math.max(6,Math.round(st.key.length*0.55));
  S.deadline=performance.now()+S.bossSec*1000;
  paintPy();updPbar();flashBoard()}

function flashBoard(){const b=$("board");b.classList.remove("fresh");void b.offsetWidth;b.classList.add("fresh")}

/* ---------- progress bar ---------- */
function buildPbar(){const bar=$("pbar");bar.innerHTML="";
  const n=S.mode==="boss"?S.bossList.length:S.seq.length;
  for(let i=0;i<n;i++)bar.appendChild(document.createElement("i"));
  updPbar()}
function updPbar(){const cells=$("pbar").children;
  if(S.mode==="boss"){for(let i=0;i<cells.length;i++){cells[i].className=
    i<S.bossI?(S.heats[i]||"bad"):i===S.bossI?"cur":""}return}
  for(let i=0;i<cells.length;i++){cells[i].className=
    i===0?"origin":i<S.idx?(S.heats[i]||"good"):i===S.idx?"cur":""}}

/* ---------- typing ---------- */
inp.addEventListener("input",e=>{if(!e.isComposing)handleTyping(inp.value)});
inp.addEventListener("compositionend",()=>handleTyping(inp.value));
inp.addEventListener("paste",e=>{e.preventDefault();shake()});
document.addEventListener("keydown",e=>{
  if(S.screen!=="game")return;
  if(e.key==="Escape"){quit();return}
  if(document.activeElement!==inp&&e.key.length===1&&!e.metaKey&&!e.ctrlKey)inp.focus()});

function handleTyping(raw){
  if(S.screen!=="game"||S.done||S.revealing||!S.key)return;
  if(/[\u3400-\u9fff]/.test(raw))announce("请切换到英文键盘 · Please switch to an English keyboard");
  let v="";for(const ch of raw.toLowerCase()){const c=TONE[ch]||ch;if(c>="a"&&c<="z")v+=c}
  let ok=0;while(ok<v.length&&ok<S.key.length&&v[ok]===S.key[ok])ok++;
  if(v.length>ok){S.errors+=v.length-ok;S.errSt=true;
    if(S.combo>0){S.combo=0;$("cCombo").textContent="0"}
    shake();sErr()}
  if(ok>S.typed){
    if(S.firstT===null){S.firstT=performance.now();if(S.t0===null)S.t0=S.firstT}
    S.correct+=ok-S.typed}
  S.typed=ok;inp.value=S.key.slice(0,ok);
  paintPy();updLive();
  if(ok===S.key.length)S.mode==="boss"?bossComplete():completeStation()}

function shake(){inp.classList.remove("shake");void inp.offsetWidth;inp.classList.add("shake")}

function stationPerf(){const t=(performance.now()-(S.firstT??performance.now()-300))/1000;
  const expected=Math.max(1,S.key.length/3.2);
  return{t,perf:clamp(expected/Math.max(t,.15),.2,2.5)}}

function award(perf){if(!S.errSt){S.combo++;if(S.combo>S.maxCombo)S.maxCombo=S.combo;
    if(S.combo%5===0)sCombo()}
  $("cCombo").textContent=S.combo;
  const pts=Math.round(S.key.length*10*clamp(perf,.5,2)*(1+Math.min(S.combo,20)*.1));
  S.score+=pts;$("cScore").textContent=S.score;
  const pop=$("pop");pop.textContent="+"+pts;pop.classList.remove("on");void pop.offsetWidth;pop.classList.add("on");
  return pts}

function heatOf(perf){return perf>=1.15?"good":perf>=.7?"mid":"bad"}

function completeStation(){
  const i=S.idx,{t,perf}=stationPerf();
  S.heats[i]=heatOf(perf);S.times[i]=t;S.perfs.push(perf);
  award(perf);sDing();
  const a=S.seq[i-1],b=S.seq[i],km=S.segs[i-1],cap=S.line.cap;
  const vmax=cap*clamp(.3+perf*.35,.35,1);
  const dur=clamp((500+km*520)/clamp(perf,.55,2.4),380,2800);
  S.travels.push({a,b,km,vmax,dur,idx:i});
  S.idx++;setPrompt()}

/* ---------- travel / arrival ---------- */
function angleTo(i,j){const a=S.seq[i],b=S.seq[j];return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}
function placeTrain(x,y,ang){$("trainG").setAttribute("transform",`translate(${x} ${y})`);
  $("trainR").setAttribute("transform",`rotate(${ang})`)}

function arrive(tr){S.distDone+=tr.km;S.dist=S.distDone;
  const st=tr.b,n=nodes[st.zh],reg=REG.get(st.zh);
  if(n){if(reg&&reg.lines.length<=1)n.dot.setAttribute("fill",S.line.color);
    n.heat.setAttribute("stroke",HEATC[S.heats[tr.idx]||"good"]);
    if(n.zh)n.zh.style.fill=S.line.color}
  movePulse();
  if(tr.idx===S.seq.length-1){finishRun()}
  else announce(`到达 ${st.zh} · ${st.py}`)}

function movePulse(){gMap.querySelectorAll(".pulseHolder").forEach(p=>{p.setAttribute("opacity","0");p.classList.remove("pulse")});
  const st=S.seq[S.idx];if(!st)return;const n=nodes[st.zh];
  if(n&&n.pulse){n.pulse.setAttribute("opacity","1");n.pulse.classList.add("pulse");
    n.pulse.setAttribute("stroke",S.line.color)}}

let toastTimer=null;
function announce(msg){const t=$("toast");t.textContent=msg;t.classList.add("on");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("on"),2100)}

function finishRun(){S.done=true;S.endT=performance.now();
  inp.disabled=true;camFollow=false;fitAll(false);
  sWin();confetti();announce("终点站 · Terminus reached!");
  setTimeout(showResult,1200)}

/* ---------- boss flow ---------- */
function bossComplete(){const{t,perf}=stationPerf();
  S.heats[S.bossI]=heatOf(perf);S.times[S.bossI]=t;S.perfs.push(perf);
  award(perf);sDing();S.bossDone++;S.bossI++;
  if(S.t0===null)S.t0=performance.now();
  if(S.bossI>=S.bossList.length)bossFinish(true);else setBossPrompt()}

function bossTimeout(){if(S.revealing)return;S.revealing=true;
  S.lives--;$("lives").textContent="♥".repeat(S.lives)+"♡".repeat(3-S.lives);
  S.heats[S.bossI]="bad";S.times[S.bossI]=S.bossSec;S.combo=0;$("cCombo").textContent="0";
  $("py").classList.add("reveal");
  // reveal full answer
  const el=$("py");el.querySelectorAll(".c").forEach(c=>c.classList.remove("todo","next","done"));
  sLose();shake();
  setTimeout(()=>{S.bossI++;
    if(S.lives<=0||S.bossI>=S.bossList.length)bossFinish();
    else setBossPrompt()},1100)}

function bossFinish(){S.done=true;S.endT=performance.now();inp.disabled=true;
  if(S.lives<=0)sLose();
  else{sWin();if(S.bossDone===S.bossList.length)confetti()}
  setTimeout(showResult,900)}

/* ---------- result ---------- */
function showResult(){show("result");
  const boss=S.mode==="boss";
  const total=(S.endT&&S.t0)?S.endT-S.t0:0;
  const min=Math.max(total/60000,.001);
  const wpm=Math.round(S.correct/5/min);
  const acc=S.correct+S.errors?Math.round(100*S.correct/(S.correct+S.errors)):100;
  const avgPerf=S.perfs.length?S.perfs.reduce((a,b)=>a+b,0)/S.perfs.length:0;
  let stars=1;if(acc>=88&&avgPerf>=.65)stars=2;if(acc>=96&&avgPerf>=1.1)stars=3;
  if(boss&&S.lives<=0)stars=1;
  const medal=stars===3?"🏆":stars===2?"🥈":"🥉";
  const title=stars===3?"王牌司机 ACE DRIVER":stars===2?"熟练司机 SKILLED DRIVER":"见习司机 TRAINEE DRIVER";
  $("rMedal").textContent=medal;$("rStars").textContent="★★★".slice(0,stars)+"☆☆☆".slice(0,3-stars);
  const nb=$("newbest");$("rTitle").childNodes[0].nodeValue=title;
  const col=boss?"#e5484d":S.line.color;
  $("rcard").style.setProperty("--lc",col);
  $("rAgain").style.setProperty("--cc",col);$("rAgain").style.background=col;
  $("rSub").textContent=boss
    ?`长站名挑战 · 完成 ${S.bossDone}/${S.bossList.length} · 剩余 ${"♥".repeat(S.lives)||"—"}`
    :`${S.line.num} 号线 ${S.line.en} · ${S.seq[0].zh} → ${S.seq[S.seq.length-1].zh}`;
  const cells=[["用时 TIME",fmtT(total),""],
    boss?["完成 CLEARED",S.bossDone+"/"+S.bossList.length,""]:["里程 DIST",S.dist.toFixed(1),"km"],
    boss?["生命 LIVES",S.lives,"♥"]:["极速 TOP SPEED",Math.round(S.topV),"km/h"],
    ["键速 SPEED",wpm,"wpm"],["准确率 ACC",acc,"%"],["最高连击 COMBO","×"+S.maxCombo,""],
    ["失误 ERRORS",S.errors,""],["得分 SCORE",S.score,""]];
  $("rGrid").innerHTML=cells.map(c=>`<div class="rcell"><label>${c[0]}</label><b>${c[1]}<small> ${c[2]}</small></b></div>`).join("");
  // heat strip + fastest/slowest
  const hs=$("heatstrip");hs.innerHTML="";
  const list=boss?S.bossList:S.seq;
  let fi=-1,si=-1;
  list.forEach((st,i)=>{const cell=document.createElement("i");
    const h=boss?S.heats[i]:(i===0?"good":S.heats[i]);
    if(h)cell.classList.add(h);
    const t=S.times[i];
    cell.title=st.zh+(t!=null?` · ${t.toFixed(1)}s`:"");
    if(t!=null&&(boss?true:i>0)){if(fi<0||t<S.times[fi])fi=i;if(si<0||t>S.times[si])si=i}
    hs.appendChild(cell)});
  $("fastslow").innerHTML=(fi>=0?`⚡ 最快 Fastest：<b>${list[fi].zh}</b>（${S.times[fi].toFixed(1)}s）　`:"")+
    (si>=0?`🐢 最慢 Slowest：<b>${list[si].zh}</b>（${S.times[si].toFixed(1)}s）`:"");
  // session best
  const key=boss?"boss":S.line.id;
  const isBest=!bests[key]||S.score>bests[key].score;
  if(isBest)bests[key]={score:S.score,time:fmtT(total),acc};
  nb.hidden=!isBest;
  renderCards()}

/* ---------- menu cards ---------- */
function renderCards(){const wrap=$("cards");wrap.innerHTML="";
  const order=[...LINES].sort((a,b)=>a.diff-b.diff);
  order.forEach((L,i)=>{const lvl=i+1,rev=!!dirState[L.id];
    const a=L.stations[0].zh,b=L.stations[L.stations.length-1].zh;
    const best=bests[L.id];
    const card=document.createElement("div");card.className="card";card.style.setProperty("--cc",L.color);
    card.innerHTML=`
      <div class="lvl">LEVEL ${lvl} · 难度 <b>${"★".repeat(lvl)}${"☆".repeat(3-lvl)}</b></div>
      <div class="lrow"><div class="lnum">${L.num}</div>
        <div class="lname">${L.zh}<small>${L.en}</small></div></div>
      <div class="term"><span class="tt">${rev?b:a} → ${rev?a:b}</span>
        <button class="rev" title="换向 Reverse direction">⇄</button></div>
      <div class="meta">${L.stations.length} 站 · ≈${Math.round(L.km)} km · 平均 ${L.avgLen.toFixed(1)} 字母/站</div>
      <div class="fact">${L.fact}</div>
      ${best?`<div class="best">本次最佳 Session best：${best.score} 分 · ${best.time} · ${best.acc}%</div>`:""}
      <button class="go">出发 DEPART</button>`;
    card.querySelector(".rev").onclick=e=>{e.stopPropagation();dirState[L.id]=!dirState[L.id];
      card.querySelector(".tt").textContent=dirState[L.id]?`${b} → ${a}`:`${a} → ${b}`};
    card.querySelector(".go").onclick=()=>startLine(L,!!dirState[L.id]);
    wrap.appendChild(card)});
  // boss card
  const bb=bests["boss"];
  const bc=document.createElement("div");bc.className="card boss";
  bc.innerHTML=`
    <div class="lvl">LEVEL 4 · <b style="color:var(--bad)">BOSS</b></div>
    <div class="lrow"><div class="lnum">★</div>
      <div class="lname">长站名挑战<small>LONG-NAME GAUNTLET</small></div></div>
    <div class="meta">${BOSS.length} 个最长站名 · 限时输入 · ♥ ×3</div>
    <div class="fact">全网络最长的站名轮番上阵——从 ${BOSS[BOSS.length-1].zh} 一路打到 ${BOSS[0].zh}（${BOSS[0].key.length} 个字母！）。超时即失去一颗心。</div>
    ${bb?`<div class="best">本次最佳 Session best：${bb.score} 分 · ${bb.time} · ${bb.acc}%</div>`:""}
    <button class="go" style="background:linear-gradient(90deg,var(--bad),var(--amber))">挑战 CHALLENGE</button>`;
  bc.querySelector(".go").onclick=startBoss;
  wrap.appendChild(bc)}

/* ---------- gauge ---------- */
let gaugeCap=80;
function setGauge(v,cap){gaugeCap=cap;const g=$("gauge");
  let s=`<path d="M 26 104 A 74 74 0 0 1 174 104" fill="none" stroke="#1a2540" stroke-width="9" stroke-linecap="round"/>`;
  // redline (last ~18% of the sweep)
  const rx=(100+74*Math.cos(Math.PI*.18)).toFixed(1),ry=(104-74*Math.sin(Math.PI*.18)).toFixed(1);
  s+=`<path d="M ${rx} ${ry} A 74 74 0 0 1 174 104" fill="none" stroke="rgba(229,72,77,.55)" stroke-width="9" stroke-linecap="round"/>`;
  for(let i=0;i<=8;i++){const ang=Math.PI*i/8,c=Math.cos(ang),si=Math.sin(ang);
    s+=`<line x1="${100-66*c}" y1="${104-66*si}" x2="${100-74*c}" y2="${104-74*si}" stroke="#3a4a68" stroke-width="2"/>`}
  s+=`<text x="24" y="120" fill="#55627a" font-size="10" font-family="ui-monospace,Menlo,Consolas,monospace">0</text>`;
  s+=`<text x="168" y="120" fill="#55627a" font-size="10" font-family="ui-monospace,Menlo,Consolas,monospace" text-anchor="middle">${cap}</text>`;
  s+=`<text x="100" y="34" fill="#55627a" font-size="9" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace">MAX ${cap} km/h</text>`;
  s+=`<g id="needleG" transform="rotate(0,100,104)"><line x1="100" y1="104" x2="34" y2="104" stroke="#ffb020" stroke-width="3.5" stroke-linecap="round"/></g>`;
  s+=`<circle cx="100" cy="104" r="6" fill="#0b1322" stroke="#3a4a68" stroke-width="2"/>`;
  s+=`<text id="gaugeV" x="100" y="86" fill="#e9eef6" font-size="24" font-weight="700" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace">0</text>`;
  s+=`<text x="100" y="99" fill="#55627a" font-size="8.5" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace">km/h</text>`;
  g.innerHTML=s}
function gaugeTo(v){const deg=clamp(v/gaugeCap,0,1)*180;
  const n=document.getElementById("needleG");if(n)n.setAttribute("transform",`rotate(${deg},100,104)`);
  const t=document.getElementById("gaugeV");if(t)t.textContent=Math.round(v)}

/* ---------- live chips ---------- */
function updLive(){if(S.t0===null)return;
  const now=S.endT||performance.now(),min=Math.max((now-S.t0)/60000,.001);
  $("cWpm").textContent=Math.round(S.correct/5/min);
  const tot=S.correct+S.errors;
  $("cAcc").firstChild.nodeValue=tot?Math.round(100*S.correct/tot):100}

/* ---------- main loop ---------- */
let lastF=performance.now();
function tick(now){const dt=Math.min(.05,(now-lastF)/1000);lastF=now;
  // camera
  cam.cx+=(camT.cx-cam.cx)*.09;cam.cy+=(camT.cy-cam.cy)*.09;cam.w+=(camT.w-cam.w)*.09;
  if(S.screen==="game"&&S.mode==="line"){
    if(!S.trav&&S.travels.length)
      {S.trav=S.travels.shift();S.trav.t0=now}
    if(S.trav){const tr=S.trav,p=clamp((now-tr.t0)/tr.dur,0,1),e=easeIO(p);
      const x=tr.a.x+(tr.b.x-tr.a.x)*e,y=tr.a.y+(tr.b.y-tr.a.y)*e;
      const ang=Math.atan2(tr.b.y-tr.a.y,tr.b.x-tr.a.x)*180/Math.PI;
      placeTrain(x,y,ang);
      S.dist=S.distDone+tr.km*e;
      S.tgtV=tr.vmax*Math.sin(Math.PI*p);
      if(camFollow){camT.cx=x;camT.cy=y;camT.w=470}
      if(p>=1){S.trav=null;arrive(tr)}}
    else{S.tgtV=0;
      if(camFollow&&!S.done){const prev=S.seq[Math.max(0,Math.min(S.idx-1,S.seq.length-1))];
        camT.cx=prev.x;camT.cy=prev.y;camT.w=470}}
    S.dispV+=(S.tgtV-S.dispV)*Math.min(1,dt*6);
    if(S.dispV>S.topV)S.topV=S.dispV;
    gaugeTo(S.dispV);
    $("cDist").firstChild.nodeValue=S.dist.toFixed(1);
    if(S.t0&&!S.done)$("cTime").textContent=fmtT(now-S.t0);
    applyCam()}
  if(S.screen==="game"&&S.mode==="boss"&&!S.done){
    if(S.t0&&!S.done)$("cTime").textContent=fmtT(now-S.t0);
    if(!S.revealing&&S.key){const rem=Math.max(0,S.deadline-now),frac=rem/(S.bossSec*1000);
      const arc=document.getElementById("ringArc");
      arc.setAttribute("stroke-dashoffset",(94.2*(1-frac)).toFixed(1));
      arc.setAttribute("stroke",frac<.3?"#e5484d":"#ffb020");
      $("ringSec").textContent=Math.ceil(rem/1000);
      if(rem<=0)bossTimeout()}}
  requestAnimationFrame(tick)}
requestAnimationFrame(tick);

/* ---------- quit / nav ---------- */
function quit(){if(S.screen!=="game")return;
  if(S.done||confirm("退出本次行程？Quit this run?")){show("menu");renderCards()}}
$("homeBtn").onclick=quit;
$("rAgain").onclick=()=>{if(!lastRun)return;lastRun.mode==="boss"?startBoss():startLine(lastRun.L,lastRun.rev)};
$("rBack").onclick=()=>{show("menu");renderCards()};

/* ---------- overview map + legend + boot ---------- */
(function boot(){
  const ov=$("ovMap");buildMap(ov,{});
  requestAnimationFrame(()=>{try{const bb=ov.getBBox(),p=46;
    ov.setAttribute("viewBox",`${bb.x-p} ${bb.y-p} ${bb.width+p*2} ${bb.height+p*2}`)}catch(e){
    ov.setAttribute("viewBox","0 0 1050 1180")}});
  $("legend").innerHTML=LINES.map(L=>`<span class="lg"><i style="background:${L.color}"></i>${L.num} 号线 ${L.en}</span>`).join("")+
    `<span class="lg"><i style="background:#e9eef6"></i>换乘站 Interchange</span>`;
  ov.addEventListener("click",e=>{const p=e.target.closest(".lpath");if(!p)return;
    document.querySelectorAll(".card").forEach(c=>{if(c.querySelector(".lnum")&&c.style.getPropertyValue("--cc")===LINES.find(L=>L.id===p.dataset.line).color){
      c.scrollIntoView({behavior:"smooth",block:"center"})}})});
  renderCards();
  document.querySelector("#menu .footnote").insertAdjacentText("beforeend"," · v"+APP_VERSION);
  window.addEventListener("resize",()=>{if(S.screen==="game"&&!camFollow)fitAll(true)});
})();
