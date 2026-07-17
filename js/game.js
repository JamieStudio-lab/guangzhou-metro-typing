const APP_VERSION="0.4.5";
// feel knobs: CRUISE_CPS (chars/s) sets the km/h display scale — typing at it on an
// average segment reads ≈the line cap. The train is driven directly by typed letters:
// it pursues the earned track with time constant CHASE (s), never closing slower than
// ARRIVE_V of the cap, so a name's last letter lands it on that platform in ~0.3 s.
// EASE blends the per-name distance mapping toward a smoothstep S-curve (0 = linear,
// 1 = full stop at platforms): the train pulls away gently and brakes into each stop
// while the curve's 1→1 endpoint keeps arrival synchronized with the last letter.
const CRUISE_CPS=5.5,CHASE=.17,ARRIVE_V=.3,EASE=.7;
// per-line ease scaling (L.ease 1 = easiest line, 0 = hardest): flames light at a
// lower speed fraction, big flames at lower combos, combo score step more generous
const HOT_ON=e=>.84-.14*e,HOT_HYS=.1,TIER2=e=>Math.round(10-4*e),CSTEP=e=>.1+.04*e;

// project GEO lat/lon (js/geo.js, OSM data) → SVG units, keyed by 汉字.
// Equirectangular around Guangzhou; K≈34 units/km keeps dot/stroke/label sizes sane.
// Keying by 汉字 gives transfer stations identical coords on every line.
const GEOPOS=(()=>{if(typeof GEO==="undefined")return null;
  const pos=new Map(),K=3800,COS=Math.cos(23.09*Math.PI/180),LON0=113.1981,LAT0=23.2557;
  for(const gl of GEO.lines)for(const s of gl.stations)
    if(!pos.has(s.zh))pos.set(s.zh,{x:+((s.lon-LON0)*COS*K).toFixed(1),y:+((LAT0-s.lat)*K).toFixed(1)});
  return pos})();

// normalize station tuples → objects, compute keys (x/y from geo, tuple values as fallback)
for(const L of LINES){
  L.stations=L.st.map(t=>{const g=GEOPOS&&GEOPOS.get(t[0]);
    if(GEOPOS&&!g)console.warn("no geo position for "+t[0]);
    return{zh:t[0],py:t[1],x:g?g.x:t[2],y:g?g.y:t[3],lb:t[4],tr:t[5]||null,key:normPy(t[1])}});
  delete L.st;
  L.km=L.segKm.reduce((a,b)=>a+b,0);
  L.letters=L.stations.reduce((a,s)=>a+s.key.length,0);
  L.avgLen=L.letters/L.stations.length;
  L.diff=L.avgLen+L.stations.length*0.09;
}
{const ds=LINES.map(L=>L.diff),lo=Math.min(...ds),hi=Math.max(...ds);
  for(const L of LINES)L.ease=hi>lo?1-(L.diff-lo)/(hi-lo):.5}
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
function diffOf(len){return len<=7?{k:"good",t:"diffShort"}:len<=12?{k:"mid",t:"diffMid"}:{k:"bad",t:"diffLong"}}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

/* ---------- i18n ---------- */
const store={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},
  set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
const T={
zh:{lang:"中文",sound:"音效",dark:"深色",light:"浅色",system:"跟随系统",quitBtn:"⏏ 退出",
  setBtn:"设置",setTitle:"设置",setTheme:"主题",setLang:"语言 (Language)",
  startBtn:"选择关卡",backTop:"↑ 首页",
  footnote:"☆ 本作为粉丝自制打字游戏，收录广州地铁全网 19 条线路（含广佛线与 APM 线；十二号线暂为已通车东段，不含三号线机场支线与知识城线），站间距离为约值。未登录时成绩仅保存在本次会话中；登录后成绩会上传至全球排行榜。地理数据 © OpenStreetMap 贡献者 (ODbL)。",
  chipTime:"用时",chipDist:"里程",chipWpm:"键速",chipAcc:"准确率",chipCombo:"连击",chipScore:"得分",
  bossTitle:"长站名挑战",bossDesc:`${BOSS.length} 个最长站名 · 限时输入 · 超时扣 ♥`,
  nextStop:"下一站",upNext:"接下来",arriving:"即将到达",terminus:"终点站",beatClock:"限时挑战",
  diffShort:"短",diffMid:"中",diffLong:"长",
  placeholder:"在此输入拼音…",inHint:"无声调 · 空格可省",inputAria:"输入站名拼音（无声调）",
  kbWarn:"请切换到英文键盘",
  origin:"始发站",depart:z=>`始发站 ${z} · 输入本站拼音开始`,
  doors:"车门已关闭 · 输入下一站拼音发车",arriveAt:(z,p)=>`到达 ${z} · ${p}`,
  terminusReached:"到达终点站！",quitConfirm:"退出本次行程？",
  titles:["见习司机","熟练司机","王牌司机"],
  bossSub:(d,n,h)=>`长站名挑战 · 完成 ${d}/${n} · 剩余 ${h}`,
  lineSub:(L,a,b)=>`${L.zh} · ${a} → ${b}`,
  rTime:"用时",rCleared:"完成",rLives:"生命",rDist:"里程",rTop:"极速",rSpeed:"键速",
  rAcc:"准确率",rCombo:"最高连击",rErr:"失误",rScore:"得分",
  fastest:(z,s)=>`⚡ 最快：<b>${z}</b>（${s}s）　`,slowest:(z,s)=>`🐢 最慢：<b>${z}</b>（${s}s）`,
  heatTitle:"每站颜色 = 输入速度",again:"再来一次",back:"选择线路",
  lineName:L=>L.zh,revTitle:"换向",revBtn:"换向",
  stops:n=>`${n} 站`,bossCount:n=>`${n} 词`,
  sortBy:"排序",sortNum:"线路",sortStops:"站数",sortDiff:"难度",
  diffEasy:"简单",diffMedium:"中等",diffHard:"困难",diffImp:"极难",diffAria:d=>`难度：${d}`,
  statKm:"线路全长",statLetters:"拼音总量",statAvg:"平均每站",
  bossWords:"挑战词数",bossLongest:"最长站名",bossLives:"生命",
  uLetters:"字母",uPerStop:"字母/站",uWords:"词",
  best:b=>`本次最佳：${b.score} 分 · ${b.time} · ${b.acc}%`,
  go:"出发",challenge:"挑战",
  bossFact:`全网络最长的站名轮番上阵——从 ${BOSS[BOSS.length-1].zh} 一路打到 ${BOSS[0].zh}（${BOSS[0].key.length} 个字母！）。超时即失去一颗心。`,
  interchange:"换乘站",
  accLogin:"登录",accTitle:"账号",accNick:"昵称",accEmail:"邮箱",accPw:"密码",
  accDoReg:"注册",accToReg:"没有账号？注册一个 →",accToLogin:"已有账号？直接登录 →",
  accClose:"关闭",accLogout:"退出登录",
  accSync:"语言与主题随账号同步，完成行程后成绩自动上传排行榜。",
  accBadges:"我的徽章",accNoBadges:"还没有徽章 — 跑完一条线路就能拿到第一枚！",
  accRecords:"我的纪录",recEmpty:"还没有成绩 — 完成一局就会出现在这里！",
  recErr:"纪录暂时加载不出来",
  accNeedNick:"起个昵称吧（显示在排行榜上，2–20 个字符）",
  accNickTaken:"昵称已被占用，换一个试试",accNickShort:"昵称至少 2 个字符",
  accBadCred:"邮箱或密码不正确",accEmailUsed:"该邮箱已注册，试试直接登录",
  accWeakPw:"密码至少 6 位",accBadEmail:"邮箱格式不正确",
  accInvite:"邀请码",accNeedInvite:"请输入邀请码",accBadInvite:"邀请码无效或已用完",
  accStale:"登录状态已失效（账号可能已被删除），请重新注册",
  accNetErr:"网络不可用，可继续离线游玩",accConfirm:"请先到邮箱确认，再回来登录",
  lbTitle:"全球排行榜",lbBoss:"长站名",lbLoading:"加载中…",
  lbEmpty:"虚位以待 — 登录后完成一局即可上榜！",lbErr:"排行榜暂时加载不出来",
  cloudSaved:r=>`☁ 成绩已上传 · 当前全球第 ${r} 名`,cloudSavedNoRank:"☁ 成绩已上传",
  cloudMyBest:r=>`个人第 ${r} 佳`,cloudPB:"个人新纪录！",
  cloudErr:"☁ 成绩上传失败（本局成绩仍在本页显示）",badgeNew:"新徽章",
  badge_first:"初次通勤",badge_line:L=>`${L.zh}通关`,
  badge_star3:"三星司机",badge_boss:"长名克星",badge_wpm60:"高速动车",badge_wpm100:"磁悬浮",
  badge_combo20:"连击达人",badge_acc100:"零失误"},
en:{lang:"English",sound:"SOUND",dark:"DARK",light:"LIGHT",system:"SYSTEM",quitBtn:"⏏ Quit",
  setBtn:"SETTINGS",setTitle:"SETTINGS",setTheme:"THEME",setLang:"LANGUAGE",
  startBtn:"SELECT LEVEL",backTop:"↑ TOP",
  footnote:"☆ Fan-made typing game, not affiliated with Guangzhou Metro. All 19 lines of the 2026 network (incl. Guangfo Line and the APM; Line 12 is its opened east section — the Line 3 airport branch and Knowledge City line aren't modeled); distances are approximate. Signed out, scores live in this session only; sign in to upload runs to the global leaderboard. Map data © OpenStreetMap contributors (ODbL).",
  chipTime:"TIME",chipDist:"DIST",chipWpm:"WPM",chipAcc:"ACC",chipCombo:"COMBO",chipScore:"SCORE",
  bossTitle:"LONG-NAME GAUNTLET",bossDesc:`The ${BOSS.length} longest names · beat the clock · timeouts cost ♥`,
  nextStop:"NEXT STOP",upNext:"THEN",arriving:"ARRIVING",terminus:"Terminus",beatClock:"BEAT THE CLOCK",
  diffShort:"SHORT",diffMid:"MEDIUM",diffLong:"LONG",
  placeholder:"type pinyin here…",inHint:"toneless · no spaces needed",inputAria:"Type the station name in pinyin",
  kbWarn:"Please switch to an English keyboard",
  origin:"ORIGIN",depart:z=>`Origin ${z} · type this station to begin`,
  doors:"Doors closed · type the next stop to depart",arriveAt:(z,p)=>`Now at ${z} · ${p}`,
  terminusReached:"Terminus reached!",quitConfirm:"Quit this run?",
  titles:["TRAINEE DRIVER","SKILLED DRIVER","ACE DRIVER"],
  bossSub:(d,n,h)=>`Long-Name Gauntlet · cleared ${d}/${n} · ${h} left`,
  lineSub:(L,a,b)=>`${L.en} · ${a} → ${b}`,
  rTime:"TIME",rCleared:"CLEARED",rLives:"LIVES",rDist:"DIST",rTop:"TOP SPEED",rSpeed:"SPEED",
  rAcc:"ACC",rCombo:"MAX COMBO",rErr:"ERRORS",rScore:"SCORE",
  fastest:(z,s)=>`⚡ Fastest: <b>${z}</b> (${s}s)　`,slowest:(z,s)=>`🐢 Slowest: <b>${z}</b> (${s}s)`,
  heatTitle:"cell color = typing speed",again:"REPLAY",back:"CHOOSE LINE",
  lineName:L=>L.en,revTitle:"Reverse direction",revBtn:"Reverse",
  stops:n=>`${n} stops`,bossCount:n=>`${n} words`,
  sortBy:"SORT",sortNum:"LINE",sortStops:"STOPS",sortDiff:"DIFFICULTY",
  diffEasy:"EASY",diffMedium:"MEDIUM",diffHard:"HARD",diffImp:"INSANE",diffAria:d=>`Difficulty: ${d}`,
  statKm:"LINE LENGTH",statLetters:"LETTERS TO TYPE",statAvg:"AVG PER STOP",
  bossWords:"WORDS TO CLEAR",bossLongest:"LONGEST NAME",bossLives:"LIVES",
  uLetters:"letters",uPerStop:"per stop",uWords:"words",
  best:b=>`Session best: ${b.score} pts · ${b.time} · ${b.acc}%`,
  go:"DEPART",challenge:"CHALLENGE",
  bossFact:`The network's longest station names, from ${BOSS[BOSS.length-1].zh} all the way up to ${BOSS[0].zh} (${BOSS[0].key.length} letters!). Run out of time and you lose a heart.`,
  interchange:"Interchange",
  accLogin:"SIGN IN",accTitle:"Account",accNick:"Nickname",accEmail:"Email",accPw:"Password",
  accDoReg:"SIGN UP",accToReg:"No account? Sign up →",accToLogin:"Have an account? Sign in →",
  accClose:"CLOSE",accLogout:"SIGN OUT",
  accSync:"Language & theme sync with your account; finished runs upload to the leaderboard.",
  accBadges:"My badges",accNoBadges:"No badges yet — finish any line to earn your first!",
  accRecords:"My records",recEmpty:"No runs yet — finish one and it'll show up here!",
  recErr:"Records unavailable right now",
  accNeedNick:"Pick a nickname (shown on the leaderboard, 2–20 chars)",
  accNickTaken:"Nickname taken — try another",accNickShort:"Nickname needs 2+ characters",
  accBadCred:"Wrong email or password",accEmailUsed:"Email already registered — try signing in",
  accWeakPw:"Password needs 6+ characters",accBadEmail:"That email doesn't look right",
  accInvite:"Invite code",accNeedInvite:"Enter an invite code",accBadInvite:"Invalid or used-up invite code",
  accStale:"Session no longer valid (account may have been deleted) — please sign up again",
  accNetErr:"Network unavailable — offline play still works",accConfirm:"Confirm your email first, then sign in",
  lbTitle:"GLOBAL LEADERBOARD",lbBoss:"GAUNTLET",lbLoading:"Loading…",
  lbEmpty:"Nobody here yet — sign in and finish a run to claim it!",lbErr:"Leaderboard unavailable right now",
  cloudSaved:r=>`☁ Score uploaded · #${r} worldwide`,cloudSavedNoRank:"☁ Score uploaded",
  cloudMyBest:r=>`your #${r} best`,cloudPB:"new personal best!",
  cloudErr:"☁ Upload failed (score still shown here)",badgeNew:"NEW",
  badge_first:"First Ride",badge_line:L=>`${L.en} Cleared`,
  badge_star3:"Triple Star",badge_boss:"Gauntlet Slayer",badge_wpm60:"Bullet Train",badge_wpm100:"Maglev",
  badge_combo20:"Combo Master",badge_acc100:"Flawless"}};
let LANG=store.get("lang")||"zh"; // Chinese is the default since v0.4.0
const t=(k,...a)=>{const v=T[LANG][k];return typeof v==="function"?v(...a):v};
// line descriptions in data.js are bilingual {zh,en}
const descOf=L=>L.desc[LANG]||L.desc.zh;
function setLang(l){LANG=l;store.set("lang",l);
  document.documentElement.lang=l==="zh"?"zh-Hans":"en";
  document.querySelectorAll("[data-i18n]").forEach(el=>{el.textContent=t(el.dataset.i18n)});
  $("langBtn").textContent=t("lang");
  paintTheme(); // theme button label follows the active language
  document.querySelector("#menu .footnote").textContent=t("footnote")+" · v"+APP_VERSION;
  inp.placeholder=t("placeholder");inp.setAttribute("aria-label",t("inputAria"));
  $("heatstrip").title=t("heatTitle");
  renderLegend();renderCards();
  if(typeof cloudLangRefresh==="function")cloudLangRefresh();
  if(S.screen==="game")refreshBoardLang();
  if(S.screen==="result")showResult(true)}
function refreshBoardLang(){const st=curStation();
  if(S.mode==="boss"){$("brdLabel").textContent=t("beatClock");
    if(st&&!S.done)$("dTag").textContent=t(diffOf(st.key.length).t)+" · "+st.key.length}
  else if(st){$("brdLabel").textContent=t(S.idx===0?"origin":"nextStop");
    $("dTag").textContent=t(diffOf(st.key.length).t)}
  else{$("brdLabel").textContent=t("arriving");$("zhTxt").textContent=t("terminus")}
  setNextUp()}
const LANGS=["zh","en"]; // ordered; arrows step through and wrap (room for more languages later)
function cycleLang(dir){const i=(LANGS.indexOf(LANG)+dir+LANGS.length)%LANGS.length;setLang(LANGS[i])}
$("langBtn").onclick=()=>cycleLang(1);
$("langPrev").onclick=()=>cycleLang(-1);
$("langNext").onclick=()=>cycleLang(1);

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
$("soundBtn").onclick=()=>{muted=!muted;const b=$("soundBtn");
  b.classList.toggle("on",!muted);b.setAttribute("aria-checked",String(!muted))};

/* ---------- theme ---------- */
// THEME holds the preference (light|dark|system); dataset.theme holds the resolved look.
// dark stays the default (v0.4.0); "system" follows the OS via mqDark, live.
const themeMeta=document.querySelector('meta[name="theme-color"]');
const THEME_ORDER=["light","dark","system"]; // click cycles in this order
const mqDark=matchMedia("(prefers-color-scheme:dark)");
let THEME=store.get("theme")||"dark";
const resolveTheme=p=>p==="system"?(mqDark.matches?"dark":"light"):p;
function paintTheme(){const r=resolveTheme(THEME);
  document.documentElement.dataset.theme=r;
  themeMeta.setAttribute("content",r==="light"?"#f5f1e8":"#0b101c");
  const b=$("themeBtn");b.textContent=t(THEME);b.setAttribute("aria-label",t("setTheme")+" · "+t(THEME))}
function setTheme(p){THEME=p;paintTheme()}
const onMq=()=>{if(THEME==="system")paintTheme()}; // re-resolve when the OS flips, while in system mode
mqDark.addEventListener?mqDark.addEventListener("change",onMq):mqDark.addListener(onMq);
setTheme(THEME);
$("themeBtn").onclick=()=>{const p=THEME_ORDER[(THEME_ORDER.indexOf(THEME)+1)%THEME_ORDER.length];
  setTheme(p);store.set("theme",p)};

function confetti(){const fx=$("fx"),cols=LINES.map(L=>L.color);
  for(let i=0;i<30;i++){const e=document.createElement("i");
    e.style.left=Math.random()*100+"vw";e.style.background=cols[i%cols.length];
    e.style.animationDuration=1.5+Math.random()*1.2+"s";e.style.animationDelay=Math.random()*.3+"s";
    fx.appendChild(e);setTimeout(()=>e.remove(),3200)}}

/* ============================================================
   MAP BUILDING (geographic SVG — station positions from js/geo.js)
============================================================ */
// Pearl River, sketched in projected coords: front channel past 白鹅潭/海珠广场/广州塔,
// back channel between 南洲·沥滘 and the 洛溪 island
const RIVERS=[
 "M 20 680 C 70 640 105 590 130 562 C 170 520 245 548 330 545 C 390 537 400 530 440 528 C 520 524 620 545 700 535",
 "M 130 562 C 150 620 200 680 280 730 C 330 762 370 775 430 782 C 510 791 600 780 680 800"];

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
    case"l": st.tr?set("end",st.x-23,st.y-8,st.y+5,st.y+16):set("end",st.x-23,st.y-2,st.y+11,0);break;
    case"r": st.tr?set("start",st.x+23,st.y-8,st.y+5,st.y+16):set("start",st.x+23,st.y-2,st.y+11,0);break;
    case"a": set("middle",st.x,st.y-26,st.y-14,st.y-38);break;
    case"b": set("middle",st.x,st.y+28,st.y+41,st.y+53);break;
    case"ul":set("end",st.x-16,st.y-23,st.y-11,st.y-35);break;
    case"ur":set("start",st.x+16,st.y-23,st.y-11,st.y-35);break;
    case"bl":set("end",st.x-17,st.y+35,st.y+49,st.y+61);break;
    case"br":set("start",st.x+17,st.y+35,st.y+49,st.y+61);break;
  }
  let out=`<g text-anchor="${A.anchor}" data-ta="${A.anchor}" data-sx="${st.x}" data-sy="${st.y}" data-lx="${A.x}" data-ly="${A.zy}">`;
  out+=zh.replace("<text ",`<text x="${A.x}" y="${A.zy}" `);
  out+=py.replace("<text ",`<text x="${A.x}" y="${A.py}" `);
  if(trt)out+=trt.replace("<text ",`<text x="${A.x}" y="${A.ty}" `);
  return out+"</g>"}

// polyline through the stations with rounded corners: each interior vertex becomes
// a quadratic bend, radius clamped to half the shorter adjacent segment
function roundPath(pts,rMax=14){
  let d="M"+pts[0].x+" "+pts[0].y;
  const f=n=>+n.toFixed(1);
  for(let i=1;i<pts.length-1;i++){const a=pts[i-1],v=pts[i],b=pts[i+1];
    const l1=Math.hypot(v.x-a.x,v.y-a.y)||1,l2=Math.hypot(b.x-v.x,b.y-v.y)||1;
    const r=Math.min(rMax,l1/2,l2/2);
    d+=` L${f(v.x-(v.x-a.x)/l1*r)} ${f(v.y-(v.y-a.y)/l1*r)}`;
    d+=` Q${v.x} ${v.y} ${f(v.x+(b.x-v.x)/l2*r)} ${f(v.y+(b.y-v.y)/l2*r)}`}
  return d+" L"+pts[pts.length-1].x+" "+pts[pts.length-1].y}

function buildMap(svg,opts){
  let s=`<g class="mrot">`; // rotatable wrapper — only #ovMap ever transforms it
  for(const r of RIVERS)s+=`<path class="riv" d="${r}"/>`;
  for(const L of LINES) // loop lines close back to their first station (decorative arc)
    s+=`<path class="lpath" data-line="${L.id}" d="${roundPath(L.loop?[...L.stations,L.stations[0]]:L.stations)}" stroke="${L.color}"/>`;
  for(const [zh,st] of REG){
    const inter=st.lines.length>1;
    s+=`<g class="stg" data-st="${zh}">`;
    s+=`<circle class="pulseHolder" data-p="${zh}" cx="${st.x}" cy="${st.y}" r="9" fill="none" stroke="#ffb020" stroke-width="2" opacity="0"/>`;
    s+=`<circle class="heat" data-h="${zh}" cx="${st.x}" cy="${st.y}" r="${inter?14:10}" fill="none" stroke="none" stroke-width="2.5"/>`;
    if(inter)s+=`<circle class="dot" data-d="${zh}" cx="${st.x}" cy="${st.y}" r="10" style="fill:var(--map-inter);stroke:var(--map-inter-ring)" stroke-width="3"/>`;
    else s+=`<circle class="dot" data-d="${zh}" cx="${st.x}" cy="${st.y}" r="5.5" style="fill:var(--map-dot-bg)" stroke="${st.lines[0].color}" stroke-width="3"/>`;
    s+=labelMarkup(st)+"</g>"}
  if(opts&&opts.train){
    s+=`<g id="trainG" opacity="0"><g id="trainR">
      <g id="trainFire" style="opacity:0" aria-hidden="true">
        <path class="fl" d="M-17 -5 C-30 -8 -37 -3 -47 0 C-37 3 -30 8 -17 5 Z" fill="#ffb020"/>
        <path class="fl f2" d="M-17 -3 C-25 -4.5 -30 -2 -35 0 C-30 2 -25 4.5 -17 3 Z" fill="#ff5a2a"/>
        <line class="sp" x1="-20" y1="-13" x2="-46" y2="-13" stroke="#ffb020" stroke-width="2" stroke-linecap="round"/>
        <line class="sp s2" x1="-20" y1="13" x2="-46" y2="13" stroke="#ffb020" stroke-width="2" stroke-linecap="round"/>
      </g>
      <ellipse cx="18.5" cy="0" rx="4.5" ry="3.2" fill="#fff6d8" opacity=".22"/>
      <rect x="-16" y="-7.5" width="32" height="15" rx="6.5" fill="#dfe7f3" stroke="#0a0f1a" stroke-width="2"/>
      <g id="trainBand" fill="#ffb020">
        <rect x="-14" y="-6.2" width="24" height="2.2" rx="1.1"/>
        <rect x="-14" y="4" width="24" height="2.2" rx="1.1"/>
      </g>
      <line x1="-6" y1="-7.5" x2="-6" y2="7.5" stroke="#0a0f1a" stroke-width="1.2" opacity=".3"/>
      <line x1="4" y1="-7.5" x2="4" y2="7.5" stroke="#0a0f1a" stroke-width="1.2" opacity=".3"/>
      <rect x="-13.5" y="-2.6" width="6" height="5.2" rx="1.3" fill="#b9c7da" stroke="#7c8ca4" stroke-width="1"/>
      <rect x="-3.5" y="-2.6" width="6" height="5.2" rx="1.3" fill="#b9c7da" stroke="#7c8ca4" stroke-width="1"/>
      <path d="M 10 -5.6 Q 14.8 0 10 5.6" fill="none" stroke="#22304a" stroke-width="2.8" stroke-linecap="round"/>
      <circle cx="14.6" cy="-3.4" r="1.5" fill="#fff6d8"/>
      <circle cx="14.6" cy="3.4" r="1.5" fill="#fff6d8"/>
    </g></g>`}
  svg.innerHTML=s+"</g>"}

/* ============================================================
   GAME STATE + ENGINE
============================================================ */
const S={screen:"menu",mode:null,line:null,rev:false,seq:[],segs:[],
  idx:0,key:"",typed:0,firstT:null,errSt:false,done:false,
  t0:null,endT:null,correct:0,errors:0,combo:0,maxCombo:0,score:0,
  heats:[],times:[],perfs:[],taps:[],dist:0,topV:0,dispV:0,avgV:0,
  pos:0,credit:0,arrivedI:0,hot:false,fireT:1,cum:[],kms:90,
  hotOn:.84,t2:10,t3:20,cstep:.1,
  bossList:[],bossI:0,lives:3,bossDone:0,deadline:0,bossSec:10,revealing:false};
const dirState={},bests={};
let lastRun=null;

const gMap=$("gMap"),mapWrap=$("mapWrap"),inp=$("pyin");
let cam={cx:370,cy:633,w:1150},camT={cx:370,cy:633,w:1150},camFollow=false,camPunch=0;
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
// frame just the ridden line (the whole 19-line network dwarfs any single run)
function fitSeq(instant){if(!S.seq.length)return fitAll(instant);
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const s of S.seq){x0=Math.min(x0,s.x);y0=Math.min(y0,s.y);x1=Math.max(x1,s.x);y1=Math.max(y1,s.y)}
  const pad=90,asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight)); // pad covers side labels
  camT={cx:(x0+x1)/2,cy:(y0+y1)/2,w:Math.max(x1-x0+pad*2,(y1-y0+pad*2)*asp)};
  camFollow=false;if(instant){cam={...camT};applyCam()}}

const HEATC={good:"#2fbf71",mid:"#f0b429",bad:"#e5484d"};

/* ---------- screens ---------- */
function show(name){S.screen=name;
  $("menu").hidden=name!=="menu";$("game").hidden=name!=="game";$("result").hidden=name!=="result";
  $("homeBtn").hidden=name!=="game";$("accBtn").hidden=name==="game";
  document.body.classList.toggle("boss",name==="game"&&S.mode==="boss")}

/* ---------- start runs ---------- */
function resetStats(){Object.assign(S,{idx:0,typed:0,firstT:null,errSt:false,done:false,
  t0:null,endT:null,correct:0,errors:0,combo:0,maxCombo:0,score:0,
  heats:[],times:[],perfs:[],taps:[],dist:0,topV:0,dispV:0,avgV:0,
  pos:0,credit:0,arrivedI:0,hot:false,fireT:1,revealing:false,mapClean:false,
  hotOn:.84,t2:10,t3:20,cstep:.1});
  camPunch=0;gMap.classList.remove("noNames");
  $("gaugeBox").classList.remove("hot","t2","t3");
  $("cCombo").textContent="0";$("cScore").textContent="0";$("cWpm").textContent="0";
  $("cAcc").firstChild.nodeValue="100";$("cTime").textContent="0:00";$("cDist").firstChild.nodeValue="0.0"}

function startLine(L,rev){S.mode="line";S.line=L;S.rev=rev;lastRun={mode:"line",L,rev};
  S.seq=rev?[...L.stations].reverse():L.stations.slice();
  S.segs=rev?[...L.segKm].reverse():L.segKm.slice();
  S.cum=[0];for(const k of S.segs)S.cum.push(S.cum[S.cum.length-1]+k);
  // movement scale: sustained typing at CRUISE_CPS chars/s cruises at the line cap
  S.kms=clamp(L.cap*(L.letters/L.km)/CRUISE_CPS,40,220);
  resetStats();show("game");
  S.hotOn=HOT_ON(L.ease);S.t2=TIER2(L.ease);S.t3=S.t2*2;S.cstep=CSTEP(L.ease);
  const disp=dispOf(L.color);
  document.body.style.setProperty("--lc",L.color);
  document.body.style.setProperty("--lcd",disp);
  document.body.style.setProperty("--lcg",alpha(disp,.32));
  $("board").style.setProperty("--lc",L.color);
  $("board").style.setProperty("--lcg",alpha(disp,.38));
  $("toast").style.setProperty("--lc",L.color);
  $("zhChip").textContent=L.num;$("zhChip").style.background=btnBg(L.color);$("zhChip").style.color=txOn(L.color);
  buildMap(gMap,{train:true});collectNodes();
  $("trainBand").setAttribute("fill",L.color);
  // dim other lines + their exclusive stations; only the ridden line keeps its
  // name labels (the whole network's names at once is unreadable) — .offln hides them
  const mine=new Set(S.seq.map(s=>s.zh));
  gMap.querySelectorAll(".lpath").forEach(p=>p.classList.toggle("dimline",p.dataset.line!==L.id));
  gMap.querySelectorAll(".stg").forEach(g=>{const on=mine.has(g.dataset.st);
    g.style.opacity=on?"1":".22";g.classList.toggle("offln",!on)});
  // origin visuals
  const o=S.seq[0];
  if(REG.get(o.zh).lines.length<=1)nodes[o.zh].dot.style.fill=L.color;
  buildPbar();setGauge(0,L.cap);
  placeTrain(o.x,o.y,angleTo(0,1));$("trainG").setAttribute("opacity","1");
  requestAnimationFrame(()=>{fitSeq(true);setTimeout(()=>{camFollow=true},700)});
  setPrompt();movePulse();
  announce(t("depart",o.zh));
  setTimeout(()=>inp.focus(),80)}

function startBoss(){S.mode="boss";S.line=null;lastRun={mode:"boss"};
  S.bossList=shuffle(BOSS);S.bossI=0;S.lives=3;S.bossDone=0;
  resetStats();show("game");
  const c="#e5484d",cd=dispOf(c);
  document.body.style.setProperty("--lc",c);
  document.body.style.setProperty("--lcd",cd);
  document.body.style.setProperty("--lcg",alpha(cd,.32));
  $("board").style.setProperty("--lc",c);$("board").style.setProperty("--lcg",alpha(cd,.35));
  $("zhChip").textContent="★";$("zhChip").style.background=c;$("zhChip").style.color=txOn(c);
  $("lives").textContent="♥♥♥";buildPbar();
  setBossPrompt();setTimeout(()=>inp.focus(),80)}

/* ---------- prompt / board ---------- */
function paintPy(popFrom=-1,miss=false){const el=$("py");el.classList.remove("reveal");
  const st=curStation();if(!st){el.innerHTML="";return}
  let n=0,html="",word="";
  const flush=()=>{if(word){html+=`<span class="w">${word}</span>`;word=""}};
  for(const ch of st.py){const base=TONE[ch.toLowerCase()]||ch.toLowerCase();
    if(base>="a"&&base<="z"){let cls=n<S.typed?"done":n===S.typed?"next":"todo";
      if(popFrom>=0&&n>=popFrom&&n<S.typed)cls+=" pop";
      if(miss&&n===S.typed)cls+=" miss";
      word+=`<span class="c ${cls}">${ch}</span>`;n++}
    else flush()}
  flush();el.innerHTML=html}

function curStation(){return S.mode==="boss"?S.bossList[S.bossI]:S.seq[S.idx]}

function setPrompt(){const st=S.seq[S.idx];
  if(!st){ // terminus reached (all names typed) — waiting on final arrival
    $("zhTxt").textContent=t("terminus");$("py").innerHTML="";
    $("brdLabel").textContent=t("arriving");$("cnt").textContent="";
    $("dTag").hidden=true;inp.value="";inp.disabled=true;S.key="";updCredit();updPbar();setNextUp();return}
  S.key=st.key;S.typed=0;S.firstT=null;S.errSt=false;
  inp.disabled=false;inp.value="";
  $("brdLabel").textContent=t(S.idx===0?"origin":"nextStop");
  $("zhTxt").textContent=st.zh;
  const d=diffOf(st.key.length);const tg=$("dTag");tg.hidden=false;tg.className="tag "+d.k;tg.textContent=t(d.t);
  $("cnt").textContent=(S.idx+1)+"/"+S.seq.length+(S.idx>0?" · "+S.segs[S.idx-1].toFixed(1)+" km":"");
  updCredit();paintPy();updPbar();flashBoard();setNextUp()}

// look-ahead: preview the stop AFTER the current target (line mode only) — v0.4.4.
// When that stop is the terminus, the label switches to 终点站/TERMINUS; while the
// terminus itself is being typed there's no stop after, so the panel hides.
function setNextUp(){const box=$("nextUp");
  const cur=S.mode==="line"?S.seq[S.idx]:null;
  const nxt=cur?S.seq[S.idx+1]:null;
  if(!nxt){box.hidden=true;return}
  $("nuLabel").textContent=t(S.idx+1===S.seq.length-1?"terminus":"upNext");
  $("nuZh").textContent=nxt.zh;$("nuPy").textContent=nxt.py;
  box.hidden=false}

function setBossPrompt(){const st=S.bossList[S.bossI];
  S.key=st.key;S.typed=0;S.firstT=null;S.errSt=false;S.revealing=false;
  inp.disabled=false;inp.value="";
  $("brdLabel").textContent=t("beatClock");
  $("zhTxt").textContent=st.zh;
  const d=diffOf(st.key.length);const tg=$("dTag");tg.hidden=false;tg.className="tag "+d.k;tg.textContent=t(d.t)+" · "+st.key.length;
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
    i<S.idx?(S.heats[i]||"good"):i===S.idx?"cur":""}}

/* ---------- typing ---------- */
inp.addEventListener("input",e=>{if(!e.isComposing)handleTyping(inp.value)});
inp.addEventListener("compositionend",()=>handleTyping(inp.value));
inp.addEventListener("paste",e=>{e.preventDefault();shake()});
document.addEventListener("keydown",e=>{
  if(S.screen!=="game")return;
  if(e.key==="Escape"){quit();return}
  // correct keystrokes lock in — no deleting/retyping (since v0.4.3)
  if(e.key==="Backspace"||e.key==="Delete"){e.preventDefault();return}
  if(document.activeElement!==inp&&e.key.length===1&&!e.metaKey&&!e.ctrlKey)inp.focus()});
// tap the board to (re)summon the keyboard on touch devices
$("board").addEventListener("pointerdown",()=>{if(S.screen==="game")inp.focus()});

function handleTyping(raw){
  if(S.screen!=="game"||S.done||S.revealing||!S.key)return;
  if(/[\u3400-\u9fff]/.test(raw))announce(t("kbWarn"));
  let v="";for(const ch of raw.toLowerCase()){const c=TONE[ch]||ch;if(c>="a"&&c<="z")v+=c}
  // first keystroke of the run clears the map: station names fade until the terminus
  if(S.mode==="line"&&!S.mapClean&&v.length>0){S.mapClean=true;gMap.classList.add("noNames")}
  let ok=0;while(ok<v.length&&ok<S.key.length&&v[ok]===S.key[ok])ok++;
  const prev=S.typed,err=v.length>ok;
  if(err){S.errors+=v.length-ok;S.errSt=true;
    if(S.combo>0){S.combo=0;$("cCombo").textContent="0"}
    shake();sErr()}
  if(ok>S.typed){const now=performance.now();
    if(S.firstT===null){S.firstT=now;if(S.t0===null)S.t0=S.firstT}
    for(let k=S.typed;k<ok;k++)S.taps.push(now);
    S.correct+=ok-S.typed}
  S.typed=ok;inp.value=S.key.slice(0,ok);
  updCredit();paintPy(ok>prev?prev:-1,err);updLive();
  if(ok===S.key.length)S.mode==="boss"?bossComplete():completeStation()}

function shake(){const b=$("board");b.classList.remove("shake");void b.offsetWidth;b.classList.add("shake")}

function stationPerf(){const t=(performance.now()-(S.firstT??performance.now()-300))/1000;
  const expected=Math.max(1,S.key.length/3.2);
  return{t,perf:clamp(expected/Math.max(t,.15),.2,2.5)}}

function bump(el){el.classList.remove("bump");void el.offsetWidth;el.classList.add("bump")}

function award(perf){if(!S.errSt){S.combo++;if(S.combo>S.maxCombo)S.maxCombo=S.combo;
    if(S.combo%5===0)sCombo()}
  $("cCombo").textContent=S.combo;bump($("cCombo"));
  const pts=Math.round(S.key.length*10*clamp(perf,.5,2)*(1+Math.min(S.combo,20)*S.cstep));
  S.score+=pts;$("cScore").textContent=S.score;bump($("cScore"));
  const pop=$("pop");pop.textContent="+"+pts;pop.classList.remove("on");void pop.offsetWidth;pop.classList.add("on");
  return pts}

function heatOf(perf){return perf>=1.15?"good":perf>=.7?"mid":"bad"}

// one-shot burst on the stop whose name was just typed: green ring + its 汉字 above the dot
function typedFx(st){const reg=REG.get(st.zh),inter=reg&&reg.lines.length>1;
  const g=document.createElementNS("http://www.w3.org/2000/svg","g");
  g.setAttribute("class","doneFx");
  g.innerHTML=`<circle cx="${st.x}" cy="${st.y}" r="${inter?13:9}" fill="none" stroke="${HEATC.good}" stroke-width="2.5"/>`+
    `<text x="${st.x}" y="${st.y-(inter?26:21)}" text-anchor="middle">${st.zh}</text>`;
  gMap.appendChild(g);setTimeout(()=>g.remove(),1700)}

function completeStation(){
  const i=S.idx,{t:secs,perf}=stationPerf(); // no bare `t`: the i18n t() is called below
  S.heats[i]=heatOf(perf);S.times[i]=secs;S.perfs.push(perf);
  award(perf);sDing();typedFx(S.seq[i]);
  if(i===0){ // origin typed in place — doors close, the train departs with the next stop
    const n=nodes[S.seq[0].zh];
    if(n){n.heat.setAttribute("stroke",HEATC[S.heats[0]]);if(n.zh)n.zh.classList.add("passed")}
    announce(t("doors"));S.idx++;setPrompt();movePulse();return}
  S.idx++;setPrompt()}

/* ---------- continuous travel: typed letters earn track and drive the train directly ---------- */
// km unlocked so far: each correct letter buys its share of the segment being typed
function updCredit(){if(S.mode!=="line")return;
  if(S.idx===0){S.credit=0;return}
  const st=S.seq[S.idx];if(!st){S.credit=S.cum[S.seq.length-1];return}
  const p=S.typed/S.key.length,e=p*p*(3-2*p); // smoothstep: slow out of / into stations
  S.credit=S.cum[S.idx-1]+S.segs[S.idx-1]*(p+(e-p)*EASE)}

function angleTo(i,j){const a=S.seq[i],b=S.seq[j];return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}
function placeTrain(x,y,ang){$("trainG").setAttribute("transform",`translate(${x} ${y})`);
  $("trainR").setAttribute("transform",`rotate(${ang}) scale(1.15)`)} // upscale offsets the wide camera
function posXY(p){const c=S.cum;let j=0;
  while(j<S.segs.length-1&&p>c[j+1])j++;
  const a=S.seq[j],b=S.seq[j+1],f=S.segs[j]?clamp((p-c[j])/S.segs[j],0,1):0;
  return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,ang:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,j,f}}

function setHot(on){S.hot=on;const gb=$("gaugeBox"),f=document.getElementById("trainFire");
  gb.classList.toggle("hot",on);if(f)f.style.opacity=on?"1":"0";
  if(!on){S.fireT=1;gb.classList.remove("t2","t3");if(f)f.classList.remove("t2","t3")}}
// fire grows with the station combo: base < ×S.t2 < ×S.t3 (per-line, easier lines sooner)
function setFireTier(tier){S.fireT=tier;
  for(const el of[$("gaugeBox"),document.getElementById("trainFire")])
    if(el){el.classList.toggle("t2",tier>=2);el.classList.toggle("t3",tier>=3)}}

function arriveAt(j){S.arrivedI=j;
  if(!REDUCED())camPunch=1; // brief lens punch-in as the platform lands
  const st=S.seq[j],n=nodes[st.zh],reg=REG.get(st.zh);
  if(n){if(reg&&reg.lines.length<=1)n.dot.style.fill=S.line.color;
    n.heat.setAttribute("stroke",HEATC[S.heats[j]||"good"]);
    if(n.zh)n.zh.classList.add("passed")}
  movePulse();
  if(j===S.seq.length-1){finishRun()}
  else announce(t("arriveAt",st.zh,st.py))}

function movePulse(){gMap.querySelectorAll(".pulseHolder").forEach(p=>{p.setAttribute("opacity","0");p.classList.remove("pulse")});
  const st=S.seq[S.idx];if(!st)return;const n=nodes[st.zh];
  if(n&&n.pulse){n.pulse.setAttribute("opacity","1");n.pulse.classList.add("pulse");
    n.pulse.setAttribute("stroke",S.line.color)}}

let toastTimer=null;
function announce(msg){const t=$("toast");t.textContent=msg;t.classList.add("on");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("on"),2100)}

function finishRun(){S.done=true;S.endT=performance.now();
  inp.disabled=true;camFollow=false;fitSeq(false);
  gMap.classList.remove("noNames"); // terminus: names return for the zoomed-out recap
  sWin();confetti();announce(t("terminusReached"));
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
function showResult(rerender){show("result");
  const boss=S.mode==="boss";
  const total=(S.endT&&S.t0)?S.endT-S.t0:0;
  const min=Math.max(total/60000,.001);
  const wpm=Math.round(S.correct/5/min);
  const acc=S.correct+S.errors?Math.round(100*S.correct/(S.correct+S.errors)):100;
  const avgPerf=S.perfs.length?S.perfs.reduce((a,b)=>a+b,0)/S.perfs.length:0;
  let stars=1;if(acc>=88&&avgPerf>=.65)stars=2;if(acc>=96&&avgPerf>=1.1)stars=3;
  if(boss&&S.lives<=0)stars=1;
  const medal=stars===3?"🏆":stars===2?"🥈":"🥉";
  const title=t("titles")[stars-1];
  $("rMedal").textContent=medal;$("rStars").textContent="★★★".slice(0,stars)+"☆☆☆".slice(0,3-stars);
  const nb=$("newbest");$("rTitle").childNodes[0].nodeValue=title;
  const col=boss?"#e5484d":S.line.color;
  $("rcard").style.setProperty("--lc",col);
  $("rAgain").style.setProperty("--cc",boss?col:btnBg(col));
  $("rAgain").style.setProperty("--cc-tx",txOn(col));
  $("rSub").textContent=boss
    ?t("bossSub",S.bossDone,S.bossList.length,"♥".repeat(S.lives)||"—")
    :t("lineSub",S.line,S.seq[0].zh,S.seq[S.seq.length-1].zh);
  // row 1 = run logistics, row 2 = performance: wpm/acc lightly tinted, score is the hero
  const cells=[[t("rTime"),fmtT(total),""],
    boss?[t("rCleared"),S.bossDone+"/"+S.bossList.length,""]:[t("rDist"),S.dist.toFixed(1),"km"],
    boss?[t("rLives"),S.lives,"♥"]:[t("rTop"),Math.round(S.topV),"km/h"],
    [t("rErr"),S.errors,""],
    [t("rSpeed"),wpm,"wpm","sub"],[t("rAcc"),acc,"%","sub"],[t("rCombo"),"×"+S.maxCombo,""],
    [t("rScore"),S.score,"","emph"]];
  $("rGrid").innerHTML=cells.map(c=>`<div class="rcell${c[3]?" "+c[3]:""}"><label>${c[0]}</label><b>${c[1]}<small> ${c[2]}</small></b></div>`).join("");
  // score counts up once per finish (not on language re-renders)
  const sb=$("rGrid").querySelector(".rcell.emph b");
  if(sb&&!rerender&&!REDUCED()&&S.score>0){const a0=performance.now(),D=900;
    sb.firstChild.nodeValue="0";
    const step=n=>{const p=Math.min(1,(n-a0)/D),e=1-Math.pow(1-p,3);
      sb.firstChild.nodeValue=Math.round(S.score*e);
      if(p<1)requestAnimationFrame(step)};
    requestAnimationFrame(step)}
  // heat strip + fastest/slowest
  const hs=$("heatstrip");hs.innerHTML="";
  const list=boss?S.bossList:S.seq;
  let fi=-1,si=-1;
  list.forEach((st,i)=>{const cell=document.createElement("i");
    const h=S.heats[i];
    if(h)cell.classList.add(h);
    const t=S.times[i];
    cell.title=st.zh+(t!=null?` · ${t.toFixed(1)}s`:"");
    if(t!=null){if(fi<0||t<S.times[fi])fi=i;if(si<0||t>S.times[si])si=i}
    hs.appendChild(cell)});
  $("fastslow").innerHTML=(fi>=0?t("fastest",list[fi].zh,S.times[fi].toFixed(1)):"")+
    (si>=0?t("slowest",list[si].zh,S.times[si].toFixed(1)):"");
  // session best (skip re-scoring when only re-rendering for a language switch)
  if(!rerender){const key=boss?"boss":S.line.id;
    S.isBest=!bests[key]||S.score>bests[key].score;
    if(S.isBest)bests[key]={score:S.score,time:fmtT(total),acc};
    if(typeof cloudOnResult==="function")cloudOnResult({
      key,mode:boss?"boss":"line",score:S.score,wpm,acc,maxCombo:S.maxCombo,
      durS:+(total/1000).toFixed(1),stars,
      cleared:boss?S.bossDone:S.seq.length,total:boss?S.bossList.length:S.seq.length,
      lives:boss?S.lives:3})}
  nb.hidden=!S.isBest;
  renderCards()}

/* ---------- menu cards ---------- */
const LINE_STS=new Map(LINES.map(L=>[L.id,new Set(L.stations.map(s=>s.zh))]));
// readable text color for a hex background: dark ink on light colors, white on dark ones
const lumOf=hex=>{const n=hex.replace("#","");const[r,g,b]=[0,2,4].map(i=>parseInt(n.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4));return .2126*r+.7152*g+.0722*b};
const txOn=hex=>lumOf(hex)>.19?"#0a0f1a":"#fff";
// dark-theme display variant: lighten dark line colors until they read as text on the near-black board
const mixW=(hex,t)=>{const n=hex.replace("#","");return"#"+[0,2,4].map(i=>Math.round(parseInt(n.slice(i,i+2),16)*(1-t)+255*t).toString(16).padStart(2,"0")).join("")};
const dispOf=hex=>{if(lumOf(hex)>=.19)return hex;let lo=0,hi=1;for(let i=0;i<8;i++){const m=(lo+hi)/2;if(lumOf(mixW(hex,m))<.19)lo=m;else hi=m}return mixW(hex,hi)};
// button/chip fills: keep the official line color, but for the mid-tone lines where neither
// black nor white text is comfortable, nudge the fill toward the far end until the txOn-chosen
// text clears BTN_MIN:1. Leaves the map/strokes (raw L.color) untouched.
const BTN_MIN=6;
const crOf=(a,b)=>{const l=[lumOf(a),lumOf(b)].sort((x,y)=>y-x);return (l[0]+.05)/(l[1]+.05)};
const mixTo=(hex,t,tgt)=>{const n=hex.replace("#",""),T=tgt.replace("#","");return"#"+[0,2,4].map(i=>Math.round(parseInt(n.slice(i,i+2),16)*(1-t)+parseInt(T.slice(i,i+2),16)*t).toString(16).padStart(2,"0")).join("")};
const btnBg=hex=>{const tx=lumOf(hex)>.19?"#0a0f1a":"#ffffff";if(crOf(hex,tx)>=BTN_MIN)return hex;
  const toward=tx==="#0a0f1a"?"#ffffff":"#0a0f1a";let lo=0,hi=1;
  for(let i=0;i<12;i++){const m=(lo+hi)/2;if(crOf(mixTo(hex,m,toward),tx)<BTN_MIN)lo=m;else hi=m}
  return mixTo(hex,hi,toward)};
const REDUCED=()=>matchMedia("(prefers-reduced-motion:reduce)").matches;
function ovHighlight(id){const ov=$("ovMap");
  ov.querySelectorAll(".lpath").forEach(p=>p.classList.toggle("dimline",!!id&&p.dataset.line!==id));
  const mine=id&&LINE_STS.get(id);
  ov.querySelectorAll(".stg").forEach(g=>{g.style.opacity=!mine||mine.has(g.dataset.st)?"":".25"})}
// station-name labels follow the zoom focus (card expand / legend pin), never hover
function ovLabels(id){const mine=id&&LINE_STS.get(id);
  $("ovMap").querySelectorAll(".stg").forEach(g=>g.classList.toggle("lbl",!!mine&&mine.has(g.dataset.st)))}
// zoom the overview map to one line (null → back to the full network), rotating the
// map so the line's long axis fills the viewport at maximum size: 1° scan, smallest
// angle within 3% of the best fit wins so roundish/loop lines barely rotate
const OV_PD=34;
function bestFit(L,vw,vh){
  const box=deg=>{const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const p of L.stations){const x=p.x*c-p.y*s,y=p.x*s+p.y*c;
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
    return[x0,y0,x1-x0,y1-y0]};
  const sc=b=>Math.min(vw/(b[2]+2*OV_PD),vh/(b[3]+2*OV_PD));
  let bs=0;for(let d=-90;d<90;d++)bs=Math.max(bs,sc(box(d)));
  let a=0;
  for(let d=0;d<=90;d++){if(sc(box(d))>=.97*bs){a=d;break}if(d&&sc(box(-d))>=.97*bs){a=-d;break}}
  const b0=box(0),cx=b0[0]+b0[2]/2,cy=b0[1]+b0[3]/2; // rotation centre = line bbox centre
  const r=a*Math.PI/180,c=Math.cos(r),s=Math.sin(r),b=box(a),
    ox=cx-(cx*c-cy*s),oy=cy-(cx*s+cy*c); // origin-rotated bbox → rotate(a,cx,cy) space
  return{a,cx,cy,vb:[b[0]+ox-OV_PD,b[1]+oy-OV_PD,b[2]+2*OV_PD,b[3]+2*OV_PD]}}
let FULL_VB=null,ovAnim=0,ovA=0,ovC=null,ovGs=[];
function ovTarget(id){const ov=$("ovMap");
  let tgt=FULL_VB,ta=0,tc=ovC,LL=null;
  if(id){LL=LINES.find(l=>l.id===id);
    if(LL){const f=bestFit(LL,ov.clientWidth||760,ov.clientHeight||580);
      tgt=f.vb;ta=f.a;tc=[f.cx,f.cy];
      // strip-map labels overhang the track up/down/rightward — reserve room
      if(Math.abs(ta)>20)tgt=[tgt[0]-8,tgt[1]-34,tgt[2]+82,tgt[3]+62]}}
  return{tgt,ta,tc,LL}}
function ovZoom(id){const ov=$("ovMap"),mr=ov.querySelector(".mrot"),nc=$("ncue");
  let{tgt,ta,tc,LL}=ovTarget(id);
  if(!tgt)return;
  cancelAnimationFrame(ovAnim);
  // the focused line's label <g>s counter-rotate every frame so text stays level;
  // big rotations switch them to 45°-tilted strip-map labels (constant footprint
  // along the line, so long names can't collide once the line lies horizontal);
  // ±45° is picked per station so a label never runs parallel to its own track
  const strip=Math.abs(ta)>20,mine=id&&LINE_STS.get(id),gs=[],tilt=new Map();
  if(strip){const r=ta*Math.PI/180,c=Math.cos(r),s=Math.sin(r),sts=LL.stations;
    sts.forEach((st,i)=>{const p=sts[Math.max(0,i-1)],n=sts[Math.min(sts.length-1,i+1)],
      dx=n.x-p.x,dy=n.y-p.y;
      let th=Math.atan2(dx*s+dy*c,dx*c-dy*s)*180/Math.PI;
      if(th>=90)th-=180;if(th<-90)th+=180;
      tilt.set(st.zh,th<0?45:-45)})}
  if(mine)ov.querySelectorAll(".stg").forEach(g=>{if(mine.has(g.dataset.st)){
    const lg=g.lastElementChild;lg.dataset.m=strip?"s":"u";lg.dataset.t=tilt.get(g.dataset.st)||-45;
    lg.setAttribute("text-anchor",strip?"start":lg.dataset.ta);gs.push(lg)}});
  const old=ovGs.filter(g=>!gs.includes(g));ovGs=gs;
  const reset=g=>{g.removeAttribute("transform");g.setAttribute("text-anchor",g.dataset.ta)};
  const setVb=v=>ov.setAttribute("viewBox",v.map(n=>n.toFixed(1)).join(" "));
  const setRot=(a,cx,cy)=>{
    if(Math.abs(a)<.05)mr.removeAttribute("transform");
    else mr.setAttribute("transform",`rotate(${a.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    if(nc){nc.style.opacity=Math.abs(a)<.05?"":"1";
      nc.firstElementChild.style.transform=`rotate(${a}deg)`}
    for(const g of gs.concat(old)){const d=g.dataset;
      if(d.m==="s"){const rr=a*Math.PI/180,co=Math.cos(rr),si=Math.sin(rr),t=+d.t||-45,
        ax=cx+(d.sx-cx)*co-(d.sy-cy)*si+10,ay=cy+(d.sx-cx)*si+(d.sy-cy)*co+(t>0?10:-10);
        g.setAttribute("transform",`rotate(${(-a).toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)}) translate(${ax.toFixed(1)} ${ay.toFixed(1)}) rotate(${t}) translate(${-d.lx} ${-d.ly})`)}
      else if(Math.abs(a)<.05)g.removeAttribute("transform");
      else g.setAttribute("transform",`rotate(${(-a).toFixed(2)} ${d.lx} ${d.ly})`)}};
  const land=()=>{ovA=ta;ovC=tc;old.forEach(reset)};
  const vb=ov.viewBox.baseVal,from=[vb.x,vb.y,vb.width,vb.height];
  if(!tc)tc=[0,0];
  if(REDUCED()||!from[2]){setVb(tgt);setRot(ta,tc[0],tc[1]);land();return}
  const c0=Math.abs(ovA)<.05?tc:(ovC||tc), // start centre = current, unless untransformed
    f7=[...from,ovA,c0[0],c0[1]],t7=[...tgt,ta,tc[0],tc[1]];
  const t0=performance.now();
  const step=now=>{const p=Math.min(1,(now-t0)/420),e=1-Math.pow(1-p,3),
    v=f7.map((f,i)=>f+(t7[i]-f)*e);
    setVb(v.slice(0,4));setRot(v[4],v[5],v[6]);
    if(p<1)ovAnim=requestAnimationFrame(step);else land()};
  ovAnim=requestAnimationFrame(step)}
// accordion state: which card is open ("l1"… or "boss"); survives re-renders
let expandedId=null,pinnedLine=null;
// card ordering (session-only): sort key + direction, re-tap flips asc/desc
let cardSort="num",cardAsc=true;
// FLIP: capture card rects keyed by line id, run the reorder/reflow, then glide
// each card (incl. the resized one's width) from its old box to the new one;
// onLayout fires after the mutation with final layout but before any animation
// starts — the only moment final geometry is measurable (the width tween and the
// cbody 0fr→1fr transition both lie about it afterwards)
function flipCards(mutate,onLayout){const wrap=$("cards");
  if(REDUCED()){mutate();onLayout&&onLayout();return}
  const old=new Map([...wrap.children].map(c=>[c.dataset.line,c.getBoundingClientRect()]));
  mutate();
  onLayout&&onLayout();
  [...wrap.children].forEach(c=>{const a=old.get(c.dataset.line);if(!a)return;
    const b=c.getBoundingClientRect(),dx=a.left-b.left,dy=a.top-b.top,dw=Math.abs(a.width-b.width)>.5;
    if(!dx&&!dy&&!dw)return;
    const kf=[{transform:`translate(${dx}px,${dy}px)`},{transform:"none"}];
    if(dw){kf[0].width=a.width+"px";kf[1].width=b.width+"px"}
    c.animate(kf,{duration:360,easing:"cubic-bezier(.2,0,0,1)"})})}
const expandedLine=()=>expandedId&&expandedId!=="boss"?expandedId:null;
// resting highlight: a legend pin wins over the expanded card
const legendBase=()=>pinnedLine||expandedLine();
function setPin(id){pinnedLine=id;
  $("legend").querySelectorAll(".lg[data-line]").forEach(el=>{const on=el.dataset.line===id;
    el.classList.toggle("pin",on);el.setAttribute("aria-pressed",on)})}
const absTop=el=>{let y=0;for(;el;el=el.offsetParent)y+=el.offsetTop;return y};
function toggleCard(id,stay){expandedId=expandedId===id?null:id;
  flipCards(()=>{document.querySelectorAll("#cards .card").forEach(c=>{const on=c.dataset.line===expandedId;
    c.classList.toggle("open",on);c.querySelector(".chead").setAttribute("aria-expanded",on)});
    // part of the mutation: on the stacked mobile layout the legend sits between
    // map and cards, so the scroll math below must see it already hidden
    $("legend").classList.toggle("off",!!expandedId)},
    ()=>{if(!expandedId)return;
      const c=document.querySelector(`#cards .card[data-line="${expandedId}"]`),PAD=14;
      // fit whole map + whole card when they can share the screen (map top at the
      // viewport top); otherwise pin the card's bottom to the viewport bottom.
      // Map clicks (stay) hold the page still instead, scrolling only if the
      // card's bottom — the start button — would sink below the fold.
      // Final card height is predicted (header + body content) — the cbody
      // track transition still reports the collapsed height at this point
      const finalH=c.querySelector(".chead").offsetHeight+c.querySelector(".cinner").scrollHeight;
      // stacked (column) mapcard: the svg's height follows its viewBox aspect,
      // which ovZoom is about to retarget — predict the shift for all below
      const mc=document.querySelector(".mapcard"),ov=$("ovMap"),cv=ov.viewBox.baseVal,
        tg=ovTarget(expandedLine()).tgt,
        dSvg=tg&&cv.width&&getComputedStyle(mc).flexDirection==="column"
          ?ov.getBoundingClientRect().width*(tg[3]/tg[2]-cv.height/cv.width):0;
      const bot=absTop(c)+dSvg+finalH+PAD-innerHeight;
      const top=stay?Math.max(scrollY,bot):Math.max(absTop(mc)-PAD,bot);
      scrollTo({top:Math.max(0,top),behavior:REDUCED()?"auto":"smooth"})});
  setPin(null);
  ovHighlight(expandedLine());ovZoom(expandedLine());ovLabels(expandedLine())}
const legendLeave=()=>ovHighlight(legendBase());
function renderLegend(){
  $("legend").innerHTML=LINES.map(L=>`<span class="lg${L.id===pinnedLine?" pin":""}" data-line="${L.id}" role="button" tabindex="0" aria-pressed="${L.id===pinnedLine}"><i style="background:${L.color}"></i>${t("lineName",L)}</span>`).join("")+
    `<span class="lg"><i style="background:var(--map-inter);outline:1px solid var(--map-inter-ring)"></i>${t("interchange")}</span>`;
  $("legend").addEventListener("mouseleave",legendLeave); // no per-pill mouseleave: highlight sticks across the gaps
  $("legend").querySelectorAll(".lg[data-line]").forEach(el=>{
    const id=el.dataset.line,on=()=>ovHighlight(id);
    el.addEventListener("mouseenter",on);el.addEventListener("focus",on);
    el.addEventListener("blur",legendLeave);
    el.addEventListener("click",()=>{setPin(pinnedLine===id?null:id);
      ovHighlight(legendBase());ovZoom(legendBase());ovLabels(legendBase())});
    el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();el.click()}})})}
const SORT_LB={num:"sortNum",stops:"sortStops",diff:"sortDiff"};
function renderSortBar(){const bar=$("sortBar");
  bar.innerHTML=`<span class="slb">${t("sortBy")}</span>`+Object.keys(SORT_LB).map(k=>{const on=k===cardSort;
    return `<button class="schip${on?" on":""}" data-k="${k}" aria-pressed="${on}">${t(SORT_LB[k])}${on?`<i>${cardAsc?"↑":"↓"}</i>`:""}</button>`}).join("");
  bar.querySelectorAll(".schip").forEach(b=>b.onclick=()=>{
    if(b.dataset.k===cardSort)cardAsc=!cardAsc;else{cardSort=b.dataset.k;cardAsc=true}
    flipCards(renderCards)})}
function renderCards(){const wrap=$("cards");wrap.innerHTML="";
  const DIFF=[["easy","diffEasy"],["mid","diffMedium"],["hard","diffHard"]];
  const cap=(cls,key)=>`<span class="dcap ${cls}" aria-label="${t("diffAria",t(key))}">${t(key)}</span>`;
  const tile=(v,u,lb)=>`<div class="lstat"><b>${v}${u?`<i>${u}</i>`:""}</b><span>${lb}</span></div>`;
  const chev=`<span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  renderSortBar();
  // difficulty caption by tercile of the diff ranking (independent of display order)
  const rank=new Map([...LINES].sort((a,b)=>a.diff-b.diff).map((L,i)=>[L.id,i]));
  const ord=[...LINES];
  if(cardSort==="stops")ord.sort((a,b)=>a.stations.length-b.stations.length);
  else if(cardSort==="diff")ord.sort((a,b)=>a.diff-b.diff);
  if(!cardAsc)ord.reverse();
  ord.forEach(L=>{const[dcls,dkey]=DIFF[Math.floor(rank.get(L.id)*DIFF.length/LINES.length)];
    const a=L.stations[0].zh,b=L.stations[L.stations.length-1].zh;
    const tt=()=>dirState[L.id]?`${b} → ${a}`:`${a} → ${b}`;
    const best=bests[L.id];
    const card=document.createElement("div");card.className="card";card.dataset.line=L.id;
    card.style.setProperty("--cc",btnBg(L.color));card.style.setProperty("--cc-tx",txOn(L.color));
    card.innerHTML=`
      <button class="chead" aria-expanded="false" aria-controls="cb-${L.id}">
        <span class="crow">
          ${cap(dcls,dkey)}
          <span class="lnum${L.num.length>2?" wide":""}">${L.num}</span>
          <span class="lname">${t("lineName",L)}<small>${LANG==="zh"?L.en:L.zh}</small></span>${chev}
        </span>
        <span class="crow">
          <span class="tt">${tt()}</span>
          <span class="stct">${t("stops",L.stations.length)}</span>
        </span>
      </button>
      <div class="cbody" id="cb-${L.id}"><div class="cinner">
        <p class="fact">${descOf(L)}</p>
        <div class="lstats">
          ${tile("≈"+Math.round(L.km),"km",t("statKm"))}
          ${tile(L.letters,t("uLetters"),t("statLetters"))}
          ${tile(L.avgLen.toFixed(1),t("uPerStop"),t("statAvg"))}
        </div>
        ${best?`<div class="best">${t("best",best)}</div>`:""}
        <div class="cacts">
          <button class="rev" title="${t("revTitle")}">⇄ ${t("revBtn")}</button>
          <button class="go">${t("go")}</button>
        </div>
      </div></div>`;
    card.querySelector(".chead").onclick=()=>toggleCard(L.id);
    card.querySelector(".rev").onclick=()=>{dirState[L.id]=!dirState[L.id];
      card.querySelector(".tt").textContent=tt()};
    card.querySelector(".go").onclick=()=>startLine(L,!!dirState[L.id]);
    wrap.appendChild(card)});
  // boss card
  const bb=bests["boss"];
  const bc=document.createElement("div");bc.className="card boss";bc.dataset.line="boss";
  bc.innerHTML=`
    <button class="chead" aria-expanded="false" aria-controls="cb-boss">
      <span class="crow">
        ${cap("imp","diffImp")}
        <span class="lnum">★</span>
        <span class="lname">${t("bossTitle")}<small>${LANG==="zh"?"LONG-NAME GAUNTLET":"长站名挑战"}</small></span>${chev}
      </span>
      <span class="crow">
        <span class="tt">${BOSS[BOSS.length-1].zh} → ${BOSS[0].zh}</span>
        <span class="stct">${t("bossCount",BOSS.length)}</span>
      </span>
    </button>
    <div class="cbody" id="cb-boss"><div class="cinner">
      <p class="fact">${t("bossFact")}</p>
      <div class="lstats">
        ${tile(BOSS.length,t("uWords"),t("bossWords"))}
        ${tile(BOSS[0].key.length,t("uLetters"),t("bossLongest"))}
        ${tile("♥×3","",t("bossLives"))}
      </div>
      ${bb?`<div class="best">${t("best",bb)}</div>`:""}
      <div class="cacts"><button class="go">${t("challenge")}</button></div>
    </div></div>`;
  bc.querySelector(".chead").onclick=()=>toggleCard("boss");
  bc.querySelector(".go").onclick=startBoss;
  wrap.appendChild(bc);
  if(expandedId){const c=wrap.querySelector(`.card[data-line="${expandedId}"]`);
    if(c){c.classList.add("open");c.querySelector(".chead").setAttribute("aria-expanded","true")}}}

/* ---------- gauge ---------- */
let gaugeCap=80;
function setGauge(v,cap){gaugeCap=cap;const g=$("gauge");
  let s=`<path d="M 26 104 A 74 74 0 0 1 174 104" fill="none" style="stroke:var(--rail)" stroke-width="11" stroke-linecap="round"/>`;
  // redline (last ~18% of the sweep)
  const rx=(100+74*Math.cos(Math.PI*.18)).toFixed(1),ry=(104-74*Math.sin(Math.PI*.18)).toFixed(1);
  s+=`<path d="M ${rx} ${ry} A 74 74 0 0 1 174 104" fill="none" stroke="rgba(229,72,77,.55)" stroke-width="11" stroke-linecap="round"/>`;
  for(let i=0;i<=8;i++){const ang=Math.PI*i/8,c=Math.cos(ang),si=Math.sin(ang);
    s+=`<line x1="${100-66*c}" y1="${104-66*si}" x2="${100-74*c}" y2="${104-74*si}" style="stroke:var(--tick)" stroke-width="2"/>`}
  s+=`<g id="needleG" transform="rotate(0,100,104)"><line x1="100" y1="104" x2="34" y2="104" style="stroke:var(--lct)" stroke-width="4" stroke-linecap="round"/></g>`;
  s+=`<circle cx="100" cy="104" r="6.5" style="fill:var(--input-bg);stroke:var(--tick)" stroke-width="2"/>`;
  s+=`<text id="gaugeV" class="gv" x="100" y="88" font-size="33" font-weight="800" text-anchor="middle" font-family="Sono,ui-monospace,Menlo,Consolas,monospace">0</text>`;
  g.innerHTML=s}
function gaugeTo(v){const deg=clamp(v/gaugeCap,0,1)*180;
  const n=document.getElementById("needleG");if(n)n.setAttribute("transform",`rotate(${deg},100,104)`);
  const t=document.getElementById("gaugeV");if(t)t.textContent=Math.round(v)}

/* ---------- live chips ---------- */
// WPM chip = rolling ~10 s window (ramps up from the run start), refreshed from
// tick() so it decays while idle; the result screen keeps whole-run WPM
function updLive(now){if(S.t0===null)return;
  now=S.endT||now||performance.now();
  const win=Math.min(10,Math.max((now-S.t0)/1000,1.5)),cut=now-win*1000;
  while(S.taps.length&&S.taps[0]<cut)S.taps.shift();
  $("cWpm").textContent=Math.round(S.taps.length/5*60/win);
  const tot=S.correct+S.errors;
  $("cAcc").firstChild.nodeValue=tot?Math.round(100*S.correct/tot):100}

/* ---------- main loop ---------- */
let lastF=performance.now(),lastLive=0;
function tick(now){const dt=Math.min(.05,(now-lastF)/1000);lastF=now;
  if(S.screen==="game"&&S.t0&&!S.done&&now-lastLive>250){lastLive=now;updLive(now)}
  // camera (zoom glides slower than the pan while following — less lens churn)
  cam.cx+=(camT.cx-cam.cx)*.09;cam.cy+=(camT.cy-cam.cy)*.09;
  cam.w+=(camT.w-cam.w)*(camFollow?.045:.09);
  if(S.screen==="game"&&S.mode==="line"){
    const cap=S.line.cap;
    if(!S.done){
      // direct drive: each letter owns its slice of the segment, the train pursues
      // the earned track point, so finishing a name lands it on that platform;
      // speed between stops = km-per-letter × typing pace, honest per segment
      const lead=Math.max(0,S.credit-S.pos);
      const step=Math.min(lead,lead*Math.min(1,dt/CHASE)+(lead>0?ARRIVE_V*cap*dt/S.kms:0));
      S.pos+=step;S.dist=S.pos;
      const vRaw=dt>0?step/dt*S.kms:0;
      // speedometer inertia (gauge only — motion stays sync): quick-ish spin-up,
      // slow coast-down, so per-keystroke bursts read as a steady needle
      S.dispV+=(vRaw-S.dispV)*Math.min(1,dt/(vRaw>S.dispV?.55:1.3));
      S.avgV+=(vRaw-S.avgV)*Math.min(1,dt/1.2);   // slow average: station-ease dips don't kill flames
      if(S.dispV>S.topV)S.topV=S.dispV;
      while(S.arrivedI<S.seq.length-1&&S.pos>=S.cum[S.arrivedI+1]-1e-6)arriveAt(S.arrivedI+1);
      const P=posXY(S.pos);placeTrain(P.x,P.y,P.ang);
      // lens frames the hop being ridden: close stops pull the camera way in, far
      // stops ease it out a little — every segment crossing reads at a similar pace.
      // Center leans toward the next platform, the hop's zoom crossfades into the
      // next hop's over the last 20%, arrivals punch in briefly, and a hard floor
      // keeps both the stop behind and the stop ahead inside the frame
      if(camFollow){const j=P.j,a=S.seq[j],b=S.seq[j+1],
          cx=P.x+.25*(b.x-P.x),cy=P.y+.25*(b.y-P.y);
        const Wof=s=>clamp(230+110*s,310,780);
        let w=Wof(S.segs[j]);
        if(P.f>.8&&j<S.segs.length-1){const m=(P.f-.8)/.2;w+=(Wof(S.segs[j+1])-w)*(m*m*(3-2*m))}
        if(camPunch>0){w*=1-.04*camPunch;camPunch=Math.max(0,camPunch-dt*2)}
        const asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight)),PAD=52;
        const nx=Math.max(Math.abs(a.x-cx),Math.abs(b.x-cx))+PAD,
              ny=Math.max(Math.abs(a.y-cy),Math.abs(b.y-cy))+PAD;
        camT.cx=cx;camT.cy=cy;camT.w=Math.max(w,2*nx,2*ny*asp)}
      const hot=S.avgV>=cap*(S.hot?S.hotOn-HOT_HYS:S.hotOn); // hysteresis so the flames don't flicker
      if(hot!==S.hot&&!REDUCED())setHot(hot);
      if(S.hot){const tier=S.combo>=S.t3?3:S.combo>=S.t2?2:1;
        if(tier!==S.fireT)setFireTier(tier)}}
    else{S.dispV=Math.max(0,S.dispV-cap*dt*2);if(S.hot)setHot(false)}
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
// back from a run → land on the line-selection area, not the opening page
function toPick(){$("pick").scrollIntoView({behavior:"auto"})}
function quit(){if(S.screen!=="game")return;
  if(S.done||confirm(t("quitConfirm"))){show("menu");renderCards();toPick()}}
$("homeBtn").onclick=quit;
$("rAgain").onclick=()=>{if(!lastRun)return;lastRun.mode==="boss"?startBoss():startLine(lastRun.L,lastRun.rev)};
$("rBack").onclick=()=>{show("menu");renderCards();toPick()};
$("startBtn").onclick=()=>$("pick").scrollIntoView({behavior:REDUCED()?"auto":"smooth"});
$("backTop").onclick=()=>window.scrollTo({top:0,behavior:REDUCED()?"auto":"smooth"});
new IntersectionObserver(es=>{$("backTop").classList.toggle("on",!es[es.length-1].isIntersecting)},
  {threshold:.15}).observe(document.querySelector("#menu .hero"));

/* ---------- settings dialog + boot splash ---------- */
$("setBtn").onclick=()=>$("setDlg").showModal();
$("setClose").onclick=()=>$("setDlg").close();
$("setDlg").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
// Boot splash (#preload) plays once per browser session. The loading bar fills (CSS), then we fade the
// preload out and add .play to the hero so the train drives across and the title/rails reveal. A tap or
// key skips straight to a static home; reduced-motion / an already-seen session skips it outright.
(function intro(){const pre=$("preload"),hero=document.querySelector("#menu .hero");
  if(!pre||!hero)return;let seen=false,tm;
  try{seen=sessionStorage.getItem("introSeen")==="1"}catch(e){}
  const drop=()=>{removeEventListener("pointerdown",skip);removeEventListener("keydown",skip)};
  const skip=()=>{clearTimeout(tm);pre.classList.add("hidden");drop()}; // straight to static home
  const play=()=>{drop();pre.classList.add("gone");hero.classList.add("play");
    setTimeout(()=>pre.classList.add("hidden"),600)}; // bar done → reveal, then drop the faded overlay
  try{sessionStorage.setItem("introSeen","1")}catch(e){}
  if(REDUCED()||seen)return pre.classList.add("hidden");
  tm=setTimeout(play,1900); // ≈ bar fill length — keep in sync with pFill in style.css
  addEventListener("pointerdown",skip);addEventListener("keydown",skip)})();

/* ---------- overview map + legend + boot ---------- */
(function boot(){
  const ov=$("ovMap");buildMap(ov,{});
  requestAnimationFrame(()=>{try{const bb=ov.getBBox(),p=46;
    FULL_VB=[bb.x-p,bb.y-p,bb.width+p*2,bb.height+p*2]}catch(e){FULL_VB=[0,0,760,1300]}
    ov.setAttribute("viewBox",FULL_VB.join(" "))});
  ov.addEventListener("click",e=>{if(e.target.closest(".stg"))return; // station dots: neither a line nor blank
    const p=e.target.closest(".lpath");
    if(p)toggleCard(p.dataset.line,true); // re-click of the open line collapses it
    else if(expandedLine())toggleCard(expandedLine(),true)}); // blank map dismisses
  setLang(LANG); // renders all i18n text + legend + cards
  window.addEventListener("resize",()=>{if(S.screen==="game"&&!camFollow)fitAll(true)});
  setTimeout(()=>{ // idle-prefetch the other theme's hero pair so the toggle swaps without a blank
    const n=document.documentElement.dataset.theme==="light"?"-night":"";
    ["assets/guangzhou-tower-v2"+n+".jpg","assets/guangzhou-tower-v2"+n+"-tower-only.png"]
      .forEach(u=>{(new Image).src=u})},3000);
})();
