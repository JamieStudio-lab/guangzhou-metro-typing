const APP_VERSION="0.7.0";
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

// project GEO lat/lon (js/geo.js, OSM data) → SVG units.
// Equirectangular around Guangzhou; K≈34 units/km keeps dot/stroke/label sizes sane.
const PROJ_K=3800,PROJ_COS=Math.cos(23.09*Math.PI/180),PROJ_LON0=113.1981,PROJ_LAT0=23.2557;
const projLL=(lat,lon)=>({x:+((lon-PROJ_LON0)*PROJ_COS*PROJ_K).toFixed(1),y:+((PROJ_LAT0-lat)*PROJ_K).toFixed(1)});
// GEOPOS keyed by 汉字 gives transfer stations identical coords on every line.
const GEOPOS=(()=>{if(typeof GEO==="undefined")return null;
  const pos=new Map();
  for(const gl of GEO.lines)for(const s of gl.stations)
    if(!pos.has(s.zh))pos.set(s.zh,projLL(s.lat,s.lon));
  return pos})();
// geographic backdrop (js/boundaries.js, OSM/ODbL): project each city/district ring
// once into an SVG path. Non-interactive; drawn behind the network where {bounds:true}.
const BOUNDS=(()=>{if(typeof BOUNDARIES==="undefined")return null;
  const path=rings=>rings.map(r=>{let d="";for(let i=0;i<r.length;i++){const p=projLL(r[i][0],r[i][1]);d+=(i?"L":"M")+p.x+" "+p.y}return d+"Z"}).join("");
  const map=o=>({zh:o.zh,d:path(o.rings)});
  return{cities:BOUNDARIES.cities.map(map),districts:BOUNDARIES.districts.map(map)}})();

// normalize station tuples → objects, compute keys (x/y from geo, tuple values as fallback)
for(const L of LINES){
  L.stations=L.st.map(t=>{const g=GEOPOS&&GEOPOS.get(t[0]);
    if(GEOPOS&&!g)console.warn("no geo position for "+t[0]);
    return{zh:t[0],py:t[1],x:g?g.x:t[2],y:g?g.y:t[3],lb:t[4],tr:t[5]||null,key:normPy(t[1])}});
  // (L.st, the raw data.js tuples, stays: js/px/ovmap.js reads its names / pinyin / transfers)
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
zh:{lang:"中文",sound:"音效",dark:"深色",light:"浅色",system:"跟随系统",quitBtn:"退出",
  setBtn:"设置",setChip:"设置",setTitle:"设置",setTheme:"主题",setLang:"语言 (Language)",
  setRide:"地图风格",ridePixel:"像素",rideClassic:"经典",setPxScale:"像素大小",setWeather:"天气",
  wxAuto:"自动",wxClear:"晴天",wxRain:"下雨",pxPrep:"正在准备地图…",pxSlow:"像素地图较卡，已改用经典视图",
  pxOff:"像素地图暂不可用，点按重试",pxNoCv:"此浏览器无法绘制像素地图",
  startBtn:"选择关卡",
  footnote:"☆ 本作为粉丝自制打字游戏，收录广州地铁全网 19 条线路（含广佛线与 APM 线；十二号线暂为已通车东段，不含三号线机场支线与知识城线），站间距离为约值。未登录时成绩仅保存在本次会话中；登录后成绩会上传至全球排行榜。",
  wTitle:"选择线路",wStart:"出发",wKeys:"← → 选择 · Enter 确定",wKeysOpen:"← → 换线 · R 换向 · Enter 出发 · Esc 关闭",
  wKeysBoss:"← → 换线 · Enter 挑战 · Esc 关闭",wKeysTouch:"点按线路",wCleared:"通关",wAllClear:"全部通关",lbChip:"排行榜",
  about:"关于",aboutTitle:"关于",wStarsAria:n=>`${n}/3 星`,wDiffAria:n=>`难度 ${n}/4`,wBest:s=>`最佳 ${s} 分`,wBestW:"最佳",wBestU:"分",
  wNoBest:"还没通关",wStarting:n=>`正在发车：${n}`,wBossName:"长站名挑战",wBossPlate:"挑战",wMapAria:"线路图：点按线路 · 滚轮缩放 · ↑↓ 平移",
  wPathAria:"线路",wOsm:"地图数据 © OpenStreetMap 贡献者 (ODbL)",
  chipTime:"用时",chipDist:"里程",chipWpm:"键速",chipAcc:"准确率",chipCombo:"连击",chipScore:"得分",
  bossTitle:"长站名挑战",bossDesc:`${BOSS.length} 个最长站名 · 限时输入 · 超时扣 ♥`,
  nextStop:"下一站",upNext:"接下来",arriving:"即将到达",terminus:"终点站",beatClock:"限时挑战",
  diffShort:"短",diffMid:"中",diffLong:"长",
  placeholder:"在此输入拼音…",inHint:"无声调 · 空格可省",inputAria:"输入站名拼音（无声调）",
  kbWarn:"请切换到英文键盘",
  origin:"始发站",depart:z=>`始发站 ${z} · 输入本站拼音开始`,
  doors:"车门已关闭 · 输入下一站拼音发车",arriveAt:(z,p)=>`到达 ${z} · ${p}`,
  terminusReached:"到达终点站！",quitTitle:"退出本次行程？",quitMsg:"当前进度不会被保存。",quitStay:"继续游戏",quitGo:"退出",
  titles:["见习司机","熟练司机","王牌司机"],
  bossSub:(d,n,h)=>`长站名挑战 · 完成 ${d}/${n} · 剩余 ${h}`,
  lineSub:(L,a,b)=>`${L.zh} · ${a} → ${b}`,
  rTime:"用时",rCleared:"完成",rLives:"生命",rDist:"里程",rTop:"极速",rSpeed:"键速",
  rAcc:"准确率",rCombo:"最高连击",rErr:"失误",rScore:"得分",
  fastest:(z,s)=>`⚡ 最快：<b>${z}</b>（${s}s）　`,slowest:(z,s)=>`🐢 最慢：<b>${z}</b>（${s}s）`,
  heatTitle:"每站颜色 = 输入速度",again:"再来一次",back:"选择线路",
  lineName:L=>L.zh,revTitle:"换向",revBtn:"换向",
  stops:n=>`${n} 站`,bossCount:n=>`${n} 个站名`,
  diffEasy:"简单",diffMedium:"中等",diffHard:"困难",diffImp:"极难",
  go:"出发",challenge:"挑战",
  bossFact:`全网最长的 ${BOSS.length} 个站名轮番上阵。超时就丢一颗心！`,
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
en:{lang:"English",sound:"SOUND",dark:"DARK",light:"LIGHT",system:"SYSTEM",quitBtn:"Quit",
  setBtn:"SETTINGS",setChip:"Settings",setTitle:"SETTINGS",setTheme:"THEME",setLang:"LANGUAGE",
  setRide:"RIDE VIEW",ridePixel:"PIXEL",rideClassic:"CLASSIC",setPxScale:"PIXEL SIZE",setWeather:"WEATHER",
  wxAuto:"AUTO",wxClear:"CLEAR",wxRain:"RAIN",pxPrep:"Preparing the map…",pxSlow:"Pixel map too slow — using the Classic view",
  pxOff:"Pixel map unavailable — tap to retry",pxNoCv:"This browser can't draw the pixel map",
  startBtn:"SELECT LEVEL",
  footnote:"☆ Fan-made typing game, not affiliated with Guangzhou Metro. All 19 lines of the 2026 network (incl. Guangfo Line and the APM; Line 12 is its opened east section — the Line 3 airport branch and Knowledge City line aren't modeled); distances are approximate. Signed out, scores live in this session only; sign in to upload runs to the global leaderboard.",
  wTitle:"SELECT LINE",wStart:"START",wKeys:"← → choose · Enter select",wKeysOpen:"← → switch · R reverse · Enter go · Esc back",
  wKeysBoss:"← → switch · Enter fight · Esc back",wKeysTouch:"Tap a line",wCleared:"CLEARED",wAllClear:"ALL CLEAR",lbChip:"Ranks",
  about:"About",aboutTitle:"ABOUT",wStarsAria:n=>`${n} of 3 stars`,wDiffAria:n=>`Difficulty ${n} of 4`,wBest:s=>`Best ${s} pts`,wBestW:"Best",wBestU:"pts",
  wNoBest:"Not cleared",wStarting:n=>`Starting ${n}…`,wBossName:"GAUNTLET",wBossPlate:"BOSS",wMapAria:"Line map: tap a line · scroll to zoom · ↑↓ pan",
  wPathAria:"Lines",wOsm:"Map data © OpenStreetMap contributors (ODbL)",
  chipTime:"TIME",chipDist:"DIST",chipWpm:"WPM",chipAcc:"ACC",chipCombo:"COMBO",chipScore:"SCORE",
  bossTitle:"LONG-NAME GAUNTLET",bossDesc:`The ${BOSS.length} longest names · beat the clock · timeouts cost ♥`,
  nextStop:"NEXT STOP",upNext:"THEN",arriving:"ARRIVING",terminus:"Terminus",beatClock:"BEAT THE CLOCK",
  diffShort:"SHORT",diffMid:"MEDIUM",diffLong:"LONG",
  placeholder:"type pinyin here…",inHint:"toneless · no spaces needed",inputAria:"Type the station name in pinyin",
  kbWarn:"Please switch to an English keyboard",
  origin:"ORIGIN",depart:z=>`Origin ${z} · type this station to begin`,
  doors:"Doors closed · type the next stop to depart",arriveAt:(z,p)=>`Now at ${z} · ${p}`,
  terminusReached:"Terminus reached!",quitTitle:"Quit this run?",quitMsg:"Your current progress won't be saved.",quitStay:"Keep playing",quitGo:"Quit",
  titles:["TRAINEE DRIVER","SKILLED DRIVER","ACE DRIVER"],
  bossSub:(d,n,h)=>`Long-Name Gauntlet · cleared ${d}/${n} · ${h} left`,
  lineSub:(L,a,b)=>`${L.en} · ${a} → ${b}`,
  rTime:"TIME",rCleared:"CLEARED",rLives:"LIVES",rDist:"DIST",rTop:"TOP SPEED",rSpeed:"SPEED",
  rAcc:"ACC",rCombo:"MAX COMBO",rErr:"ERRORS",rScore:"SCORE",
  fastest:(z,s)=>`⚡ Fastest: <b>${z}</b> (${s}s)　`,slowest:(z,s)=>`🐢 Slowest: <b>${z}</b> (${s}s)`,
  heatTitle:"cell color = typing speed",again:"REPLAY",back:"CHOOSE LINE",
  lineName:L=>L.en,revTitle:"Reverse direction",revBtn:"Reverse",
  stops:n=>`${n} stops`,bossCount:n=>`${n} names`,
  diffEasy:"EASY",diffMedium:"MEDIUM",diffHard:"HARD",diffImp:"INSANE",
  go:"GO",challenge:"FIGHT",
  bossFact:`The network's ${BOSS.length} longest station names, one after another. Too slow and you lose a heart!`,
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
  document.querySelectorAll("[data-i18n]").forEach(el=>{const v=t(el.dataset.i18n);if(v!=null)el.textContent=v});
  $("langBtn").textContent=t("lang");
  paintTheme(); // theme button label follows the active language
  paintPxSet();
  inp.placeholder=t("placeholder");inp.setAttribute("aria-label",t("inputAria"));
  $("heatstrip").title=t("heatTitle");
  renderWorld(); // (the world screen, the About dialog, the map's START sign)
  if(typeof cloudLangRefresh==="function")cloudLangRefresh();
  if(S.screen==="game"){refreshBoardLang();if(pxLive())pxTry(()=>RIDE.set({lab:pxLab()}))}
  if(S.screen==="result")showResult(true);
  pxDlgs()}
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
  const b=$("themeBtn");b.textContent=t(THEME);b.setAttribute("aria-label",t("setTheme")+" · "+t(THEME));
  if(pxUp){if(S.screen==="menu"){ovTh=r;ovTry(()=>OVM.theme())}pxChrome()} // (also runs at boot, before the pixel globals exist)
  if(typeof RIDE!=="undefined"&&r!==pxTheme){pxTheme=r;pxTry(()=>RIDE.theme())}}
let pxTheme=null,pxUp=false; // pxUp: boot() ran (the pixel globals below exist)
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
// network bounding box in SVG units (stations only): fitAll frames the whole network
// without being thrown off by the city/district backdrop that extends far beyond it
const NETBB=(()=>{let x0=1/0,y0=1/0,x1=-1/0,y1=-1/0;
  for(const[,st]of REG){x0=Math.min(x0,st.x);y0=Math.min(y0,st.y);x1=Math.max(x1,st.x);y1=Math.max(y1,st.y)}
  return{x:x0,y:y0,width:x1-x0,height:y1-y0}})();

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
  if(opts&&opts.bounds&&BOUNDS){ // city (solid) + district (dashed) outlines, behind everything
    for(const d of BOUNDS.districts)s+=`<path class="bdry dist" d="${d.d}"/>`;
    for(const c of BOUNDS.cities)s+=`<path class="bdry city" d="${c.d}"/>`;}
  for(const r of RIVERS)s+=`<path class="riv" d="${r}"/>`;
  for(const L of LINES) // loop lines close back to their first station (decorative arc)
    s+=`<path class="lpath" data-line="${L.id}" d="${roundPath(L.loop?[...L.stations,L.stations[0]]:L.stations)}" stroke="${L.color}"/>`;
  for(const [zh,st] of REG){
    const inter=st.lines.length>1;
    s+=`<g class="stg" data-st="${zh}">`;
    s+=`<circle class="pulseHolder" data-p="${zh}" cx="${st.x}" cy="${st.y}" r="9" fill="none" stroke="#ffb020" stroke-width="2" opacity="0"/>`;
    s+=`<circle class="heat${inter?" inter":""}" data-h="${zh}" cx="${st.x}" cy="${st.y}" r="${inter?14:10}" fill="none" stroke="none" stroke-width="2.5"/>`;
    if(inter)s+=`<circle class="dot inter" data-d="${zh}" cx="${st.x}" cy="${st.y}" r="10" style="fill:var(--map-inter);stroke:var(--map-inter-ring)" stroke-width="3"/>`;
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
  bossList:[],bossI:0,lives:3,bossDone:0,deadline:0,bossSec:10,revealing:false,paused:false,pauseAt:0};
const dirState={},bests={};
let lastRun=null;

const gMap=$("gMap"),mapWrap=$("mapWrap"),inp=$("pyin");
let cam={cx:370,cy:633,w:1150},camT={cx:370,cy:633,w:1150},camFollow=false,camPunch=0;
let nodes=null; // {dot,heat,pulse,zh} per 汉字 for game map
// v0.4.16: past GM_BASEW the game map counter-scales like the menu map — dots,
// strokes, rings, labels and the train hold the slim on-screen size they have
// at that depth, so the follow lens can dive without anything ballooning
const GM_BASEW=875;
const IS_TOUCH=matchMedia("(pointer:coarse)").matches;
// touch screens ride with chunkier furniture (v0.5.5): train, dots, rings, strokes
// and labels render 1.25× their desktop size at every depth — phones are small
const GM_TOUCH=IS_TOUCH?1.25:1;
let gmK=1,gmKQ=1,trainAng=0,gmGs=null;
const gmKof=w=>clamp(w/GM_BASEW,.08,1)*GM_TOUCH;

function collectNodes(){nodes={};gmGs=null;gmK=-1;gmKQ=-1;
  gMap.querySelectorAll("[data-d]").forEach(e=>{(nodes[e.dataset.d]=nodes[e.dataset.d]||{}).dot=e});
  gMap.querySelectorAll("[data-h]").forEach(e=>{(nodes[e.dataset.h]=nodes[e.dataset.h]||{}).heat=e});
  gMap.querySelectorAll("[data-p]").forEach(e=>{(nodes[e.dataset.p]=nodes[e.dataset.p]||{}).pulse=e});
  gMap.querySelectorAll("[data-zh]").forEach(e=>{(nodes[e.dataset.zh]=nodes[e.dataset.zh]||{}).zh=e})}

function gmShrink(){const k=gmKof(cam.w);
  if(Math.abs(k-gmK)<.003)return;gmK=k;
  if(Math.abs(k-1)<.001)gMap.style.removeProperty("--zs");else gMap.style.setProperty("--zs",k.toFixed(3));
  const tr=$("trainR");
  if(tr)tr.setAttribute("transform",`rotate(${trainAng.toFixed(1)}) scale(${(1.15*k).toFixed(3)})`);
  for(const g of gmGs||(gmGs=[...gMap.querySelectorAll(".stg>g:last-child")])){const d=g.dataset;
    if(Math.abs(k-1)<.001)g.removeAttribute("transform");
    else g.setAttribute("transform",`translate(${(d.sx*(1-k)).toFixed(1)} ${(d.sy*(1-k)).toFixed(1)}) scale(${k.toFixed(3)})`)}
  // bend radius tracks the slimmed strokes (see v0.4.12); quantized so path
  // rebuilds stay occasional while the lens glides
  const q=Math.round(k*25)/25;
  if(q!==gmKQ){gmKQ=q;gMap.querySelectorAll(".lpath").forEach(p=>{const L=LINES.find(l=>l.id===p.dataset.line);
    if(L)p.setAttribute("d",roundPath(L.loop?[...L.stations,L.stations[0]]:L.stations,14*q))})}}

function applyCam(){const asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight));
  const h=cam.w/asp;gMap.setAttribute("viewBox",`${cam.cx-cam.w/2} ${cam.cy-h/2} ${cam.w} ${h}`);
  gmShrink()}
function fitAll(instant){const bb=NETBB,pad=64,
  asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight));
  camT={cx:bb.x+bb.width/2,cy:bb.y+bb.height/2,w:Math.max(bb.width+pad*2,(bb.height+pad*2)*asp)};
  camFollow=false;if(instant){cam={...camT};applyCam()}}
// frame just the ridden line (the whole 19-line network dwarfs any single run);
// the box covers the measured label boxes too, so the terminus recap (names
// return zoomed-out) clips no station name
function fitSeq(instant){if(!S.seq.length)return fitAll(instant);
  let sx0=1e9,sy0=1e9,sx1=-1e9,sy1=-1e9;
  for(const s of S.seq){sx0=Math.min(sx0,s.x);sy0=Math.min(sy0,s.y);sx1=Math.max(sx1,s.x);sy1=Math.max(sy1,s.y)}
  const pad=40,asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight));
  // labels render counter-scaled at this depth, so scale the measured boxes by
  // the k the target width implies (two passes converge close enough)
  let w=Math.max(sx1-sx0+pad*2,(sy1-sy0+pad*2)*asp),cx=(sx0+sx1)/2,cy=(sy0+sy1)/2;
  for(let it=0;it<2;it++){const k=gmKof(w);
    let x0=sx0,y0=sy0,x1=sx1,y1=sy1;
    for(const s of S.seq){const g=gMap.querySelector(`.stg[data-st="${s.zh}"]`),
      lg=g&&g.lastElementChild;if(!lg)continue;const b=lbox(lg,lg.dataset.ta);
      x0=Math.min(x0,s.x+k*(b[0]-s.x)-4);y0=Math.min(y0,s.y+k*(b[1]-s.y)-4);
      x1=Math.max(x1,s.x+k*(b[0]+b[2]-s.x)+4);y1=Math.max(y1,s.y+k*(b[1]+b[3]-s.y)+4)}
    w=Math.max(x1-x0+pad*2,(y1-y0+pad*2)*asp);cx=(x0+x1)/2;cy=(y0+y1)/2}
  camT={cx,cy,w};
  camFollow=false;if(instant){cam={...camT};applyCam()}}

const HEATC={good:"#2fbf71",mid:"#f0b429",bad:"#e5484d"};

/* ---------- screens ---------- */
// v0.5.7: entering a run arms one history entry so a stray back (Android button/gesture,
// iOS edge swipe, mouse back) pops it — handled in the popstate guard below — instead of
// unloading the page straight to the title screen. try/catch: pushState can throw on file://.
function show(name){S.screen=name;
  if(name==="game")try{if(!(history.state&&history.state.run))history.pushState({run:1},"")}catch(e){}
  $("menu").hidden=name!=="menu";$("game").hidden=name!=="game";$("result").hidden=name!=="result";
  $("homeBtn").hidden=name!=="game";$("accBtn").hidden=name==="game";
  for(const id of["lbBtn","aboutBtn"])if($(id))$(id).hidden=name!=="menu"; // (the world screen's chips)
  if(name!=="menu")wChips(false);
  if(name!=="menu"&&wHov)wHover(null);
  if(name!=="game"){pxRun++;S.px=S.pxWait=pxMiss=false;document.body.classList.remove("px");$("pxVeil").hidden=true;wGoEnd();
    if(typeof RIDE!=="undefined")RIDE.stop()}
  if(name!=="menu"&&typeof RIDE!=="undefined")RIDE.prefetch(null); // (a line card's prefetch never queues ahead of a ride)
  document.body.classList.toggle("boss",name==="game"&&S.mode==="boss");
  pxChrome()} // (the menu map re-paints here when it was freed, deferred, or its scale / theme changed meanwhile: ovSync)

/* ---------- pixel ride (v0.6.0: js/px + js/map) ----------
   Settings → Ride view: Pixel (default) | Classic (the SVG map above, also the automatic fallback). The scripts load on idle
   ~3 s after boot, after the menu set (pxLoad: classic <script async=false> tags shared by both sets, so file:// works). startLine stays
   synchronous (its inp.focus() raises the phone keyboard): the SVG map is always built (hidden under body.px, so fitSeq
   and a fallback work at once); the veil covers RIDE.prepare while S.pxWait (typing ignored, clocks not started). Rides
   Classic instead: no 2D canvas, a script still failing after 2 retries or the map data fails, > 12 s, a throw in any RIDE call
   (for the session), or the frame governor gave up (from the next ride, one toast) — Settings then shows Classic with a note, and
   picking Pixel again retries. Stored locally (ride, pxScale, weather), not cloud-synced. An open line card prefetches only its
   first frame's tiles (RIDE.prefetch; nothing on saveData); the whole ride streams from the Go tap.
   Pieces: pxLoad (a set in order; ?v=APP_VERSION + MAP.ver over http(s)) · pxHan (the nickname hanzi face, for cloud.js) · pxAvail /
   pxOn / pxLive · pxRide (veil → RIDE.prepare → RIDE.start, also a mid-run Classic→Pixel takeover) · pxClock (a give-up clock, visible
   time only) · pxClassic · pxTry (wraps every drawing RIDE call) · pxChrome (the art px scale + PAL → the --px-* kit tokens) · pxLc (the
   [data-lc] line colours) · pxDlg (dialogs on whole art px) · pxVeil · pxChips / pxSize / pxLab (RIDE.set / prepare inputs) ·
   paintPxSet (the Settings rows) · pxPre (a line card's prefetch). The menu's pixel map (OVM) has its own block below. */
let RIDE_MODE=store.get("ride")==="classic"?"classic":"pixel",PX_SCALE=store.get("pxScale")==="3"?3:2,
  WX_MODE=["auto","clear","rain"].includes(store.get("weather"))?store.get("weather"):"auto";
let pxDead=false,pxFail=false,pxRun=0,pxSlowTold=false,pxPrep=0,pxMiss=false,pxHanP=null; // pxPrep: the run whose prepare is in flight · pxMiss: this run's pixel ride failed
// [script, the global it defines, optional] in load order (a script that threw for want of an earlier one leaves its global unset).
// PX_MENU = the menu's pixel map (v0.7.0), a subset in the same order; the ride's end-of-ride view uses it too, but rides without it
const PX_JS=[["map/lines","MAPLINES"],["map/map","MAP"],["px/pixel","PX"],["px/palette","PAL"],["px/fonts","FONTS"],["px/sprites","SPR"],
  ["px/ann"],["px/geom","GEOM"],["px/src","PX.srcFor"],["px/world","WORLD"],["px/weather","WEATHER"],["px/train","TRAIN"],
  ["px/traffic","TRAFFIC"],["px/labels","LABELS"],["px/ui","UI"],["map/ov","MAPOV",1],["px/ovmap","OVM",1],["px/ride","RIDE"]],
  PX_MENU=[["px/pixel","PX"],["px/palette","PAL"],["px/fonts","FONTS"],["px/sprites","SPR"],["px/geom","GEOM"],["map/ov","MAPOV"],["px/ovmap","OVM"]],
  PX_FONT=[["px/fonts","FONTS"]], // (no pixel map: the kit's pixel faces all the same)
  pxOk={},pxIn={},pxPs=new Map(); // pxOk: 1 loaded / 0 failed (absent: in flight) · pxIn: each script's tag promise · pxPs: each set's load
const PX_CANVAS=(()=>{try{return!!document.createElement("canvas").getContext("2d")}catch(e){return false}})();
// classic <script async=false> tags (file:// works; they run in insertion order across both sets, a script in flight is shared).
// A script that failed to load never ran: only those (and any left without their global) are injected again as fresh tags, twice at
// most (after 0.6 s, then 1.8 s), before the set gives up. Over http(s) they (and, through MAP.ver, the map tiles) carry
// ?v=APP_VERSION, so a release never mixes with a cached older set
const PX_HTTP=/^https?:$/.test(location.protocol);
function pxPut(f,k){if(pxIn[f]&&!(f in pxOk))return pxIn[f];delete pxOk[f];
  return pxIn[f]=new Promise(r=>{const s=document.createElement("script");
    s.src="js/"+f+".js"+(PX_HTTP?"?v="+APP_VERSION+(k?"&r="+k:""):"");s.async=false; // (a retry skips a cached broken copy)
    s.onload=()=>{pxOk[f]=1;if(f==="map/map"&&PX_HTTP&&typeof MAP!=="undefined")MAP.ver=APP_VERSION;
      if(f==="px/palette"&&typeof PAL!=="undefined"){pxLc();pxChrome()}if(f==="px/fonts")wFontsOn();r()};
    s.onerror=()=>{pxOk[f]=0;s.remove();r()};document.head.appendChild(s)})}
function pxLoad(set=PX_JS){let p=pxPs.get(set);if(p)return p;
  const got=g=>!g||g.split(".").reduce((o,k)=>o&&o[k],window)!==undefined,miss=()=>set.filter(([f,g])=>!pxOk[f]||!got(g));
  p=(async()=>{for(let k=0;;k++){const fs=miss();if(!fs.length||k>2&&fs.every(x=>x[2]))return;
    if(k>2)throw new Error("pixel: "+fs.map(([f])=>"js/"+f+".js").join(" ")+" failed");
    if(k)await new Promise(r=>setTimeout(r,600*(2*k-1)));await Promise.all(fs.map(([f])=>pxPut(f,k)))}})();
  pxPs.set(set,p);if(set===PX_JS)p.catch(()=>{pxDead=pxFail=true;paintPxSet()});return p}
// FP12's common-hanzi supplement (js/px/fonts-han.js, 83 KB), injected once where a nickname may show (cloud.js) → Promise<bool loaded>
function pxHan(){return pxHanP||(pxHanP=new Promise(r=>{const s=document.createElement("script");s.src="js/px/fonts-han.js"+(PX_HTTP?"?v="+APP_VERSION:"");
  s.onload=()=>r(typeof FONTS!=="undefined"&&FONTS.hanReady||false);s.onerror=()=>{pxHanP=null;s.remove();r(false)};document.head.appendChild(s)}))}
const pxAvail=()=>PX_CANVAS&&!pxDead&&!(typeof RIDE!=="undefined"&&RIDE.giveUp);
const pxOn=()=>RIDE_MODE==="pixel"&&pxAvail();
const pxLive=()=>S.px&&!S.pxWait; // RIDE is loaded and drawing this run (S.px alone is also true behind the veil)
const pxTight=()=>S.px&&mapWrap.classList.contains("pxTight"); // the map column beside a short LED board (ride.js): its notes go to the screen reader only
const pxLab=()=>({time:t("chipTime"),dist:t("chipDist"),wpm:t("chipWpm"),acc:t("chipAcc"),combo:t("chipCombo"),score:t("chipScore")});
// the floating chips over the canvas: bottom (from #mapWrap's top) and left edge (from its right), CSS px — full: over the whole
// window (the canvas-to-be of a takeover from the Classic layout); the pixel canvas' size
const pxChips=full=>{const f=$("fchips").getBoundingClientRect(),m=full?{top:0,right:innerWidth,width:1}:mapWrap.getBoundingClientRect();
  return{top:Math.max(0,f.bottom-m.top),right:Math.max(0,(m.width?m.right:innerWidth)-f.left)}};
const pxSize=()=>({w:innerWidth,h:parseFloat(document.body.style.getPropertyValue("--vvh"))||innerHeight});
// the veil's bar: PX_SEG LED segments of 3 art px (css: 2 lit + 1 gap), lit a whole segment at a time
const PX_SEG=26;
// (while the START overlay #goFx holds, it has the bar: #goBar)
function pxVeil(p){if(p<0){$("pxVeil").hidden=true;wGoReady();return}
  const n=Math.round(p*PX_SEG);if(goHold){$("pxVeil").hidden=true;const b=$("goBar");if(b)b.style.setProperty("--pxn",n);return}
  $("pxVeil").hidden=false;$("pxBar").style.setProperty("--pxn",n)}
// the pixel kit (v0.7.0): 1 art px = --pxk CSS px = round(scale × dpr) / dpr (whole device px, so pixel fonts stay 1:1 and crisp).
// The menu, chips and dialogs follow Settings → Pixel size, but 3× only from 600 CSS px wide (a phone stays 2×; index.html's head
// script sets the same at first paint); the ride (body.px) follows Settings as is. PXC = each --px-* token's PAL role [night, day]
// (css/style.css holds the same values as static hexes, so nothing flashes before PAL loads); onaccent / onbad = the better of
// text / textOutline on accent-sign / bad-sign
const PXC={page:"bg",ground:"land.d1",fill:["ui.panel","ui.panel2"],fill2:["ui.panel2","ui.panel"],off:"ui.panel2",edge:"ui.edge",hi:"ui.hi",lo:"ui.lo",
  shadow:"shadow",ink:"ink",text:"text",dim:"ui.dim",outline:"textOutline",accent:"ui.accent","accent-lo":"ui.accentLo","accent-hi":["fire.core","fire.t2"],
  "accent-tx":"ui.accentTx","accent-sign":"ui.accentSign","bad-sign":"ui.badSign",good:"hud.good",warn:"hud.warn",bad:"hud.bad",paper:"stn.fill",
  "paper-lo":"stn.lo",screen:"led.bg",led:"led.on","led-off":"led.off","led-glow":"led.glow","fire-t3":"fire.t3","fire-t2":"fire.t2","fire-core":"fire.core",
  "tag-good":["hud.good","green.d0"],"tag-mid":["ui.accentTx","boat.wood.lo"],"tag-hard":["fire.t1","veh.taxi.face"],"tag-bad":["hud.bad","veh.c3.lo"]};
const pxMS=()=>PX_SCALE===3&&innerWidth>=600?3:2,pxKof=s=>{const d=devicePixelRatio||1;return Math.max(1,Math.round(s*d))/d};
function pxChrome(){const r=document.documentElement.style,b=document.body.style;
  if(typeof pxK==="function")pxK(); // (index.html's head script: also html.nar: a phone, up to 560 CSS px wide)
  r.setProperty("--pxk",pxKof(pxMS()));r.setProperty("--pxkm",pxKof(pxMS())); // (--pxkm: dialogs over the ride keep the menu's scale)
  if(document.body.classList.contains("px"))b.setProperty("--pxk",pxKof(PX_SCALE));else b.removeProperty("--pxk"); // (body.px redeclares --pxu)
  document.body.classList.toggle("px3",PX_SCALE===3); // (a phone at 3×: icon-only chips)
  ovSync();pxDlgs();
  if(typeof PAL==="undefined")return;
  const day=document.documentElement.dataset.theme==="light",P=PAL[day?"day":"night"],col=k=>k.split(".").reduce((o,x)=>o&&o[x],P);
  if(!P)return;
  for(const k in PXC){const v=col(Array.isArray(PXC[k])?PXC[k][+day]:PXC[k]);if(v)r.setProperty("--px-"+k,v)}
  const on=[col("text"),col("textOutline")],best=c=>on.sort((x,y)=>crOf(y,c)-crOf(x,c))[0];
  r.setProperty("--px-onaccent",best(col("ui.accentSign")));r.setProperty("--px-onbad",best(col("ui.badSign")));
  const sh=S.line&&P.lsh&&P.lsh[S.line.id];
  r.setProperty("--px-line",sh?sh.disp:col("ui.accent"));r.setProperty("--px-seg",sh?sh.txt:col("ui.accent"))}
// [data-lc=<id>] → --lc (a fill that carries text: PAL lsh.<id>.sign) / --lc-ink (≥ 4.5:1 on it) / --lc-hi / --lc-lo in both themes;
// before PAL loads btnBg / txOn stand in (hi = lo = --lc). Boss = the kit's bad sign
function pxLc(){let el=$("pxLc");if(!el){el=document.createElement("style");el.id="pxLc";document.head.appendChild(el)}
  const P=typeof PAL!=="undefined"&&PAL.night&&PAL.day,r=(sel,id,c,k,h,l)=>`${sel}[data-lc="${id}"]{--lc:${c};--lc-ink:${k};--lc-hi:${h};--lc-lo:${l}}\n`;
  let css="";
  for(const L of LINES)if(P)for(const[th,sel]of[["night",":root "],["day",":root[data-theme=light] "]]){const s=PAL[th].lsh[L.id];if(s)css+=r(sel,L.id,s.sign,s.ink,s.hi,s.lo)}
    else{const c=btnBg(L.color);css+=r("",L.id,c,txOn(L.color),c,c)}
  el.textContent=css+"[data-lc=boss]{--lc:var(--px-bad-sign);--lc-ink:var(--px-onbad);--lc-hi:var(--px-fire-t2);--lc-lo:var(--px-tag-bad)}"}
// a pixel dialog (.pk-dlg) sits on whole art px of its own scale: after showModal, each re-render and resize (cloud.js: #accDlg)
function pxDlg(d){if(!d||!d.open||!d.classList.contains("pk-dlg"))return;
  const u=parseFloat(getComputedStyle(d).getPropertyValue("--pxk"))||1,r=d.getBoundingClientRect();
  d.style.left=Math.max(0,Math.floor((innerWidth-r.width)/2/u)*u)+"px";d.style.top=Math.max(0,Math.floor((innerHeight-r.height)/2/u)*u)+"px"}
const PX_DLGS=["setDlg","accDlg","quitDlg","lbDlg","aboutDlg"],pxDlgs=()=>{for(const id of PX_DLGS)pxDlg($(id))};
if(typeof ResizeObserver==="function"){const ro=new ResizeObserver(pxDlgs);for(const id of PX_DLGS)if($(id))ro.observe($(id))} // (late fonts, a note, a re-render)
// back to the SVG map for this run (a waiting run gets its departure toast now)
function pxClassic(){const w=S.pxWait;pxRun++;S.px=S.pxWait=false;document.body.classList.remove("px");pxVeil(-1);
  if(typeof RIDE!=="undefined")RIDE.stop();
  if(w&&S.screen==="game")announce(t("depart",S.seq[0].zh))}
// every game.js → RIDE call (they draw): a throw switches to Classic for the session, the run itself goes on
function pxTry(f){try{f()}catch(e){console.error("pixel ride → classic:",e);pxDead=true;pxClassic();paintPxSet()}}
// a give-up clock (a prepare's 12 s, the menu map's 8 s) runs only while the page is visible (a background tab gets no frames)
function pxClock(ms){let left=ms,t0=0,tm=0,j=null;
  const tick=()=>{if(document.hidden){if(tm){clearTimeout(tm);tm=0;left-=performance.now()-t0}}
      else if(!tm){t0=performance.now();tm=setTimeout(()=>{off();j(new Error("pixel: not ready after "+ms/1e3+" s"))},left)}},
    off=()=>{clearTimeout(tm);document.removeEventListener("visibilitychange",tick)};
  return{p:new Promise((_,x)=>{j=x;document.addEventListener("visibilitychange",tick);tick()}),off}}
async function pxRide(L,rev,live){const run=++pxRun,pct=p=>{if(run===pxRun&&S.pxWait)pxVeil(p)},clk=pxClock(12000); // a dropped prepare never re-shows the veil
  pxPrep=run;
  try{await Promise.race([pxLoad().then(()=>{if(run!==pxRun)return; // (dropped while the scripts loaded: a quit, the 12 s fallback)
        pxChrome();RIDE.set({scale:PX_SCALE,weather:WX_MODE,lab:pxLab(),kb:document.body.classList.contains("kb"),...pxChips(live)});
        return RIDE.prepare(L,rev,live?null:pct,S,live?pxSize:null)}), // live: planned round the train, at the pixel canvas' size
      clk.p]);clk.off();if(pxPrep===run)pxPrep=0;
    if(run!==pxRun||S.screen!=="game"||S.mode!=="line"||S.line!==L||S.rev!==rev||(live&&(S.done||!pxOn())))return;
    document.body.classList.add("px");S.px=true;pxChrome();
    RIDE.set({scale:PX_SCALE,weather:WX_MODE,lab:pxLab(),kb:document.body.classList.contains("kb"),...pxChips()});
    RIDE.start(L,S);
    if(S.pxWait){S.pxWait=false;pxVeil(-1);announce(t("depart",S.seq[0].zh),pxTight())}}
  catch(e){clk.off();if(pxPrep===run)pxPrep=0;if(run!==pxRun)return;console.warn("pixel ride → classic:",e);pxClassic();pxMiss=true;paintPxSet()}} // (Settings: Classic, tap to retry)

/* ---------- pixel menu map (v0.7.0: js/px/ovmap.js OVM over js/map/ov.js; API in its header) ----------
   OVM draws the world screen's map on its own canvas in #ovHost. The SVG #ovMap (built at boot) shows until OVM's first frame is
   painted and is the instant fallback for the rest of the session (ovFail): no 2D canvas, the menu set failing 3×, any OVM call
   throwing (ovTry), or no frame within 8 s of visible time. The menu set (PX_MENU) loads after the page's load + idle, at once on a
   start / chip click or once #pick shows (saveData: only those); it mounts on the menu (#pick is laid out below the
   hero, so its first view bakes before the hero folds; its trains run only on screen). The world code frames it (wRefit: OVM.focus / go with the pads of the UI over it) and gives it life (wLife: the island,
   lively trains, progress badges, the START sign; the gauntlet's marks); the adapters ovHighlight / ovLabels / ovZoom / ovResetView
   keep the SVG in step while it shows. Off the menu it stays mounted but idle (its IntersectionObserver stops the trains with #menu
   hidden); a pixel ride on a small device frees its caches (the ride's end-of-ride view bakes its own) and the menu re-paints on
   return (ovSync). North-up: the SVG's rotation and #ncue return only with the SVG. */
let ovP=null,ovMt=false,ovOn=false,ovDead=false,ovScale=0,ovTh="",ovClk=null,ovPend=false,ovFreed=false,ovInp=null;
const ovM=()=>ovMt&&!ovDead,ovLive=()=>ovOn&&ovM(); // mounted · painted (the SVG hidden)
function ovTry(f){if(!ovM())return;try{return f()}catch(e){ovFail(e)}}
// which map shows: the SVG (+ its north cue) or the pixel host (kept invisible while OVM bakes its first view, so the SVG gets the input)
function ovSvg(on){$("ovMap").style.display=on?"":"none";if($("ncue"))$("ncue").style.display=on?"":"none";
  if($("ovHost"))$("ovHost").style.visibility=on?"hidden":""}
function ovFail(e){if(ovDead)return;ovDead=true;if(e)console.warn("pixel map → svg:",e);if(ovClk)ovClk.off();
  try{if(ovInp)ovInp();if(ovMt)OVM.unmount()}catch(x){}
  const was=ovOn;ovMt=ovOn=false;ovSvg(true);if($("ovHost"))$("ovHost").hidden=true;
  if(was){ovHighlight(null);wSvgK="";wRefit()}} // (an SVG still showing kept in step, and its free zoom)
function pxMenu(){if(ovP)return ovP;if(ovDead)return ovP=pxLoad(PX_FONT).catch(()=>{});ovClk=pxClock(8000);ovClk.p.catch(ovFail);
  return ovP=pxLoad(PX_MENU).then(ovMount,ovFail)}
// mount (again for a new scale, a theme or freed caches that changed off the menu): the first time lazily (the SVG shows until
// onReady), after that with a synchronous bake of the view (no blank frame). The island is set before (it is baked into the tiles)
function ovMount(){const h=$("ovHost");if(ovDead||!h||typeof OVM==="undefined")return;
  if(S.screen!=="menu"){ovPend=true;if(ovClk&&!ovOn){ovClk.off();ovClk=null}return} // (its 8 s restart with the mount)
  if(!ovOn&&!ovClk){ovClk=pxClock(8000);ovClk.p.catch(ovFail)}
  ovPend=ovFreed=false;ovScale=pxMS();ovTh=document.documentElement.dataset.theme;wLast="";
  try{h.hidden=false;if(typeof OVM.island==="function")OVM.island(true);
    OVM.focus(wFocus(),{animate:false,pad:wPad()}); // (unmounted: sets the view the first frame shows)
    ovMt=true;OVM.mount(h,{scale:ovScale,lazy:!ovOn,onReady:ovReady});
    if(!ovInp)ovInp=OVM.input(h,{dbl:false,onPick:wMapPick,onHover:id=>wHover(id,"map")});
    wLife();wRefit(true)}
  catch(e){ovFail(e)}}
function ovReady(){ovOn=true;if(ovClk){ovClk.off();ovClk=null}ovSvg(false);wRefit(true)}
function ovSync(){if(ovDead||S.screen!=="menu")return;
  if(ovPend||ovM()&&(ovFreed||pxMS()!==ovScale||ovTh!==document.documentElement.dataset.theme))ovMount()}

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

function startLine(L,rev){S.mode="line";S.line=L;S.rev=rev;lastRun={mode:"line",L,rev};pxMiss=false;
  ac(); // (inside the Go tap: the AudioContext is created / resumed now, not on the first station's ding)
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
  buildMap(gMap,{train:true,bounds:true});collectNodes();
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
  // pixel ride: the canvas takes over once its first frame is ready (the veil covers the wait)
  const px=pxOn();S.px=S.pxWait=px;document.body.classList.toggle("px",px);
  if(px&&ovM()&&(IS_TOUCH||(navigator.deviceMemory||8)<=4)){ovFreed=true;ovTry(()=>OVM.free())} // (the menu map's caches make room)
  if(px){pxChrome();pxVeil(0);pxRide(L,rev,false)}
  else{pxRun++;if(typeof RIDE!=="undefined")RIDE.stop();
    if(RIDE_MODE==="pixel"&&typeof RIDE!=="undefined"&&RIDE.giveUp&&!pxSlowTold){pxSlowTold=true;announce(t("pxSlow"))}
    else announce(t("depart",o.zh))}
  inp.focus()} // sync inside the card tap: its user activation lets mobile raise the keyboard

function startBoss(){S.mode="boss";S.line=null;lastRun={mode:"boss"};pxMiss=false;ac();
  pxRun++;S.px=S.pxWait=false;document.body.classList.remove("px"); // boss mode never rides pixel
  S.bossList=shuffle(BOSS);S.bossI=0;S.lives=3;S.bossDone=0;
  resetStats();show("game");
  const c="#e5484d",cd=dispOf(c);
  document.body.style.setProperty("--lc",c);
  document.body.style.setProperty("--lcd",cd);
  document.body.style.setProperty("--lcg",alpha(cd,.32));
  $("board").style.setProperty("--lc",c);$("board").style.setProperty("--lcg",alpha(cd,.35));
  $("zhChip").textContent="★";$("zhChip").style.background=c;$("zhChip").style.color=txOn(c);
  $("lives").textContent="♥♥♥";buildPbar();
  setBossPrompt();inp.focus()}

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
  if(nxt){$("nuLabel").textContent=t(S.idx+1===S.seq.length-1?"terminus":"upNext");
    $("nuZh").textContent=nxt.zh;$("nuPy").textContent=nxt.py}
  box.hidden=!nxt;pyDesc()}
// #pyin's description: board label + name, and the look-ahead only while it shows (not at the terminus, not in boss mode)
const pyDesc=()=>inp.setAttribute("aria-describedby","brdLabel zhTxt"+(S.mode==="line"&&!$("nextUp").hidden?" nuZh":""));

function setBossPrompt(){const st=S.bossList[S.bossI];
  S.key=st.key;S.typed=0;S.firstT=null;S.errSt=false;S.revealing=false;
  inp.disabled=false;inp.value="";
  $("brdLabel").textContent=t("beatClock");
  $("zhTxt").textContent=st.zh;
  const d=diffOf(st.key.length);const tg=$("dTag");tg.hidden=false;tg.className="tag "+d.k;tg.textContent=t(d.t)+" · "+st.key.length;
  $("cnt").textContent=(S.bossI+1)+"/"+S.bossList.length;pyDesc();
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
// v0.4.3 lock-in on mobile too: IME deletes arrive as beforeinput, not Backspace keydown
inp.addEventListener("beforeinput",e=>{
  if(!e.isComposing&&/^(delete|history)/.test(e.inputType))e.preventDefault()});
document.addEventListener("keydown",e=>{
  if(S.screen!=="game")return;
  if(S.paused||$("setDlg").open||$("accDlg").open)return; // a dialog is open — let it own the keys (native Esc closes it)
  if(e.key==="Escape"){e.preventDefault();quit();return} // preventDefault so this same Esc doesn't also close the dialog we just opened
  // correct keystrokes lock in — no deleting/retyping (since v0.4.3)
  if(e.key==="Backspace"||e.key==="Delete"){e.preventDefault();return}
  if(document.activeElement!==inp&&e.key.length===1&&!e.metaKey&&!e.ctrlKey)inp.focus()});
// tap the board to (re)summon the soft keyboard — on click, not pointerdown: the tap's
// own mousedown-default blurs whatever pointerdown focused, so the keyboard closed before
// it could open; by click time that blur is done and this focus sticks. blur() first
// because a bare focus() is a no-op when the input kept focus without a keyboard
// (run-start focus outside a tap), and blur→focus inside the tap re-raises the IME.
const refocus=()=>{if(S.screen!=="game")return;
  if(document.activeElement===inp)inp.blur();
  inp.focus()};
$("board").addEventListener("click",refocus);
mapWrap.addEventListener("click",e=>{if(e.target.id==="pxCv")refocus()}); // the pixel LED board lives in the canvas
// soft keyboard (mobile): while the sink is focused and the visual viewport is squeezed
// well below the layout viewport (that gap is the IME — desktop resizes shrink both),
// body.kb + --vvh compress the cab into the visible strip; released when it closes
const vv=window.visualViewport;
function kbFit(){if(!vv)return;
  const on=S.screen==="game"&&document.activeElement===inp&&vv.scale<1.02&&
    innerHeight-vv.height>140;
  document.body.classList.toggle("kb",on);if((S.px||pxPrep===pxRun&&pxPrep)&&typeof RIDE!=="undefined")pxTry(()=>RIDE.set({kb:on})); // (behind the veil / a takeover: its prepare re-aims)
  if(on){document.body.style.setProperty("--vvh",Math.round(vv.height)+"px");
    scrollTo(0,0);requestAnimationFrame(()=>$("board").scrollIntoView({block:"end"}))}
  else document.body.style.removeProperty("--vvh")}
if(vv){vv.addEventListener("resize",kbFit);
  inp.addEventListener("focus",()=>setTimeout(kbFit,60));
  inp.addEventListener("blur",()=>setTimeout(kbFit,60))}

function handleTyping(raw){
  if(S.screen!=="game"||S.done||S.revealing||!S.key)return;
  if(S.pxWait){inp.value="";return} // the pixel map is still being prepared: nothing counts yet
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
  if(pxLive()&&(ok>prev||err))RIDE.key(ok-prev,err);
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

// one-shot burst on the stop whose name was just typed: green ring + its 汉字
// above the dot. Counter-scales about its station like every other label —
// registered in gmGs so gmShrink keeps it sized while the camera glides
function typedFx(st){const reg=REG.get(st.zh),inter=reg&&reg.lines.length>1;
  const g=document.createElementNS("http://www.w3.org/2000/svg","g");
  g.setAttribute("class","doneFx");
  g.dataset.sx=st.x;g.dataset.sy=st.y;
  g.innerHTML=`<circle cx="${st.x}" cy="${st.y}" r="${inter?17:13}" fill="none" stroke="${HEATC.good}" stroke-width="3.5"/>`+
    `<text x="${st.x}" y="${st.y-(inter?40:34)}" text-anchor="middle">${st.zh}</text>`;
  const k=gmK>0?gmK:1;
  if(Math.abs(k-1)>.001)g.setAttribute("transform",
    `translate(${(st.x*(1-k)).toFixed(1)} ${(st.y*(1-k)).toFixed(1)}) scale(${k.toFixed(3)})`);
  gMap.appendChild(g);if(gmGs)gmGs.push(g);
  setTimeout(()=>{g.remove();if(gmGs){const i=gmGs.indexOf(g);if(i>=0)gmGs.splice(i,1)}},1700)}

function completeStation(){
  const i=S.idx,{t:secs,perf}=stationPerf(); // no bare `t`: the i18n t() is called below
  S.heats[i]=heatOf(perf);S.times[i]=secs;S.perfs.push(perf);
  award(perf);sDing();typedFx(S.seq[i]);if(pxLive())RIDE.done(i);
  if(i===0){ // origin typed in place — doors close, the train departs with the next stop
    const n=nodes[S.seq[0].zh];
    if(n){n.heat.setAttribute("stroke",HEATC[S.heats[0]]);if(n.zh)n.zh.classList.add("passed")}
    announce(t("doors"),pxTight());S.idx++;setPrompt();movePulse();return}
  S.idx++;setPrompt()}

/* ---------- continuous travel: typed letters earn track and drive the train directly ---------- */
// km unlocked so far: each correct letter buys its share of the segment being typed
function updCredit(){if(S.mode!=="line")return;
  if(S.idx===0){S.credit=0;return}
  const st=S.seq[S.idx];if(!st){S.credit=S.cum[S.seq.length-1];return}
  const p=S.typed/S.key.length,e=p*p*(3-2*p); // smoothstep: slow out of / into stations
  S.credit=S.cum[S.idx-1]+S.segs[S.idx-1]*(p+(e-p)*EASE)}

function angleTo(i,j){const a=S.seq[i],b=S.seq[j];return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}
function placeTrain(x,y,ang){trainAng=ang;$("trainG").setAttribute("transform",`translate(${x} ${y})`);
  $("trainR").setAttribute("transform",`rotate(${ang}) scale(${(1.15*(gmK>0?gmK:1)).toFixed(3)})`)} // 1.15 hero bump × counter-scale
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
  // phones: arrival goes to the screen reader only — the banner covered the small
  // ride map every few seconds, and the green burst already names the stop
  else announce(t("arriveAt",st.zh,st.py),IS_TOUCH||S.px)} // pixel: the LED board shows it

function movePulse(){gMap.querySelectorAll(".pulseHolder").forEach(p=>{p.setAttribute("opacity","0");p.classList.remove("pulse")});
  const st=S.seq[S.idx];if(!st)return;const n=nodes[st.zh];
  if(n&&n.pulse){n.pulse.setAttribute("opacity","1");n.pulse.classList.add("pulse");
    n.pulse.setAttribute("stroke",S.line.color)}}

let toastTimer=null;
// quiet: route to the visually-hidden role=status twin — SR still announces, and the
// visible banner (possibly mid-display with another message) is never touched
function announce(msg,quiet){if(quiet){$("srToast").textContent=msg;return}
  const t=$("toast");t.textContent=msg;t.classList.add("on");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("on"),2100)}

// the pixel ride ends on its whole-line view (RIDE.recapMs(), ≈ 3 s incl. the glide out; reduced motion: cuts, same hold) — any key or
// tap skips to the results at once (capture phase; the tap's own click is swallowed so it can't land on a result button). Classic: 1.2 s
function finishRun(){S.done=true;S.endT=performance.now();
  inp.disabled=true;camFollow=false;fitSeq(false);
  let ms=1200;if(pxLive())pxTry(()=>{RIDE.finish();if(typeof RIDE.recapMs==="function")ms=+RIDE.recapMs()||1200});
  gMap.classList.remove("noNames"); // terminus: names return for the zoomed-out recap
  sWin();if(!S.px)confetti();announce(t("terminusReached")); // (the pixel ride: no DOM confetti over the canvas)
  const end=()=>{off();if(S.screen==="game"&&S.done)showResult()},eat=e=>{e.preventDefault();e.stopPropagation();removeEventListener("click",eat,true)},
    skip=e=>{if(e.repeat)return;e.preventDefault();if(typeof RIDE.skip==="function")pxTry(()=>RIDE.skip());
      if(e.type==="pointerdown"){addEventListener("click",eat,true);setTimeout(()=>removeEventListener("click",eat,true),1000)}end()},
    off=()=>{clearTimeout(tm);removeEventListener("keydown",skip,true);removeEventListener("pointerdown",skip,true)},tm=setTimeout(end,ms);
  if(pxLive()){addEventListener("keydown",skip,true);addEventListener("pointerdown",skip,true)}}

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
  // session best (skip re-scoring when only re-rendering for a language switch); stars = the session's most, from any finished run
  if(!rerender){const key=boss?"boss":S.line.id,b=bests[key];
    S.isBest=!b||S.score>b.score;
    if(S.isBest)bests[key]={score:S.score,time:fmtT(total),acc,stars:Math.max(stars,b&&b.stars||0)};else b.stars=Math.max(b.stars||0,stars);
    if(typeof cloudOnResult==="function")cloudOnResult({
      key,mode:boss?"boss":"line",score:S.score,wpm,acc,maxCombo:S.maxCombo,
      durS:+(total/1000).toFixed(1),stars,
      cleared:boss?S.bossDone:S.seq.length,total:boss?S.bossList.length:S.seq.length,
      lives:boss?S.lives:3})}
  nb.hidden=!S.isBest;
  worldProgress()}

/* ---------- colours + the SVG map's adapters ---------- */
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
// adapters (v0.7.0): the pixel map (OVM) takes the hover while mounted; the SVG below keeps them while it shows (its framing: wRefit)
// ovHighlight(id): the hovered line lit (null: back to the framed one)
function ovHighlight(id){id=id&&id!=="boss"?id:null;if(ovM())ovTry(()=>OVM.hover(id));if(ovLive())return;const ov=$("ovMap");id=id||wFocus();
  ov.querySelectorAll(".lpath").forEach(p=>p.classList.toggle("dimline",!!id&&p.dataset.line!==id));
  const mine=id&&LINE_STS.get(id);
  ov.querySelectorAll(".stg").forEach(g=>{g.style.opacity=!mine||mine.has(g.dataset.st)?"":".25"})}
// station-name labels follow the zoom focus (the framed line), never hover
function ovLabels(id){if(ovLive())return;const mine=id&&LINE_STS.get(id);
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
// v0.4.7: free pan/zoom on the unfocused network map. freeVB = current viewBox
// window while no line is focused (null = resting at the full-network fit).
// OV_BASEZ = depth where map furniture is drawn 1:1; boot raises OV_MAXZ so the
// shortest line can fill the window, and past OV_BASEZ everything counter-scales
const OV_BASEZ=5;let freeVB=null,OV_MAXZ=OV_BASEZ,ovK=1;
const ovFocused=()=>wFocus(); // the framed line owns the viewBox
const ovFree=()=>!ovFocused()&&FULL_VB; // pan/zoom only in the default network view
function ovIsZoomed(){return!!freeVB&&freeVB[2]<FULL_VB[2]-.5}
function ovApplyVB(vb){const ov=$("ovMap");ov.setAttribute("viewBox",vb.map(n=>n.toFixed(1)).join(" "));
  ov.classList.toggle("zoomed",ovIsZoomed());
  ovShrink(ov,Math.min(1,OV_BASEZ*vb[2]/FULL_VB[2]))}
// v0.4.11: past OV_BASEZ the map furniture counter-scales (constant on-screen size
// instead of ballooning): strokes/dots via --zs in CSS, labels via ovLabelXf
function ovFurn(ov,k){if(Math.abs(k-ovK)<.004)return false;ovK=k;
  // bend radius counter-scales with the strokes: the rounded corners cut across the
  // vertex the dot sits on, so a fixed 14-unit radius leaves dots visibly off the
  // slimmed line at depth — tightening it keeps the path through the dots
  ov.querySelectorAll(".lpath").forEach(p=>{const L=LINES.find(l=>l.id===p.dataset.line);
    if(L)p.setAttribute("d",roundPath(L.loop?[...L.stations,L.stations[0]]:L.stations,14*k))});
  if(k>.999)ov.style.removeProperty("--zs");else ov.style.setProperty("--zs",k.toFixed(3));
  return true}
// v0.4.13: one transform pass over every station label, shared by free zoom and
// the focused view. Focused strip labels (data-m="s") tilt by data-t about an
// anchor offset (data-oy, unit space — scales with k) past their station dot;
// everything else stays level (counter-rotating the map's a) and counter-scales
// about its own station, so hover labels read the same at any depth or rotation.
let ovGsAll=null;
function ovLabelXf(ov,a,cx,cy,k){
  const ident=Math.abs(a)<.05&&k>.999,r=a*Math.PI/180,co=Math.cos(r),si=Math.sin(r),
    kf=k.toFixed(3),af=(-a).toFixed(2),cxf=cx.toFixed(1),cyf=cy.toFixed(1);
  for(const g of ovGsAll||(ovGsAll=[...ov.querySelectorAll(".stg>g:last-child")])){
    const d=g.dataset,px=cx+(d.sx-cx)*co-(d.sy-cy)*si,py=cy+(d.sx-cx)*si+(d.sy-cy)*co;
    if(d.m==="s")g.setAttribute("transform",
      `rotate(${af} ${cxf} ${cyf}) translate(${(px+k*d.ox).toFixed(1)} ${(py+k*d.oy).toFixed(1)}) scale(${kf}) rotate(${d.t}) translate(${-d.lx} ${-d.ly})`);
    else if(ident&&!d.ox)g.removeAttribute("transform");
    else g.setAttribute("transform",
      `rotate(${af} ${cxf} ${cyf}) translate(${(px-k*(d.sx-(d.ox||0))).toFixed(1)} ${(py-k*(d.sy-(d.oy||0))).toFixed(1)}) scale(${kf})`)}}
function ovShrink(ov,k){if(ovFurn(ov,k))ovLabelXf(ov,0,0,0,k)}
function ovClearFree(){freeVB=null;$("ovMap").classList.remove("zoomed")}
// measured label boxes (getBBox sees opacity-hidden text), cached per <g> and per
// text-anchor since strip mode re-anchors to "start"; webfont arrival re-measures
let LBB=new WeakMap();
if(document.fonts)document.fonts.ready.then(()=>{LBB=new WeakMap()});
function lbox(g,anchor){let m=LBB.get(g);if(!m)LBB.set(g,m={});
  if(!m[anchor]){const cur=g.getAttribute("text-anchor");
    if(cur!==anchor)g.setAttribute("text-anchor",anchor);
    const b=g.getBBox();m[anchor]=[b.x,b.y,b.width,b.height];
    if(cur!==anchor)g.setAttribute("text-anchor",cur)}
  return m[anchor]}
function ovClampVB(vb){ // keep the window inside the full-network bounds; centre axes that fully fit
  const[FX,FY,FW,FH]=FULL_VB;let[x,y,w]=vb;
  w=clamp(w,FW/OV_MAXZ,FW);const h=w*FH/FW; // uniform scale → height tracks width at the fit aspect
  x=w>=FW?FX+(FW-w)/2:clamp(x,FX,FX+FW-w);
  const y0=FY,y1=FY+FH;y=h>=FH?FY+(FH-h)/2:clamp(y,y0,y1-h);
  return[x,y,w,h]}
// client point → SVG user coords (root CTM handles the letterboxed aspect fit)
function ovUser(cx,cy){const ov=$("ovMap"),m=ov.getScreenCTM();if(!m)return null;
  const p=ov.createSVGPoint();p.x=cx;p.y=cy;return p.matrixTransform(m.inverse())}
function ovZoomAt(cx,cy,s){if(!ovFree())return;const u=ovUser(cx,cy);if(!u)return;
  const cur=freeVB||[...FULL_VB],[x,y,w]=cur,nw=clamp(w/s,FULL_VB[2]/OV_MAXZ,FULL_VB[2]),k=nw/w;
  freeVB=ovClampVB([u.x-(u.x-x)*k,u.y-(u.y-y)*k,nw,cur[3]*k]);ovApplyVB(freeVB)}
function ovPanBy(dxPx,dyPx){if(!ovFree())return;const m=$("ovMap").getScreenCTM();if(!m)return;
  const cur=freeVB||[...FULL_VB];freeVB=ovClampVB([cur[0]-dxPx/m.a,cur[1]-dyPx/m.d,cur[2],cur[3]]);
  ovApplyVB(freeVB)}
function ovResetView(){if(ovLive())return ovTry(()=>OVM.reset());
  if(ovFocused())return;ovZoom(null)} // animates back to the full-network fit
// v0.4.13: place the focused line's labels and grow the target viewBox to cover
// every measured label box — the fit zoom is capped so no name leaves the screen.
// All in the rotate(a,tc) frame bestFit's vb lives in. Strip mode (|a|>20°):
// ±45°-tilted labels are staggered above/below the track — a label flips sides
// when it would overlap the previous one on its own side (a tilt parallel to the
// local track stays banned) — and the perpendicular offset is measured so the box
// clears its station dot. The counter-scale k depends on the viewBox, which
// depends on the label boxes, so iterate to a fixed point.
function layoutLabels(ov,LL,a,tc,vb0,wOf=v=>v[2]){ // (wOf: the width a vb shows at — the world's free rect grows it, ovTarget)
  const strip=Math.abs(a)>20,r=a*Math.PI/180,co=Math.cos(r),si=Math.sin(r),
    rot=st=>[tc[0]+(st.x-tc[0])*co-(st.y-tc[1])*si,tc[1]+(st.x-tc[0])*si+(st.y-tc[1])*co],
    G=zh=>{const g=ov.querySelector(`.stg[data-st="${zh}"]`);return g&&g.lastElementChild},
    sts=LL.stations,lay=new Map(),
    th=sts.map((st,i)=>{const p=sts[Math.max(0,i-1)],n=sts[Math.min(sts.length-1,i+1)],
      dx=n.x-p.x,dy=n.y-p.y;
      let t=Math.atan2(dx*si+dy*co,dx*co-dy*si)*180/Math.PI;
      if(t>=90)t-=180;if(t<-90)t+=180;return t});
  let vb=vb0,k=1;
  for(let it=0;it<3;it++){
    k=FULL_VB?clamp(OV_BASEZ*wOf(vb)/FULL_VB[2],.05,1):1;
    let x0=vb0[0],y0=vb0[1],x1=vb0[0]+vb0[2],y1=vb0[1]+vb0[3];
    const grow=(xa,xb,ya,yb)=>{x0=Math.min(x0,xa-6);x1=Math.max(x1,xb+6);
      y0=Math.min(y0,ya-6);y1=Math.max(y1,yb+6)};
    // exact collision between placed labels: each is an oriented box (its true
    // rotated rectangle), overlap tested by separating axes with a 2-unit gap.
    // Every label's dodge moves monotonically along one free axis until clear
    // of ALL earlier labels, so no pair can end up overlapping.
    const placed=[],
      obb=(cx,cy,t,hw,hh)=>{const q=t*Math.PI/180,c2=Math.cos(q),s2=Math.sin(q);
        return{cx,cy,ux:c2,uy:s2,vx:-s2,vy:c2,hw,hh}},
      pen=(A,B)=>{let m=1e9;
        for(const[ax,ay]of[[A.ux,A.uy],[A.vx,A.vy],[B.ux,B.uy],[B.vx,B.vy]]){
          const o=A.hw*Math.abs(A.ux*ax+A.uy*ay)+A.hh*Math.abs(A.vx*ax+A.vy*ay)
                 +B.hw*Math.abs(B.ux*ax+B.uy*ay)+B.hh*Math.abs(B.vx*ax+B.vy*ay)
                 +2-Math.abs((B.cx-A.cx)*ax+(B.cy-A.cy)*ay);
          if(o<=0)return 0;if(o<m)m=o}
        return m},
      hitAny=A=>placed.some(p=>pen(A,p)>0),
      settle=A=>{placed.push(A);
        const ex=A.hw*Math.abs(A.ux)+A.hh*Math.abs(A.vx),
          ey=A.hw*Math.abs(A.uy)+A.hh*Math.abs(A.vy);
        grow(A.cx-ex,A.cx+ex,A.cy-ey,A.cy+ey)};
    if(strip){
      const RP=sts.map(rot),clearOf=st=>(REG.get(st.zh).lines.length>1?13:8)+2,
        idx=sts.map((s,i)=>i).filter(i=>G(sts[i].zh)),
        steepI=idx.filter(i=>Math.abs(th[i])>55).sort((p,q)=>RP[p][1]-RP[q][1]),
        tiltI=idx.filter(i=>Math.abs(th[i])<=55).sort((p,q)=>RP[q][0]-RP[p][0]);
      // near-vertical track after rotation: stations share the same rotated x,
      // so tilted labels could only stack — these sit level beside the dot
      // instead, staggered left/right, walked in y order
      const lastY={start:-1e9,end:-1e9};
      for(const i of steepI){const st=sts[i],g=G(st.zh),[px,py]=RP[i],
          d=g.dataset,clear=clearOf(st);
        const side=an=>{const bb=lbox(g,an),sx=an==="start"?1:-1,
            rx=[bb[0]-d.lx,bb[0]+bb[2]-d.lx],ry=[bb[1]-d.ly,bb[1]+bb[3]-d.ly];
          return{an,sx,ox:sx*(clear+2)+(sx>0?-rx[0]:-rx[1]),rx,ry}},
          mk=a=>obb(px+k*(a.ox+(a.rx[0]+a.rx[1])/2),py+k*(a.ry[0]+a.ry[1])/2,0,
            k*(a.rx[1]-a.rx[0])/2,k*(a.ry[1]-a.ry[0])/2),
          a1=side("start"),a2=side("end"),
          fit=a=>py+k*a.ry[0]>=lastY[a.an]+4*k&&!hitAny(mk(a)),
          c=fit(a1)?a1:fit(a2)?a2:(lastY.start<=lastY.end?a1:a2);
        for(let n=0;n<40&&hitAny(mk(c));n++)c.ox+=c.sx*4; // slide outward till clear
        lastY[c.an]=py+k*c.ry[1];
        settle(mk(c));
        lay.set(st.zh,{m:"s",t:0,ox:c.ox,oy:0,an:c.an})}
      // tilted labels, walked right to left: preferred side first, then the
      // other; when both are crowded, keep the roomier side and lift the label
      // along the tilt's perpendicular — dense runs become a readable staircase
      const lastL={"-45":null,"45":null}; // leftmost placed anchor+height per side
      for(const i of tiltI){const st=sts[i],g=G(st.zh),[px,py]=RP[i],
          d=g.dataset,clear=clearOf(st),b=lbox(g,"start"),
          rcx=b[0]+b[2]/2-d.lx,rcy=b[1]+b[3]/2-d.ly,
          rel=[[b[0]-d.lx,b[1]-d.ly],[b[0]+b[2]-d.lx,b[1]-d.ly],
               [b[0]-d.lx,b[1]+b[3]-d.ly],[b[0]+b[2]-d.lx,b[1]+b[3]-d.ly]];
        const cand=t=>{const tr=t*Math.PI/180,c2=Math.cos(tr),s2=Math.sin(tr),
            ys=rel.map(([x,y])=>x*s2+y*c2);
          return{t,ox:10,oy:t<0?-(clear+Math.max(...ys)):clear-Math.min(...ys),
            cx:rcx*c2-rcy*s2,cy:rcx*s2+rcy*c2}};
        const mk=c=>obb(px+k*(c.ox+c.cx),py+k*(c.oy+c.cy),c.t,k*b[2]/2,k*b[3]/2),
          sep=c=>{const L=lastL[c.t];return L?
            .707*((L.ax-(px+k*c.ox))+(c.t<0?1:-1)*(L.ay-(py+k*c.oy))):1e9},
          need=c=>{const L=lastL[c.t];return k*((b[3]+6+(L?L.h:0))/2+4)},
          ok=t=>{const d0=Math.abs(th[i]-t);return Math.min(d0,180-d0)>28},
          pref=th[i]<0?45:-45,alt=-pref,cp=cand(pref),ca=cand(alt);
        let c;
        if(ok(pref)&&sep(cp)>=need(cp)&&!hitAny(mk(cp)))c=cp;
        else if(ok(alt)&&sep(ca)>=need(ca)&&!hitAny(mk(ca)))c=ca;
        else{ // both sides crowded: staircase pre-lift each allowed tilt and
          // keep lifting until clear, plus a level label beside the dot as a
          // third candidate — costed by how far each ends from the station, so
          // a label never gets flung down a long crowded band when there is
          // room right next to its dot
          const lift=x=>{const o0=x.oy,dz=(need(x)-sep(x))/.707;
            if(dz>0)x.oy+=(x.t<0?-dz:dz)/k;
            let n=0;for(;n<80&&hitAny(mk(x));n++)x.oy+=x.t<0?-4:4;
            x.B=mk(x);return n<80?Math.abs(x.oy-o0):1e9};
          const cs=[];
          if(ok(pref))cs.push([lift(cp),cp]);
          if(ok(alt))cs.push([lift(ca),ca]);
          for(const an of["start","end"]){const bb=lbox(g,an),sx=an==="start"?1:-1,
              rx=[bb[0]-d.lx,bb[0]+bb[2]-d.lx],ry=[bb[1]-d.ly,bb[1]+bb[3]-d.ly],
              o0=sx*(clear+2)+(sx>0?-rx[0]:-rx[1]),
              lv={t:0,an,oy:0,ox:o0},
              mkL=()=>obb(px+k*(lv.ox+(rx[0]+rx[1])/2),py+k*(ry[0]+ry[1])/2,0,
                k*(rx[1]-rx[0])/2,k*(ry[1]-ry[0])/2);
            let n=0;for(;n<40&&hitAny(mkL());n++)lv.ox+=sx*4;
            lv.B=mkL();if(n<40)cs.push([Math.abs(lv.ox-o0)+8,lv])}
          c=cs.sort((p,q)=>p[0]-q[0])[0][1]}
        if(c.t)lastL[c.t]={ax:px+k*c.ox,ay:py+k*c.oy,h:b[3]+6};
        settle(c.B||mk(c));
        lay.set(st.zh,{m:"s",t:c.t,ox:c.ox,oy:c.oy,an:c.an})}}
    else for(const st of sts){const g=G(st.zh);if(!g)continue;
      // small rotation: labels keep their authored spots; a clash probes a fan
      // of directions (away from the station first) and slides to whichever
      // clear spot is nearest — one fixed direction can chain through a dense
      // cluster forever
      const[px,py]=rot(st),b=lbox(g,g.dataset.ta),
        rcx=b[0]+b[2]/2-st.x,rcy=b[1]+b[3]/2-st.y,L2=Math.hypot(rcx,rcy)||1,
        mk=(x,y)=>obb(px+k*(rcx+x),py+k*(rcy+y),0,k*b[2]/2,k*b[3]/2);
      let ox=0,oy=0,best=null;
      for(const[ux,uy]of[[rcx/L2,rcy/L2],[1,0],[-1,0],[0,-1],[0,1],
          [.707,-.707],[-.707,-.707],[.707,.707],[-.707,.707]]){
        let x=0,y=0,n=0;
        for(;n<30&&hitAny(mk(x,y));n++){x+=ux*4;y+=uy*4}
        if(n<30&&(!best||n<best[0]))best=[n,x,y];
        if(best&&best[0]===0)break}
      if(best){ox=best[1];oy=best[2]}
      settle(mk(ox,oy));
      lay.set(st.zh,{m:"u",ox,oy})}
    vb=[x0,y0,x1-x0,y1-y0]}
  return{vb,lay,k}}
// a line is fitted into the free rect (pad: CSS px of the UI over the map, the world's wPad) and that view grown to the whole box
function ovTarget(id,pad){const ov=$("ovMap"),W=ov.clientWidth||760,H=ov.clientHeight||580,p=pad||{},
    l=p.left||0,t=p.top||0,fw=Math.max(80,W-l-(p.right||0)),fh=Math.max(80,H-t-(p.bottom||0)),
    grow=v=>{const s=Math.min(fw/v[2],fh/v[3]),cx=v[0]+v[2]/2,cy=v[1]+v[3]/2;return[cx-(l+fw/2)/s,cy-(t+fh/2)/s,W/s,H/s]};
  let tgt=FULL_VB,ta=0,tc=ovC,LL=null,lay=null,tk=1;
  if(id){LL=LINES.find(l=>l.id===id);
    if(LL){const f=bestFit(LL,fw,fh);
      ta=f.a;tc=[f.cx,f.cy];
      const r=layoutLabels(ov,LL,ta,tc,f.vb,v=>grow(v)[2]);
      tgt=grow(r.vb);lay=r.lay;tk=r.k}}
  return{tgt,ta,tc,LL,lay,tk}}
function ovZoom(id,pad){if(ovLive())return; // (the SVG only: OVM is framed by wRefit)
  const ov=$("ovMap"),mr=ov.querySelector(".mrot"),nc=$("ncue");
  let{tgt,ta,tc,lay,tk}=ovTarget(id,pad);
  if(!tgt)return;
  ovClearFree(); // any focus change (or reset) supersedes a free pan/zoom
  cancelAnimationFrame(ovAnim);
  // hand layoutLabels' per-station placement to the focused labels; ovLabelXf
  // re-poses every label each frame (focused strip labels tilt, the rest stay
  // level and counter-scale), so text tracks the rotation and depth throughout
  const gs=[];
  if(lay)ov.querySelectorAll(".stg").forEach(g=>{const p=lay.get(g.dataset.st);if(!p)return;
    const lg=g.lastElementChild;lg.dataset.m=p.m;
    if(p.m==="s"){lg.dataset.t=p.t;lg.dataset.ox=p.ox.toFixed(1);lg.dataset.oy=p.oy.toFixed(1);
      lg.setAttribute("text-anchor",p.an||"start")}
    else{if(p.ox||p.oy){lg.dataset.ox=p.ox.toFixed(1);lg.dataset.oy=p.oy.toFixed(1)}
      else{delete lg.dataset.ox;delete lg.dataset.oy}
      lg.setAttribute("text-anchor",lg.dataset.ta)}
    gs.push(lg)});
  const old=ovGs.filter(g=>!gs.includes(g));ovGs=gs;
  const reset=g=>{delete g.dataset.m;delete g.dataset.ox;delete g.dataset.oy;
    g.setAttribute("text-anchor",g.dataset.ta)};
  const setVb=v=>ov.setAttribute("viewBox",v.map(n=>n.toFixed(1)).join(" "));
  const kOf=v=>FULL_VB?clamp(OV_BASEZ*v[2]/FULL_VB[2],.05,1):1;
  const setRot=(a,cx,cy,k)=>{
    if(Math.abs(a)<.05)mr.removeAttribute("transform");
    else mr.setAttribute("transform",`rotate(${a.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    if(nc){nc.style.opacity=Math.abs(a)<.05?"":"1";
      nc.firstElementChild.style.transform=`rotate(${a}deg)`}
    ovFurn(ov,k);ovLabelXf(ov,a,cx,cy,k)};
  const land=()=>{ovA=ta;ovC=tc;old.forEach(reset);
    ovLabelXf(ov,ta,tc?tc[0]:0,tc?tc[1]:0,tk)};
  const vb=ov.viewBox.baseVal,from=[vb.x,vb.y,vb.width,vb.height];
  if(!tc)tc=[0,0];
  if(REDUCED()||!from[2]){setVb(tgt);setRot(ta,tc[0],tc[1],tk);land();return}
  const c0=Math.abs(ovA)<.05?tc:(ovC||tc), // start centre = current, unless untransformed
    f7=[...from,ovA,c0[0],c0[1]],t7=[...tgt,ta,tc[0],tc[1]];
  const t0=performance.now();
  const step=now=>{const p=clamp((now-t0)/420,0,1),e=1-Math.pow(1-p,3), // rAF stamps can predate t0
    v=f7.map((f,i)=>f+(t7[i]-f)*e);
    setVb(v.slice(0,4));setRot(v[4],v[5],v[6],kOf(v));
    if(p<1)ovAnim=requestAnimationFrame(step);else land()};
  ovAnim=requestAnimationFrame(step)}
// pixel ride: the open card's first frame (its direction) — P0 tiles only, never on saveData; another line / closing drops the
// rest. 400 ms after it opens / swaps / reverses (planning the frame costs 10–55 ms of main thread; a line skimmed past costs nothing)
let pxPreT=0;
function pxPre(){clearTimeout(pxPreT);if(typeof RIDE!=="undefined")RIDE.prefetch(null);
  const id=expandedLine(),c=navigator.connection;if(!id||!pxOn()||(c&&c.saveData))return;
  pxPreT=setTimeout(()=>pxLoad().then(()=>{if(expandedLine()!==id||S.screen!=="menu")return;
    RIDE.set({scale:PX_SCALE,kb:false,...pxChips()});return RIDE.prefetch(LINES.find(l=>l.id===id),!!dirState[id],pxSize())}).catch(()=>{}),400)}

/* ---------- the world map (v0.7.0: the level select, mockups/pixel-world/SPEC.md; replaced layout B) ----------
   #pick is one full-screen game screen over the living OVM map (block above): the progress plate (★ n/19 + a lamp per line), the chips
   (#fchips: leaderboard · settings · account · about), the banner + key hint, the dock (19 medallions + the gauntlet plate, stars under
   them, the cursor on the picked one), the stub (the picked ticket folded: the one action) or the level card (a ticket: a side panel or
   a bottom sheet by the Auto rule, wPlace). State: one picked id wSel (a line id or "boss", always set), wOpen (the card shows), wMapOn
   (the map frames wSel; false = the whole network); hover (wHov: a node, the stub, a line on the map) never picks. START runs
   startLine / startBoss inside the tap / key (its inp.focus() raises the phone keyboard), then #goFx dithers in the line colour over
   the ride's preparation (it takes over #pxVeil's job until the ride is ready; Classic / boss: a short form). Stars: bests[key].stars
   (session-only) merged with cloud.js cloudStars() (a Promise of {mode: n}); worldProgress() repaints them (cloud.js, each result).
   Keys (window, capture) only while the world shows (wOn), no dialog is open and no field has focus. Blips: square waves on the
   game's AudioContext once a gesture made it run, never with Sound off. The SVG map stands in for OVM (picks then come from the dock). */
const WIDS=[...LINES.map(L=>L.id),"boss"],LBY=new Map(LINES.map(L=>[L.id,L])),W_DIFF=["diffEasy","diffMedium","diffHard","diffImp"];
[...LINES].sort((a,b)=>a.diff-b.diff).forEach((L,i)=>{L.lvl=1+Math.floor(i*4/LINES.length)}); // difficulty 1–4: the quartile of L.diff (boss 4)
let wSel=null,wOpen=false,wMapOn=false,wHov=null,wHovSrc=null,wTouched=false,wFontsOk=false,wLast="",wSvgK="",wSwiped=false,wSwT=0,wRsT=0,
  wBlipT=0,wMC=null,wBossBB,goRun=0,goT=0,goHold=false;
const wOn=()=>S.screen==="menu"&&$("menu").classList.contains("pk"); // the world screen shows (the hero folded): keys
// (#pick is laid out on the menu anyway — below the hero until then — so layout and the map's framing run whenever S.screen is "menu")
const wNar=()=>innerWidth<=560,wU=()=>pxKof(pxMS()); // a phone · 1 art px in CSS px
// the safe-area insets, CSS px (css #pick --sit/--sir/--sib/--sil: registered lengths on whole art px; 0 without @property)
const wSafe=()=>{const s=getComputedStyle($("pick")),v=k=>parseFloat(s.getPropertyValue(k))||0;return{t:v("--sit"),r:v("--sir"),b:v("--sib"),l:v("--sil")}};
// the card's placement (Auto): phones a bottom sheet; else the side panel when landscape or under 380 art px tall, else a sheet
const wPlace=()=>wNar()?"bottom":innerHeight/wU()<380||innerWidth>innerHeight*1.15?"side":"bottom";
const wFocus=()=>wMapOn&&wSel!=="boss"?wSel:null; // the line the map frames
const expandedLine=()=>wOpen&&wSel!=="boss"?wSel:null; // the open card's line (pxPre)
let wCS={};const wCloud=()=>wCS; // the signed-in player's stars per mode: cloud.js cloudStars() (a Promise), kept once it resolves
function wStars(id,c=wCloud()){const b=bests[id],v=c[id],n=v&&typeof v==="object"?v.stars:v;return Math.min(3,Math.max(b&&b.stars||0,+n||0)|0)}
function wBest(id,c=wCloud()){const b=bests[id],v=c[id];return Math.max(b?b.score:0,v&&typeof v==="object"?+(v.score||v.best)||0:0)}
const wHome=()=>{const c=wCloud(),all=LINES.every(L=>wStars(L.id,c));return(LINES.find(L=>all?wStars(L.id,c)<3:!wStars(L.id,c))||LINES[0]).id};
const ICON=n=>`<svg class="pki" aria-hidden="true"><use href="#${/^p[wk]-/.test(n)?n:"pki-"+n}"/></svg>`; // index.html's sprite: pki-<n>, pw-*, pk-*
const wEsc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const wMedal=(id,n)=>{const w=n.length>2;return`<span class="pw-rd${w?" w":""}" data-lc="${id}" aria-hidden="true"><svg viewBox="0 0 ${w?33:23} 23"><use href="#pw-rd${w?"w":""}"/></svg><b${n.length>1?' class="n12"':""}>${wEsc(n)}</b></span>`};
const wStarsSvg=(n,w,h,k)=>[0,1,2].map(i=>`<svg viewBox="0 0 ${w} ${h}"${i<n?"":' class="e"'} aria-hidden="true"><use href="#${k}${i<n?"":"e"}"/></svg>`).join("");
const W_PLAY='<svg viewBox="0 0 7 11" aria-hidden="true"><use href="#pw-play"/></svg>';
const wNum=id=>id==="boss"?"★":LBY.get(id).num,wName=id=>id==="boss"?t("wBossName"):t("lineName",LBY.get(id));
const wSub=id=>id==="boss"?(LANG==="zh"?"LONG-NAME GAUNTLET":"长站名挑战"):LANG==="zh"?LBY.get(id).en.toUpperCase():LBY.get(id).zh; // (the other language)
const wEnds=id=>{if(id==="boss")return[BOSS[BOSS.length-1].zh,BOSS[0].zh];const s=LBY.get(id).stations,a=s[0].zh,b=s[s.length-1].zh;return dirState[id]?[b,a]:[a,b]};
const wNode=id=>{const p=$("path");return p&&p.querySelector(`.pw-node[data-id="${id}"]`)};
const W_CUR=document.createElement("span");W_CUR.className="pw-cur";W_CUR.setAttribute("aria-hidden","true");
W_CUR.innerHTML='<i><svg viewBox="0 0 8 8"><use href="#pw-cor"/></svg></i>'.repeat(4);

/* text on whole art px: pixel-font advances (a canvas, 1 font px = 1 art px, after FONTS.ready) and the fact's 2-line clamp (whole
   words by Intl.Segmenter, else a hanzi / a space-separated word; then back to a clause end keeping ≥ 40 %) */
function wFontsOn(){if(wFontsOk||typeof FONTS==="undefined"||!FONTS.ready)return;
  FONTS.ready.then(()=>{if(wFontsOk)return;wFontsOk=true;for(const id of["path","stub","hudTitle"])wFitMedals($(id));wFitCard();wBanner();wRefit(true)},()=>{})}
const wCtx=()=>wMC||(wMC=PX_CANVAS?document.createElement("canvas").getContext("2d"):wDomM()); // (no 2D canvas: the same fonts measured in a hidden span)
function wDomM(){const e=document.createElement("span");e.setAttribute("aria-hidden","true");
  e.style.cssText="position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;letter-spacing:0;font-kerning:none";document.body.appendChild(e);
  return{font:"",measureText(t){e.style.font=this.font;e.textContent=t;return{width:e.getBoundingClientRect().width}}}}
const wAdv=(s,f)=>{const g=wCtx();if(!g)return 0;g.font=f;return Math.round(g.measureText(s).width)};
function wFitMedals(root){if(!wFontsOk||!root||!wCtx())return; // numerals centred: --nx = floor((w − advance + 1) / 2)
  for(const b of root.querySelectorAll(".pw-rd>b")){const w=b.parentNode.classList.contains("w")?33:23,a=wAdv(b.textContent,b.classList.contains("n12")?"12px FP12":"16px FP16");
    b.style.setProperty("--nx",`calc(${Math.floor((w-a+1)/2)}*var(--pxu))`)}}
const W_SEG={};
const wWords=s=>{const L=LANG==="zh"?"zh":"en";try{if(Intl.Segmenter){const g=W_SEG[L]||(W_SEG[L]=new Intl.Segmenter(L,{granularity:"word"}));return[...g.segment(s)].map(x=>x.segment)}}catch(e){}
  return s.match(/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]|[^\s\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]+\s*|\s+/g)||[]};
function wClamp(txt,font,w,max){const g=wCtx();if(!wFontsOk||!g||w<=0)return txt;
  g.font=font;const M=s=>g.measureText(s).width,lines=[[]];let cut=false;
  for(const k of wWords(txt)){const L=lines[lines.length-1];
    if(!L.length||M((L.join("")+k).trimEnd())<=w){L.push(k);continue}
    if(lines.length===max){cut=true;break}
    lines.push(k.trim()?[k]:[])}
  if(!cut)return txt;
  const last=lines[lines.length-1];while(last.length>1&&M(last.join("").trimEnd()+"…")>w)last.pop();
  const out=lines.map(l=>l.join("")).join("").trimEnd();let p=-1,full=false;
  for(const m of out.matchAll(/[，。；、：—]|[,.;:](?=\s)/g))if(m.index>=out.length*.4){p=m.index;full=m[0]==="。"||m[0]==="."}
  if(p>=0)return full?out.slice(0,p+1):out.slice(0,p).replace(/[\s—]+$/,"")+"…";
  return out.replace(/[\s，、。；：（(—,.;:-]+$/,"")+"…"}

/* the screen's parts (markup: SPEC §4) */
function wTop(){const p=$("prog");if(!p)return;const c=wCloud(),n=LINES.filter(L=>wStars(L.id,c)).length,N=LINES.length,all=n===N,lb=t(all?"wAllClear":"wCleared");
  p.className="pk-panel pw-prog"+(all?" all":"");p.setAttribute("role","img");p.setAttribute("aria-label",`★ ${n}/${N} ${lb}`);
  p.innerHTML=`${ICON(all?"crown":"star")}<b class="f12">${n}/${N}</b><span class="lbl f10">${wEsc(lb)}</span>`+
    `<span class="pk-inset pw-meter" aria-hidden="true">${LINES.map(L=>`<i data-lc="${L.id}"${wStars(L.id,c)?' class="on"':""}></i>`).join("")}</span>`;
  const b=$("lbBtn"),a=$("aboutBtn");if(b)b.setAttribute("aria-label",t("lbTitle"));
  if(a){a.setAttribute("aria-label",t("about"));a.title=t("about")+" · v"+APP_VERSION}}
function wPath(){const p=$("path");if(!p)return;const c=wCloud(),e=wEsc,st=id=>`<span class="pw-st">${wStarsSvg(wStars(id,c),7,6,"pw-s7")}</span>`;
  p.setAttribute("aria-label",t("wPathAria"));
  p.innerHTML=LINES.map(L=>`<button class="pw-node${L.num.length>2?" wide":""}" type="button" data-id="${L.id}" tabindex="-1" aria-label="${e(t("lineName",L))} · ${e(t("wStarsAria",wStars(L.id,c)))}">${wMedal(L.id,L.num)}${st(L.id)}</button>`).join("")+
    `<button class="pw-node boss" type="button" data-id="boss" tabindex="-1" aria-label="${e(t("wBossName"))} · ${e(t("wStarsAria",wStars("boss",c)))}"><span class="pw-boss" data-lc="boss">${ICON("crown")}<span>${e(t("wBossPlate"))}</span></span>${st("boss")}</button>`;
  wFitMedals(p);wPaintSel()}
// the picked node: .sel, the only tab stop (roving), aria-current, the cursor's corners; a line hovered on the map marks its node .hov
function wPaintSel(){const p=$("path");if(!p)return;
  for(const b of p.children){const on=b.dataset.id===wSel;b.classList.toggle("sel",on);b.classList.toggle("hov",b.dataset.id===wHov&&wHovSrc==="map");
    b.tabIndex=on?0:-1;on?b.setAttribute("aria-current","true"):b.removeAttribute("aria-current")}
  const n=wNode(wSel);if(n&&W_CUR.parentNode!==n)n.appendChild(W_CUR)}
function wCardHTML(id){const boss=id==="boss",L=boss?null:LBY.get(id),c=wCloud(),st=wStars(id,c),best=wBest(id,c),lvl=boss?4:L.lvl,lw=t(W_DIFF[lvl-1]),
    fact=boss?t("bossFact"):descOf(L),e=wEsc,go=t(boss?"challenge":"go");
  return`<div class="pw-head">${wMedal(id,wNum(id))}<h2 class="pw-name" id="cardH"><span class="f16">${e(wName(id))}</span><span class="f10">${e(wSub(id))}</span></h2>`+
    `<button class="pk-chip pk-ico pw-x" type="button" data-act="close" aria-label="${e(t("accClose"))}" title="${e(t("accClose"))} (Esc)">${ICON("close")}</button></div>`+
    `<div class="pw-perf" aria-hidden="true"></div><div class="pw-body"><div class="pw-route"><span class="pw-tt f12">${e(wEnds(id).join(" → "))}</span>`+
    (boss?"":`<button class="pk-btn pw-rev" type="button" data-act="rev" aria-pressed="${!!dirState[id]}" title="${e(t("revTitle"))}" aria-label="${e(t("revTitle"))}">⇄<span> ${e(t("revBtn"))}</span></button>`)+"</div>"+
    `<div class="pw-meta"><span class="pw-s15" role="img" aria-label="${e(t("wStarsAria",st))}">${wStarsSvg(st,15,14,"pw-s15")}</span>`+
    (best?`<span class="pw-best f12" aria-label="${e(t("wBest",best))}">${ICON("crown")}<span class="long">${e(t("wBestW"))}</span><span>${best}</span><span>${e(t("wBestU"))}</span></span>`
      :`<span class="pw-best none f10">${e(t("wNoBest"))}</span>`)+"</div>"+
    `<div class="pw-info"><span class="pw-diff d${lvl}" role="img" aria-label="${e(t("wDiffAria",lvl))} · ${e(lw)}"><span class="f10">${e(lw)}</span>`+
      `<span class="pw-pips">${[1,2,3,4].map(i=>`<i${i<=lvl?' class="on"':""}></i>`).join("")}</span></span>`+
      `<span class="pw-stops f10">${ICON("stn")}${boss?`<span>${e(t("bossCount",BOSS.length))}</span><span>♥×3</span>`
        :`<span>${e(t("stops",L.stations.length))}</span><span class="km">${ICON("line")}<span>~${Math.round(L.km)} km</span></span>`}</span></div>`+
    `<p class="pw-fact ${LANG==="zh"?"f12":"f10"}" data-full="${e(fact)}">${e(fact)}</p>`+
    `<button class="pk-btn pri pw-gobtn" type="button" data-act="go"><span>${e(go)}</span>${W_PLAY}</button></div>`}
// fx: "wipe" (the card opens: it rises under a --lc dither) · "swap" (another line while open: the dither only); focus stays on its control
function wCard(fx){const c=$("card");if(!c)return;const a=document.activeElement,act=a&&c.contains(a)?a.dataset.act||"go":null;
  c.dataset.lc=wSel;c.innerHTML=wCardHTML(wSel);c.hidden=false;wFitCard();
  if(fx&&!REDUCED()){c.classList.remove("wipe","swap");void c.offsetWidth;c.classList.add(fx)}
  if(act){const f=c.querySelector(`[data-act="${act}"]`)||c.querySelector("[data-act=go]");if(f)f.focus({preventScroll:true})}}
function wFitCard(){const c=$("card");if(!c||c.hidden)return;const u=wU();wFitMedals(c);
  const p=c.querySelector(".pw-fact");if(p&&!wNar()){const f12=p.classList.contains("f12");
    p.textContent=wClamp(p.dataset.full,f12?"12px FP12":"10px FP10",Math.floor(p.clientWidth/u)-(f12?12:4),2)}
  const g=c.querySelector(".pw-gobtn");if(g&&wFontsOk&&wCtx()){const bw=Math.round(g.getBoundingClientRect().width/u)-2,cw=wAdv(g.firstChild.textContent,"16px FP16")+13;
    g.style.setProperty("--gpl",`calc(${Math.max(4,Math.floor((bw-cw)/2))}*var(--pxu))`)}}
function wStub(){const b=$("stub");if(!b)return;const id=wSel,[a,z]=wEnds(id),go=t(id==="boss"?"challenge":"go"),e=wEsc;
  b.dataset.lc=id;b.hidden=wOpen;b.setAttribute("aria-label",`${go} · ${wName(id)} · ${a} → ${z}`);
  b.innerHTML=`<span class="pw-sl">${wMedal(id,wNum(id))}</span><span class="pw-sm"><b class="f12">${e(wName(id))}</b><i class="f10">${e(a)} →<span class="to"> ${e(z)}</span></i></span>`+
    `<span class="pw-sg"><span>${e(go)}</span>${W_PLAY}</span>`;wFitMedals(b)}
// the banner: the hovered line, else the picked one (no card, the map on it), else the screen title; then the layout
function wBanner(){const b=$("hudTitle");if(!b)return;const id=wHov||(!wOpen&&wMapOn?wSel:null),k=(id||"")+LANG+wFontsOk;
  if(b.dataset.k!==k){b.dataset.k=k;b.innerHTML=id?wMedal(id,wNum(id))+`<span class="f16">${wEsc(wName(id))}</span><span class="f10">${wEsc(wSub(id))}</span>`
    :`<span class="f16">${wEsc(t("wTitle"))}</span>`;if(id)wFitMedals(b)}
  wLayout()}
// the banner + key hint centred on whole art px between the plate and the chips (and a side card), hidden where they do not fit and on
// phones; the path centred in the dock when it fits (else it scrolls); the stub centred
function wLayout(){if(S.screen!=="menu"||!$("prog")||!$("path"))return;const u=wU(),W=innerWidth,nar=wNar(),c=$("card"),b=$("hudTitle"),k=$("keys"),p=$("path"),s=$("strip"),st=$("stub"),
    lo=$("prog").getBoundingClientRect().right+8*u;let hi=$("fchips").getBoundingClientRect().left-8*u;
  if(wOpen&&c&&!c.hidden&&wPlace()==="side")hi=Math.min(hi,c.getBoundingClientRect().left-8*u);
  if(k)k.textContent=IS_TOUCH?t("wKeysTouch"):t(wOpen?wSel==="boss"?"wKeysBoss":"wKeysOpen":"wKeys");
  for(const el of[b,k])if(el){el.hidden=false;const w=el.getBoundingClientRect().width;let x=(W-w)/2;if(x<lo)x=lo;if(x+w>hi)x=hi-w;
    el.hidden=nar||x<lo-.5||w>hi-lo;el.style.left=Math.floor(x/u)*u+"px"}
  if(k&&b)k.style.top=`calc(var(--gut) + var(--sit) + ${b.querySelector(".pw-rd")?30:20}*var(--pxu))`;
  if(!nar&&s){p.style.marginLeft="0px";const pw=p.getBoundingClientRect().width,sw=s.getBoundingClientRect().width;p.style.marginLeft=pw<sw?Math.floor((sw-pw)/2/u)*u+"px":"0px"}
  else p.style.marginLeft="";
  if(st)st.style.left=!st.hidden&&!nar?Math.max(0,Math.floor((W-st.getBoundingClientRect().width)/2/u)*u)+"px":""}
function wPlaceCls(){const p=$("pick"),v=wPlace();document.documentElement.classList.toggle("nar",wNar());
  if(p){p.classList.toggle("pl-side",v==="side");p.classList.toggle("pl-bottom",v!=="side")}}
function wAbout(){const v=$("aboutVer");if(v)v.textContent="v"+APP_VERSION;pxDlg($("aboutDlg"))} // (its text: data-i18n, setLang)
// everything (boot, a language change, back from a run); worldProgress: only what the stars change
function renderWorld(){const h=$("ovHost");if(h)h.setAttribute("aria-label",t("wMapAria"));if(!wSel)wSel=wHome();
  wTop();wPath();const c=$("card");if(c){if(wOpen)wCard();else c.hidden=true}
  wStub();wAbout();wCursor();wBanner();if(S.screen==="menu")requestAnimationFrame(()=>{wLayout();wScrollTo(wSel);wRefit(true)})}
function worldProgress(){wPaintProg();
  if(typeof cloudStars==="function")try{Promise.resolve(cloudStars()).then(o=>{o={...o||{}};if(JSON.stringify(o)!==JSON.stringify(wCS)){wCS=o;wPaintProg()}},()=>{})}catch(e){}}
function wPaintProg(){wTop();wPath();if(wOpen)wCard();else wStub();if(ovM()&&typeof OVM.progress==="function")ovTry(()=>OVM.progress(wProg()));wLayout()}
// the world shows (the hero folded, back from a run): the placement, the map mounted, laid out on the next frame; focus: the picked node
function wEnter(focus){wChips(true);wPlaceCls();ovSync();wStub();wBanner();
  requestAnimationFrame(()=>{if(S.screen!=="menu")return;wLayout();wFitCard();wScrollTo(wSel);wBanner();wRefit(true)});
  if(focus){const n=wNode(wSel);if(n)n.focus({preventScroll:true})}}
// #fchips (outside #menu: the ride needs it) joins the world screen right after the map while it shows, so Tab runs map → chips →
// card → stub → the picked node (SPEC §3); show() puts it back for a run / the results (fixed either way; focus kept)
function wChips(on){const f=$("fchips"),h=$("ovHost"),m=$("menu"),a=document.activeElement;if(!f||!h||!m)return;
  if(on?f.previousElementSibling===h:f.nextElementSibling===m)return;
  if(on)h.after(f);else m.before(f);if(a&&f.contains(a)&&document.activeElement!==a)a.focus({preventScroll:true})}
function wResize(){wPlaceCls();if(S.screen!=="menu")return;wFitCard();wBanner();wScrollTo(wSel);wRefit()}
function wTouch(){if(wTouched)return;wTouched=true;document.documentElement.classList.remove("idle")} // (the hint blinks until then)

/* selection: pick (the cursor jumps, the map frames it; o.open opens the card, an open card swaps to it) · open · close · home */
function wOpenCard(o={}){if(!wOpen){wOpen=true;wCard("wipe");blip("open")}else wCard();
  const s=$("stub");if(s)s.hidden=true;wMapOn=true;wBanner();wRefit();pxPre();
  if(o.focus!==false){const g=$("card").querySelector("[data-act=go]");if(g)g.focus({preventScroll:true})}}
function wCloseCard(o={}){if(!wOpen)return;wOpen=false;const c=$("card");c.hidden=true;c.classList.remove("wipe","swap");blip("close");
  wStub();wBanner();wRefit();pxPre();if(o.focus!==false){const n=wNode(wSel);if(n)n.focus({preventScroll:true})}}
function wRest(){wMapOn=false;wBanner();wRefit();blip("close")}
function wSelect(id,o={}){if(!WIDS.includes(id))return;wTouch();
  const moved=id!==wSel,opening=o.open&&!wOpen,a=document.activeElement;wSel=id;wPaintSel();wScrollTo(id);
  if(opening)wOpenCard({focus:o.focusCard});
  else if(wOpen){if(moved)wCard("swap");wMapOn=true;wBanner();wRefit();pxPre()}
  else{wStub();wMapOn=true;wBanner();wRefit()}
  wCursor();
  if(o.focusNode||(a&&a.classList&&a.classList.contains("pw-node"))){const n=wNode(id);if(n)n.focus({preventScroll:true})}
  if(moved&&!opening)blip("move")} // (wOpenCard blips "open")
function wRev(){if(wSel==="boss")return;wTouch();dirState[wSel]=!dirState[wSel];if(wOpen)wCard();else wStub();wCursor();wLayout();blip("rev");pxPre()}
function wStep(d){const c=$("card");wSelect(WIDS[(WIDS.indexOf(wSel)+d+WIDS.length)%WIDS.length],{focusNode:!(c&&c.contains(document.activeElement))})}
function wHover(id,src){if(id===wHov)return;wHov=id;wHovSrc=id?src:null;wPaintSel();
  if(src!=="map")ovHighlight(id);else{const h=$("ovHost");if(h)h.style.cursor=id?"pointer":""}
  if(id)blip("hover");wBanner()}
// the map: a line picks + opens at once; the START sign / ring starts its open card (else opens it); blank closes the card, then goes home
function wMapPick(id,h){if(S.screen!=="menu")return;wTouch();
  if(h&&h.cursor){if(wOpen&&id===wSel){wStart();wKeepFocus()}else wSelect(id,{open:true});return}
  if(id)wSelect(id,{open:true});else if(wOpen)wCloseCard({focus:false});else if(wMapOn)wRest()}
// a START from the map fires in OVM's pointerup: a tap's compatibility mousedown follows it and would blur #pyin (the phone keyboard
// just raised) — its default is kept off for that one mousedown (a mouse's came before the pointerup: the guard just expires)
function wKeepFocus(){const md=e=>{e.preventDefault();off()},off=()=>{clearTimeout(tm);removeEventListener("mousedown",md,true)},tm=setTimeout(off,800);
  addEventListener("mousedown",md,true)}
// the dock scrolls to centre a node (whole art px); a touch swipe then picks the node it settles on (never a programmatic scroll)
function wScrollTo(id){wSwiped=false;const n=wNode(id),s=$("strip");if(!n||!s||s.scrollWidth<=s.clientWidth+1)return;
  const u=wU(),r=n.getBoundingClientRect(),q=s.getBoundingClientRect(),dx=r.left+r.width/2-(q.left+q.width/2);
  if(Math.abs(dx)>1)s.scrollTo({left:Math.round((s.scrollLeft+dx)/u)*u,behavior:REDUCED()?"auto":"smooth"})}
function wSwipeEnd(){if(!wSwiped||S.screen!=="menu")return;wSwiped=false;const s=$("strip").getBoundingClientRect(),cx=s.left+s.width/2;let best=null,bd=1e9;
  for(const b of $("path").children){const r=b.getBoundingClientRect(),d=Math.abs(r.left+r.width/2-cx);if(d<bd){bd=d;best=b}}
  if(best&&best.dataset.id!==wSel)wSelect(best.dataset.id)}

/* the map's framing + life. Pads (CSS px of the canvas) keep the UI clear: the top bar / banner / hint and the stub; a side card on the
   right, a bottom sheet below (+ pad.attr: the attribution in the canvas's own corner when the sheet leaves room); the safe-area side
   insets always (the top one at home: wSafe); home = the whole
   network as large as it fits, between the top bar and the stub when that costs no step. The gauntlet frames + marks its stations */
function wRestFit(pad){const st=OVM.stats(),f=(devicePixelRatio||1)/st.K,n=MAPOV.net,w=st.W-Math.round(pad.left*f)-Math.round(pad.right*f),h=st.H-Math.round(pad.top*f)-Math.round(pad.bottom*f);
  for(const s of[...OVM.STEPS].reverse())if((n[2]-n[0])/s+12<=w&&(n[3]-n[1])/s+12<=h)return s;return OVM.STEPS[0]}
function wPad(){const u=wU(),h=$(ovLive()?"ovHost":"ovMap").getBoundingClientRect(),st=$("stub"),c=$("card"), // (the SVG: inside the insets, the host may be hidden)
    s=wSafe(),sl=Math.max(0,s.l-h.left),sr=Math.max(0,h.right-innerWidth+s.r),// (the safe-area bands over this box: the canvas is full-bleed)
    hud=[document.querySelector(".pw-top"),$("fchips"),$("hudTitle"),$("keys")].filter(e=>e&&!e.hidden).map(e=>e.getBoundingClientRect().bottom),
    sb=!st||st.hidden?0:Math.max(0,h.bottom-st.getBoundingClientRect().top)+4*u,pad={top:Math.max(0,Math.max(0,...hud)-h.top)+4*u,right:sr,bottom:Math.max(4*u,sb),left:sl};
  if(!wMapOn){const r={top:Math.max(0,s.t-h.top),right:sr,bottom:2*u,left:sl};
    if(ovM()&&typeof MAPOV!=="undefined"){const s0=wRestFit(r),b=Math.max(r.bottom,sb);for(const r2 of[{...r,top:pad.top,bottom:b},{...r,bottom:b}])if(wRestFit(r2)===s0)return r2}
    return r}
  if(wOpen&&c&&!c.hidden){const q=c.getBoundingClientRect();
    if(wPlace()==="side")pad.right=Math.max(0,h.right-q.left)+6*u;
    else{pad.bottom=Math.max(0,h.bottom-q.top)+6*u;
      if(q.left-h.left-sl>=(wFontsOk&&typeof PX!=="undefined"?PX.measure("© OpenStreetMap contributors","fp8")+10:170)*u)pad.attr={left:sl,bottom:2*u}}}
  return pad}
function wBossBox(){if(wBossBB!==undefined)return wBossBB;if(typeof MAPOV==="undefined")return null;const pts=[];
  for(const s of BOSS)for(const L of LINES){const i=L.stations.findIndex(q=>q.zh===s.zh),M=MAPOV.lines[L.id];if(i>=0&&M&&M.st[i]!=null){pts.push(M.pts[M.st[i]]);break}}
  return wBossBB=pts.length?pts.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[1e9,1e9,-1e9,-1e9]):null}
// the finest step fitting a bbox (metres) × mult + px art px into the free rect (never coarser than rest), centred in it (an OVM.go view)
function wViewFor(b,pad,mult,px){const st=OVM.stats(),u=st.K/(devicePixelRatio||1),P={t:Math.round(pad.top/u),r:Math.round(pad.right/u),b:Math.round(pad.bottom/u),l:Math.round(pad.left/u)};
  let s=OVM.STEPS[0];for(const x of[...OVM.STEPS].reverse())if((b[2]-b[0])*mult/x+px<=st.W-P.l-P.r&&(b[3]-b[1])*mult/x+px<=st.H-P.t-P.b){s=x;break}
  s=Math.min(s,st.rest);return{m:s,x:(b[0]+b[2])/2-Math.round((P.l-P.r)/2)*s,y:(b[1]+b[3])/2+Math.round((P.t-P.b)/2)*s}}
function wRefit(force){const id=wFocus(),boss=wMapOn&&wSel==="boss";
  if(!ovLive()){const p=id&&S.screen==="menu"?wPad():null,k="svg"+id+(p?JSON.stringify(p)+innerWidth+"x"+innerHeight:""); // (the SVG shows)
    if(k!==wSvgK){wSvgK=k;ovZoom(id,p);ovLabels(id);ovHighlight(wHovSrc&&wHovSrc!=="map"?wHov:null)}}
  if(!ovM()||S.screen!=="menu")return;
  const pad=wPad(),st=OVM.stats(),key=(boss?"boss":id)+JSON.stringify(pad)+st.W+"x"+st.H;
  if(typeof OVM.marks==="function")ovTry(()=>OVM.marks(boss?BOSS.map(s=>s.zh):null));
  if(!force&&key===wLast)return;wLast=key;const an=!REDUCED();
  ovTry(()=>{OVM.focus(id,{animate:an,pad});const b=boss&&wBossBox();if(b)OVM.go(wViewFor(b,pad,1,16),{animate:an,dur:420})})}
function wProg(){const c=wCloud(),o={};for(const L of LINES){const s=wStars(L.id,c);if(s)o[L.id]=s}return Object.keys(o).length?o:null}
function wCursor(){if(ovM()&&typeof OVM.cursor==="function")ovTry(()=>OVM.cursor(wSel==="boss"?null:wSel,{rev:!!dirState[wSel],label:t("wStart")}))}
function wLife(){if(!ovM())return;ovTry(()=>{if(typeof OVM.trains==="function")OVM.trains("lively");if(typeof OVM.progress==="function")OVM.progress(wProg())});wCursor()}

/* blips: square waves (3 ms attack, 6 ms release, notes in sequence), only while the AudioContext runs (a capture-phase pointerdown /
   keydown on the menu creates / resumes it, never a hover), never with Sound off; a hover ≥ 70 ms after the last blip */
const W_SEQ={hover:[[1568,.018,.018]],move:[[1175,.03]],open:[[784,.04],[1175,.06]],close:[[988,.04],[659,.06]],rev:[[740,.03],[988,.04]],
  start:[[523,.07],[659,.07],[784,.07],[1047,.18]],dlg:[[1047,.03],[1319,.05]]};
function blip(k){if(muted||!AC||AC.state!=="running"||!W_SEQ[k])return;const n=performance.now();if(k==="hover"&&n-wBlipT<70)return;wBlipT=n;
  try{let at=AC.currentTime+.005;
    for(const[f,d,v=.045]of W_SEQ[k]){const o=AC.createOscillator(),g=AC.createGain();o.type="square";o.frequency.setValueAtTime(f,at);
      g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(v,at+.003);g.gain.setValueAtTime(v,at+d-.006);g.gain.linearRampToValueAtTime(0,at+d);
      o.connect(g);g.connect(AC.destination);o.start(at);o.stop(at+d+.01);at+=d}}catch(e){}}

/* START: startLine / startBoss at once (inside the tap / key: the phone keyboard), then #goFx (outside #menu, pointer-events none) over
   the game screen. A pixel ride: .in (the dither in, then held solid with the message and the veil's bar #goBar) until the ride is ready
   (pxVeil(-1): S.pxWait false, or the Classic fallback) and at least ~1.07 s (the mockup's 82 % mark), then .out (the dither out);
   #pxVeil stays hidden meanwhile. Classic / boss: .short (in and out, no message, 0.4 s). Reduced motion: pixel = a solid cut held
   the same way (≥ 0.9 s), cut out; Classic / boss none */
function wStart(){wTouch();blip("start");const id=wSel;if(id==="boss")startBoss();else startLine(LBY.get(id),!!dirState[id]);wGo(id)}
function wGo(id){const fx=$("goFx"),m=$("goMsg");if(!fx||!m||S.screen!=="game")return;const px=S.px,rm=REDUCED();
  if(!px&&rm)return;
  const run=++goRun;clearTimeout(goT);goT=0;goHold=px;fx.dataset.lc=id;fx.classList.remove("run","in","out","short");m.innerHTML="";fx.hidden=false;
  if(!px){void fx.offsetWidth;fx.classList.add("short");goT=setTimeout(()=>wGoEnd(run),420);return}
  m.innerHTML=wMedal(id,wNum(id))+`<span><b class="f16">${wEsc(t("wStarting",wName(id)))}</b><i class="f12">${wEsc(wEnds(id).join(" → "))}</i></span>`;
  $("pxVeil").hidden=true;const b=$("goBar");if(b)b.style.setProperty("--pxn",0);wFitMedals(m);
  const u=parseFloat(getComputedStyle(fx).getPropertyValue("--pxk"))||wU(); // (body.px: the ride's art px)
  fx.style.setProperty("--gx",Math.floor((innerWidth-m.offsetWidth)/2/u)*u+"px");fx.style.setProperty("--gy",Math.floor((innerHeight-m.offsetHeight)/2/u)*u+"px");
  void fx.offsetWidth;fx.classList.add("in");
  goT=setTimeout(()=>{goT=0;if(!goHold)wGoOut(run)},rm?900:1070)}
function wGoReady(){if(!goHold)return;goHold=false;if(!goT)wGoOut(goRun)} // (the minimum hold still running: its timer goes out)
function wGoOut(run){const fx=$("goFx");if(run!==goRun||!fx||fx.hidden)return;fx.classList.remove("in");
  if(REDUCED())return wGoEnd(run);fx.classList.add("out");goT=setTimeout(()=>wGoEnd(run),260)}
function wGoEnd(run){if(run!=null&&run!==goRun)return;clearTimeout(goT);goT=0;goHold=false;const fx=$("goFx");
  if(fx&&!fx.hidden){fx.hidden=true;fx.classList.remove("run","in","out","short")}}

/* dialogs: the leaderboard (cloud.js fills #lbTabs / #lbBody: cloudLbOpen(mode) loads the picked mode then) · About (index.html) */
function wDlg(id){const d=$(id);if(!d)return;wTouch();
  if(id==="lbDlg"&&typeof cloudLbOpen==="function")try{cloudLbOpen(wSel)}catch(e){console.warn(e)}
  if(id==="aboutDlg")wAbout();
  if(!d.open)d.showModal();pxDlg(d);blip("dlg");
  const f=d.querySelector("[autofocus]")||d.querySelector('[aria-selected="true"]')||d.querySelector("button");if(f)f.focus()}

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
  if(S.screen==="game"&&S.t0&&!S.done&&!S.paused&&now-lastLive>250){lastLive=now;updLive(now)}
  // camera (zoom glides slower than the pan while following — less lens churn)
  cam.cx+=(camT.cx-cam.cx)*.09;cam.cy+=(camT.cy-cam.cy)*.09;
  cam.w+=(camT.w-cam.w)*(camFollow?.045:.09);
  if(S.screen==="game"&&S.mode==="line"&&!S.paused){
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
      const P=S.px?null:posXY(S.pos);if(P)placeTrain(P.x,P.y,P.ang);
      // v0.4.16 lens: the hop itself sets the depth — with the furniture
      // counter-scaled to a constant size, the frame is just the hop's own
      // extent at ~80% fill (floored so micro-hops never hit the k clamp).
      // Center still leans toward the next platform, the depth crossfades into
      // the next hop's over the last 20%, and arrivals punch in briefly
      if(camFollow&&P){const j=P.j,b=S.seq[j+1],
          cx=P.x+.25*(b.x-P.x),cy=P.y+.25*(b.y-P.y),
          asp=Math.max(.2,mapWrap.clientWidth/Math.max(1,mapWrap.clientHeight)),
          wFor=i=>{const A=S.seq[i],B=S.seq[i+1],
            mx=Math.max(Math.abs(A.x-cx),Math.abs(B.x-cx)),
            my=Math.max(Math.abs(A.y-cy),Math.abs(B.y-cy));
            return Math.max(Math.max(2*mx,2*my*asp)/.8,70)};
        let w=wFor(j);
        if(P.f>.8&&j<S.segs.length-1){const m=(P.f-.8)/.2;w+=(wFor(j+1)-w)*(m*m*(3-2*m))}
        if(camPunch>0){w*=1-.04*camPunch;camPunch=Math.max(0,camPunch-dt*2)}
        camT.cx=cx;camT.cy=cy;camT.w=w}
      const hot=S.avgV>=cap*(S.hot?S.hotOn-HOT_HYS:S.hotOn); // hysteresis so the flames don't flicker
      if(hot!==S.hot&&!REDUCED())setHot(hot);
      if(S.hot){const tier=S.combo>=S.t3?3:S.combo>=S.t2?2:1;
        if(tier!==S.fireT)setFireTier(tier)}}
    else{S.dispV=Math.max(0,S.dispV-cap*dt*2);if(S.hot)setHot(false)}
    gaugeTo(S.dispV);
    $("cDist").firstChild.nodeValue=S.dist.toFixed(1);
    if(S.t0&&!S.done)$("cTime").textContent=fmtT(now-S.t0);
    if(!S.px)applyCam();
    else if(!S.pxWait)pxTry(()=>RIDE.frame(dt,S))}
  if(S.screen==="game"&&S.mode==="boss"&&!S.done&&!S.paused){
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
// back from a run → land on the world screen (the ridden line picked, its card closed), not the opening page
// one-way home (v0.5.0): pk(true) folds the hero away and shows the world screen (#pick) — there is no way back to the title but a
// reload (v0.7.0). snap commits the state without the min-height transition (off-screen valve, post-run returns).
function pk(on,snap){const h=document.querySelector("#menu .hero");
  if(snap)h.style.transition="none";
  $("menu").classList.toggle("pk",on);h.inert=on; // (the folded hero's #startBtn leaves the tab order)
  if(snap){void h.offsetHeight;h.style.transition=""}
  if(on&&S.screen==="menu")wEnter()}
function toPick(){pk(true,true);scrollTo(0,0)}
function leaveRun(){try{if(history.state&&history.state.run)history.back()}catch(e){}
  if(lastRun){wSel=lastRun.mode==="boss"?"boss":lastRun.L.id;wOpen=false;wMapOn=true}
  show("menu");renderWorld();toPick();const n=wNode(wSel);if(n)n.focus({preventScroll:true})}
// mid-run quit confirms via an in-game dialog (settings-style). The run pauses while it's
// open — train, timer, and boss countdown all freeze (tick() skips on S.paused) — and any
// dismiss that isn't Quit resumes and shifts the clock forward so the pause costs nothing.
// A finished run leaves straight away, no prompt.
function quit(){if(S.screen!=="game")return;
  if(S.done){leaveRun();return}
  if($("quitDlg").open)return;
  S.paused=true;S.pauseAt=performance.now();$("quitDlg").showModal();pxDlg($("quitDlg"));$("quitStayBtn").focus()}
$("homeBtn").onclick=quit;
$("quitGoBtn").onclick=()=>{S.paused=false;$("quitDlg").close();leaveRun()};
$("quitStayBtn").onclick=()=>$("quitDlg").close();
$("quitDlg").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
$("quitDlg").addEventListener("close",()=>{if(!S.paused)return; // cancel / backdrop / Esc → resume
  const d=performance.now()-S.pauseAt;
  if(S.t0!==null)S.t0+=d;if(S.firstT!==null)S.firstT+=d;if(S.deadline)S.deadline+=d;
  S.paused=false;if(!S.done&&!inp.disabled)inp.focus()});
$("rAgain").onclick=()=>{if(!lastRun)return;lastRun.mode==="boss"?startBoss():startLine(lastRun.L,lastRun.rev)};
$("rBack").onclick=leaveRun;
// the back guard: a pop mid-run re-arms the entry and routes through the normal quit
// confirm; on the result screen back = the back button. Pops with the menu up (incl. the
// one leaveRun consumes) fall through to the browser untouched.
addEventListener("popstate",()=>{
  if(S.screen==="game"){try{history.pushState({run:1},"")}catch(e){}quit()}
  else if(S.screen==="result")leaveRun()});
// reload / tab-close with a run in progress asks first (pull-to-refresh casualties)
addEventListener("beforeunload",e=>{
  if(S.screen==="game"&&!S.done&&S.t0!==null){e.preventDefault();e.returnValue=""}});
$("startBtn").onclick=()=>{pk(true);scrollTo(0,0);const n=wNode(wSel);if(n)n.focus({preventScroll:true})}; // hero folds up, the world shows (Enter then opens the card)
// the valve: scrolling the hero fully off-screen collapses it in place — scroll position is
// compensated in the same frame so nothing visibly moves, but there is no longer anything above
// #pick to scroll back to. (The furthest scroll leaves the hero's bottom edge on the viewport's top, which still
// counts as intersecting: the root's top is pulled in 2 px)
new IntersectionObserver(es=>{const h=document.querySelector("#menu .hero");
  if(S.screen!=="menu"||$("menu").classList.contains("pk")||es[es.length-1].isIntersecting)return;
  const y=scrollY-h.offsetHeight;pk(true,true);scrollTo(0,Math.max(0,y))},
  {threshold:0,rootMargin:"-2px 0px 0px 0px"}).observe(document.querySelector("#menu .hero"));

/* ---------- settings dialog + boot splash ---------- */
$("setBtn").onclick=()=>{paintPxSet();$("setDlg").showModal();pxDlg($("setDlg"));if(S.screen==="menu")blip("dlg")};
// ride view rows (v0.6.0): stored locally, applied live — Classic mid-run swaps to the SVG map at once; Pixel mid-run
// prepares in the background and takes over when ready. Pixel unavailable (scripts failed, a throw, the governor gave up, no
// canvas): the row reads Classic with a note, and a tap on it tries Pixel again; Weather is aria-disabled in Classic (Pixel size
// also sizes the pixel menu and dialogs since v0.7.0, so it stays live)
const WX_ORDER=["auto","clear","rain"],WX_KEY={auto:"wxAuto",clear:"wxClear",rain:"wxRain"};
function paintPxSet(){const px=RIDE_MODE==="pixel"&&pxAvail()&&!pxMiss,note=!PX_CANVAS?t("pxNoCv"):RIDE_MODE==="pixel"&&!px?t("pxOff"):"",
    b=(id,k,v,off)=>{const e=$(id);e.textContent=v;e.setAttribute("aria-label",t(k)+" · "+v);
      off?e.setAttribute("aria-disabled","true"):e.removeAttribute("aria-disabled")};
  b("rideBtn","setRide",t(px?"ridePixel":"rideClassic"),!PX_CANVAS);b("pxScaleBtn","setPxScale",PX_SCALE+"×",false);
  b("wxBtn","setWeather",t(WX_KEY[WX_MODE]),!px);
  const n=$("rideNote");n.textContent=note;n.hidden=!note;$("rideBtn").title=note;pxDlg($("setDlg"))}
const pxOff=id=>$(id).getAttribute("aria-disabled")==="true";
$("rideBtn").onclick=()=>{if(pxOff("rideBtn"))return;
  if(RIDE_MODE==="pixel"&&(!pxAvail()||pxMiss)){ // shown as Classic: picking Pixel again gives it another go (a failed load reloads what is missing)
    if(typeof RIDE!=="undefined")RIDE.giveUp=false;if(pxFail)pxPs.delete(PX_JS);pxDead=pxFail=pxSlowTold=pxMiss=false}
  else RIDE_MODE=RIDE_MODE==="pixel"?"classic":"pixel";
  if(RIDE_MODE==="pixel"&&typeof RIDE!=="undefined"&&RIDE.giveUp){RIDE.giveUp=false;pxSlowTold=false}
  store.set("ride",RIDE_MODE);paintPxSet();
  if(S.screen!=="game"||S.mode!=="line"||S.done)return;
  if(RIDE_MODE==="classic"){if(S.px||pxPrep===pxRun&&pxPrep)pxClassic()}else if(!S.px&&pxOn())pxRide(S.line,S.rev,true)}; // (also drops a takeover's prepare in flight)
$("pxScaleBtn").onclick=()=>{if(pxOff("pxScaleBtn"))return;PX_SCALE=PX_SCALE===2?3:2;store.set("pxScale",String(PX_SCALE));paintPxSet();pxChrome();
  if(S.screen==="menu")wResize(); // (the world screen's art px changed: its banner, dock and card lay out again)
  if(typeof RIDE!=="undefined")pxTry(()=>RIDE.set({scale:PX_SCALE,...(S.px?pxChips():{})}))};
$("wxBtn").onclick=()=>{if(pxOff("wxBtn"))return;WX_MODE=WX_ORDER[(WX_ORDER.indexOf(WX_MODE)+1)%WX_ORDER.length];store.set("weather",WX_MODE);paintPxSet();
  if(typeof RIDE!=="undefined")pxTry(()=>RIDE.set({weather:WX_MODE}))};
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

/* ---------- the SVG map + the world screen's wiring + boot ---------- */
(function boot(){
  const ov=$("ovMap");buildMap(ov,{bounds:true});
  pxUp=true;pxLc();ovDead=!PX_CANVAS||!$("ovHost");ovSvg(true);if(ovDead&&$("ovHost"))$("ovHost").hidden=true;
  let ovDrag=false; // set true by a pan/pinch so the trailing click doesn't select a line
  requestAnimationFrame(()=>{try{const nb=NETBB,
    // The network is portrait and spans almost the whole N–S height of both cities, so the
    // horizontal slack is where the city context sits. Centre the resting view on the
    // network and fit it to the card in both axes (a taller card ⇒ tighter horizontal
    // frame): Guangzhou and its districts fill the view while Foshan's empty far-west
    // trails off the left edge. (Not the whole-cities bbox — that would dwarf the network.)
    asp=(ov.clientWidth||801)/(ov.clientHeight||620),
    w=Math.max(nb.width+2*140,(nb.height+2*170)*asp),h=w/asp,
    x=nb.x+nb.width/2-w/2,y=nb.y+nb.height/2-h/2;
    FULL_VB=[x,y,w,h]}catch(e){FULL_VB=[0,0,760,1300]}
    ov.setAttribute("viewBox",FULL_VB.join(" "));
    // v0.4.11: deepest free zoom derives from the data — window narrow enough that
    // the shortest line (APM) fills it at the fit aspect, plus a little headroom
    const FW=FULL_VB[2],FH=FULL_VB[3];let need=1e9;
    for(const L of LINES){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(const st of L.stations){if(st.x<x0)x0=st.x;if(st.x>x1)x1=st.x;
        if(st.y<y0)y0=st.y;if(st.y>y1)y1=st.y}
      need=Math.min(need,Math.max(x1-x0+2*OV_PD,(y1-y0+2*OV_PD)*FW/FH))}
    OV_MAXZ=Math.max(OV_MAXZ,1.15*FW/need)});
  ov.addEventListener("click",e=>{if(ovDrag){ovDrag=false;return} // a pan just ended, not a tap
    if(e.target.closest(".stg"))return; // station dots: neither a line nor blank
    const p=e.target.closest(".lpath");wMapPick(p?p.dataset.line:null)}); // (as the pixel map's taps)
  // free pan/zoom (v0.4.7) — scroll / pinch to zoom, drag to pan; only when no line is focused
  const pts=new Map();let panLast=null,pinch=null,moved=0,downT=0,lastTap=0;
  ov.addEventListener("wheel",e=>{if(!ovFree())return;e.preventDefault();
    ovZoomAt(e.clientX,e.clientY,e.deltaY<0?1.12:1/1.12)},{passive:false});
  // NB: capture the pointer only once a drag/pinch actually starts — capturing on
  // pointerdown retargets the trailing `click`, which would kill line selection
  const cap=id=>{try{if(!ov.hasPointerCapture(id))ov.setPointerCapture(id)}catch(e){}};
  ov.addEventListener("pointerdown",e=>{if(!ovFree())return;ovDrag=false;
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){panLast={x:e.clientX,y:e.clientY};moved=0;downT=performance.now()}
    else if(pts.size===2){const a=[...pts.values()];panLast=null;cap(e.pointerId);
      pinch={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),cx:(a[0].x+a[1].x)/2,cy:(a[0].y+a[1].y)/2}}});
  ov.addEventListener("pointermove",e=>{if(!pts.has(e.pointerId))return;
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&pts.size>=2){const a=[...pts.values()],d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),
        cx=(a[0].x+a[1].x)/2,cy=(a[0].y+a[1].y)/2;
      if(pinch.d>0)ovZoomAt(cx,cy,d/pinch.d);ovPanBy(cx-pinch.cx,cy-pinch.cy);
      pinch={d,cx,cy};ovDrag=true;return}
    if(panLast&&ovIsZoomed()){const dx=e.clientX-panLast.x,dy=e.clientY-panLast.y; // one finger pans only when zoomed
      moved+=Math.abs(dx)+Math.abs(dy);if(moved>6){ovDrag=true;cap(e.pointerId)} // capture once it's a real drag
      ovPanBy(dx,dy);panLast={x:e.clientX,y:e.clientY}}});
  const ovUp=e=>{if(!pts.has(e.pointerId))return;pts.delete(e.pointerId);
    if(pts.size<2)pinch=null;
    if(pts.size===0){if(!ovDrag&&moved<6&&performance.now()-downT<300){ // tap; two quick taps reset
        const now=performance.now();if(now-lastTap<300){ovResetView();lastTap=0}else lastTap=now}
      panLast=null}
    else if(pts.size===1){const v=[...pts.values()][0];panLast={x:v.x,y:v.y}}};
  ov.addEventListener("pointerup",ovUp);ov.addEventListener("pointercancel",ovUp);
  // the world screen: dock (click picks + opens, or closes the picked one's card; mouse hover; a touch swipe picks where it settles;
  // a vertical wheel scrolls an overflowing strip sideways) · stub · card · chips · dialogs · keys · the gesture that starts audio
  const on=(id,ev,f,o)=>{const e=$(id);if(e)e.addEventListener(ev,f,o)},mouse=f=>e=>{if(e.pointerType==="mouse")f(e)};
  on("path","click",e=>{const b=e.target.closest(".pw-node");if(!b)return;const id=b.dataset.id;
    if(id===wSel&&wOpen)wCloseCard();else wSelect(id,{open:true,focusCard:false})});
  // (hover follows the mouse's own moves only: a strip scrolling under a still mouse — a node scrolled to the centre — hovers nothing)
  let wPX=NaN,wPY=NaN;
  on("path","pointermove",mouse(e=>{if(e.clientX===wPX&&e.clientY===wPY)return;wPX=e.clientX;wPY=e.clientY;
    const b=e.target.closest(".pw-node");if(b)wHover(b.dataset.id,"strip")}));
  on("strip","pointerleave",mouse(()=>wHover(null,"strip")));
  on("strip","touchstart",()=>{wSwiped=true},{passive:true});
  if("onscrollend"in window)on("strip","scrollend",wSwipeEnd);else on("strip","scroll",()=>{clearTimeout(wSwT);wSwT=setTimeout(wSwipeEnd,160)},{passive:true});
  on("strip","wheel",e=>{const s=e.currentTarget;if(s.scrollWidth<=s.clientWidth+1||Math.abs(e.deltaX)>=Math.abs(e.deltaY))return;
    e.preventDefault();s.scrollLeft+=e.deltaY*(e.deltaMode===1?16:1)},{passive:false});
  on("stub","click",()=>{wTouch();wOpenCard()});
  on("stub","pointerenter",mouse(()=>wHover(wSel,"stub")));on("stub","pointerleave",mouse(()=>wHover(null,"stub")));
  on("card","click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const a=b.dataset.act;
    if(a==="close")wCloseCard();else if(a==="go")wStart();else if(a==="rev")wRev()});
  if($("lbBtn"))$("lbBtn").onclick=()=>wDlg("lbDlg");
  if($("aboutBtn"))$("aboutBtn").onclick=()=>wDlg("aboutDlg");
  on("accBtn","click",()=>{if(S.screen==="menu")blip("dlg")});
  on("aboutClose","click",()=>$("aboutDlg").close()); // (the leaderboard's close, backdrop and tab blips: cloud.js)
  on("aboutDlg","click",e=>{const d=e.currentTarget,r=d.getBoundingClientRect(); // (the backdrop, not the dialog's own padding)
    if(e.target===d&&(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom))d.close()});
  on("setDlg","click",e=>{const b=e.target.closest("button");if(b&&b.id!=="setClose"&&S.screen==="menu"&&b.getAttribute("aria-disabled")!=="true")blip("move")}); // (a setting changed)
  for(const id of["lbDlg","aboutDlg","setDlg","accDlg"])on(id,"close",()=>{if(S.screen==="menu")blip("close")});
  addEventListener("pointerdown",()=>{if(S.screen==="menu")ac()},true);
  // keys: ←/→ pick (wrapping), Home/End, Enter/Space open the card / start (a button keeps its own), R reverse, Esc close / home
  addEventListener("keydown",e=>{if(S.screen!=="menu")return;ac();
    if(!wOn()||e.altKey||e.ctrlKey||e.metaKey||e.isComposing||document.querySelector("dialog[open]"))return;
    const tg=e.target,k=e.key,in_=s=>tg.closest&&tg.closest(s);if(in_("input,textarea,select,[contenteditable]"))return;
    const node=in_(".pw-node"),btn=!node&&in_("button,[role=button],a[href]");
    if(k==="ArrowLeft"||k==="ArrowRight"){e.preventDefault();e.stopPropagation();wStep(k==="ArrowRight"?1:-1)}
    else if(k==="Home"||k==="End"){e.preventDefault();wSelect(k==="Home"?WIDS[0]:"boss",{focusNode:!!node})}
    else if((k==="Enter"||k===" ")&&!btn){e.preventDefault();e.stopPropagation();if(e.repeat)return;wTouch();if(!wOpen)wOpenCard();else wStart()}
    else if((k==="r"||k==="R")&&!e.repeat){e.preventDefault();wRev()}
    else if(k==="Escape"){if(wOpen){e.preventDefault();wCloseCard()}else if(wMapOn){e.preventDefault();wRest()}}},true);
  document.documentElement.classList.add("idle");wPlaceCls();
  setLang(LANG); // renders all i18n text + the world screen
  window.addEventListener("resize",()=>{if(S.screen==="game"&&!camFollow)fitAll(true);pxChrome(); // (a zoom changes the dpr)
    if(S.px&&typeof RIDE!=="undefined")pxTry(()=>RIDE.set(pxChips()));clearTimeout(wRsT);wRsT=setTimeout(wResize,120)});
  if(typeof ResizeObserver==="function")new ResizeObserver(()=>{if(S.screen==="menu")wLayout()}).observe($("fchips")); // (a nickname, its late hanzi face: the banner's room)
  setTimeout(()=>{ // idle-prefetch the other theme's hero pair so the toggle swaps without a blank
    const n=document.documentElement.dataset.theme==="light"?"-night":"";
    ["assets/guangzhou-tower-v2"+n+".jpg","assets/guangzhou-tower-v2"+n+"-tower-only.png"]
      .forEach(u=>{(new Image).src=u});
    // …and the pixel ride's scripts + map index, on idle after the menu set (never before: the menu's first paint stays as it was)
    const c=navigator.connection;
    if(pxOn()&&!(c&&c.saveData))(window.requestIdleCallback||setTimeout)(()=>{pxMenu();
      pxLoad(PX_MENU).catch(()=>{}).then(()=>pxLoad()).catch(e=>console.warn(e))})},3000);
  // the menu set (pixel map; without one, the kit's fonts): after the page's load + idle; at once on a start / chip (leaderboard,
  // settings, account, about) click or once #pick shows (saveData: only those) — the hero covers the first screen, so it loads out of sight
  {const go=()=>{pxMenu()},c=navigator.connection;
    for(const id of["startBtn","setBtn","accBtn","lbBtn","aboutBtn"])if($(id))$(id).addEventListener("click",go);
    const io=new IntersectionObserver(es=>{if(es.some(e=>e.intersectionRect.height>0)){io.disconnect();go()}},{threshold:[0,.001,.01]});
    io.observe($("pick"));
    if(!(c&&c.saveData)){const idle=()=>window.requestIdleCallback?requestIdleCallback(go,{timeout:1000}):setTimeout(go,200);
      document.readyState==="complete"?idle():addEventListener("load",idle,{once:true})}}
})();
