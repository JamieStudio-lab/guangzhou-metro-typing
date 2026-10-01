/* ============================================================
   CLOUD — optional Supabase accounts: settings sync, score upload,
   global leaderboard, badges. Zero dependencies: plain fetch against
   the GoTrue (/auth/v1) and PostgREST (/rest/v1) HTTP APIs, so it
   works from file:// and degrades to offline play when unreachable.
   The publishable key is public by design — row-level security in
   supabase/setup.sql is what protects the data.
============================================================ */
const SB_URL="https://rlnkfalmlnjxqtbjrnrk.supabase.co";
const SB_KEY="sb_publishable_gxT6qQFLqfEMIU2ip5tdcg_1xroL0KP";

let SESS=null,PROFILE=null,MY_BADGES=new Set();
let NOTE=null,NEW_BADGES=[],LB_MODE="l1",LB_CACHE={},REC_MODE="l1",REC_CACHE={},STARS=null;
try{SESS=JSON.parse(store.get("sb_session")||"null")}catch(e){SESS=null}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// pixel UI kit (v0.7.0): a 9×9 icon from index.html's sprite · nicknames are FP12, whose 3500-hanzi supplement game.js pxHan() lazy-loads
const ICO=n=>`<svg class="pki" aria-hidden="true"><use href="#pki-${n}"/></svg>`;
const han=()=>{if(typeof pxHan==="function")pxHan()};
// the leaderboard asks for it only once its dialog has opened with a nickname beyond Latin-1
let LB_SEEN=false,LB_HAN=false;
const place=(id="accDlg")=>{if(typeof pxDlg==="function")pxDlg($(id))}; // (game.js: a dialog on whole art px, after it opens / changes size)
// the world map's stars (game.js worldProgress re-reads cloudStars) change with the player: after a sign-in / sign-out
const progHook=()=>{STARS=null;if(typeof worldProgress==="function")worldProgress()};

/* ---------- auth (GoTrue) ---------- */
async function authReq(path,body){
  const r=await fetch(SB_URL+"/auth/v1/"+path,{method:"POST",
    headers:{apikey:SB_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw{code:j.error_code||j.code||"",msg:j.msg||j.message||j.error_description||("HTTP "+r.status)};
  return j}
function saveSess(j){
  SESS=j&&j.access_token?{access_token:j.access_token,refresh_token:j.refresh_token,
    expires_at:j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600),
    user:{id:j.user.id,email:j.user.email}}:null;
  store.set("sb_session",JSON.stringify(SESS))}
async function ensureToken(){if(!SESS)return null;
  if(SESS.expires_at-60>Date.now()/1000)return SESS.access_token;
  try{saveSess(await authReq("token?grant_type=refresh_token",{refresh_token:SESS.refresh_token}))}
  catch(e){if(e&&e.code!==undefined){saveSess(null);PROFILE=null;MY_BADGES=new Set();updAccBtn();progHook()}}
  return SESS&&SESS.access_token}

/* ---------- data (PostgREST) ---------- */
async function rest(method,path,body,prefer){
  const tok=await ensureToken();
  const h={apikey:SB_KEY,Authorization:"Bearer "+(tok||SB_KEY),"Content-Type":"application/json"};
  if(prefer)h.Prefer=prefer;
  const r=await fetch(SB_URL+"/rest/v1/"+path,{method,headers:h,body:body?JSON.stringify(body):undefined});
  if(r.status===204)return null;
  const j=await r.json().catch(()=>null);
  if(!r.ok)throw{code:(j&&j.code)||String(r.status),msg:(j&&j.message)||("HTTP "+r.status)};
  return j}
async function countRows(query){
  const r=await fetch(SB_URL+"/rest/v1/"+query,
    {method:"HEAD",headers:{apikey:SB_KEY,Authorization:"Bearer "+SB_KEY,Prefer:"count=exact"}});
  return +(r.headers.get("content-range")||"/0").split("/")[1]||0}
const countBetter=(mode,score)=>countRows(`leaderboard?mode=eq.${mode}&score=gt.${score}&select=user_id`);

/* ---------- session lifecycle ---------- */
async function afterLogin(){
  const rows=await rest("GET",`profiles?id=eq.${SESS.user.id}&select=nickname,lang,theme`);
  PROFILE=rows&&rows[0]||null;
  if(PROFILE){applyPrefs();await loadBadges()}
  updAccBtn();progHook()}
function applyPrefs(){
  if(PROFILE.theme&&PROFILE.theme!==THEME){
    setTheme(PROFILE.theme);store.set("theme",PROFILE.theme)}
  if(PROFILE.lang&&PROFILE.lang!==LANG)setLang(PROFILE.lang)}
async function loadBadges(){try{
  const rows=await rest("GET",`badges?user_id=eq.${SESS.user.id}&select=badge`);
  MY_BADGES=new Set(rows.map(r=>r.badge));
  if($("accDlg").open&&DLG_MODE==="in")renderDlg()}catch(e){}}
async function claimNick(nick,code){
  const lang=LANG,theme=THEME;
  await rest("POST","rpc/register_profile",
    {p_nickname:nick,p_code:code,p_lang:lang,p_theme:theme});
  PROFILE={nickname:nick,lang,theme};updAccBtn();progHook()}
function doLogout(){const tok=SESS&&SESS.access_token;
  saveSess(null);PROFILE=null;MY_BADGES=new Set();NOTE=null;NEW_BADGES=[];REC_CACHE={};
  if(tok)fetch(SB_URL+"/auth/v1/logout",{method:"POST",
    headers:{apikey:SB_KEY,Authorization:"Bearer "+tok}}).catch(()=>{});
  updAccBtn();paintCloudNote();if(LB_CACHE[LB_MODE])paintLb(LB_CACHE[LB_MODE]);progHook()}

/* settings sync: runs after game.js's own click handlers updated LANG/theme */
let prefT=null;
function queuePrefs(){if(!SESS||!PROFILE)return;clearTimeout(prefT);
  prefT=setTimeout(()=>{rest("PATCH",`profiles?id=eq.${SESS.user.id}`,
    {lang:LANG,theme:THEME}).catch(()=>{})},600)}

/* ---------- badges: [id, pixel icon, earned?] ---------- */
const BADGE_DEFS=[
  ["first","ticket",r=>r.mode==="line"],
  // one completion badge per line, the icon a roundel in the line's colour (ids l1/l2/l3 predate v0.3.2)
  ...LINES.map(L=>[L.id,"line",r=>r.key===L.id]),
  ["star3","star",r=>r.stars===3],
  ["boss","crown",r=>r.mode==="boss"&&r.cleared>=r.total&&r.lives>0],
  ["wpm60","train",r=>r.wpm>=60],["wpm100","maglev",r=>r.wpm>=100],
  ["combo20","flame",r=>r.maxCombo>=20],
  ["acc100","target",r=>r.mode==="line"&&r.acc>=100]];
const badgeName=id=>{const L=LINES.find(l=>l.id===id);return L?t("badge_line",L):t("badge_"+id)};
const bLc=b=>b[1]==="line"?` data-lc="${b[0]}"`:"";

/* ---------- score upload (called by showResult) ---------- */
async function cloudOnResult(run){
  NOTE=null;NEW_BADGES=[];paintCloudNote();
  if(!SESS||!PROFILE)return;
  try{
    await rest("POST","scores",{user_id:SESS.user.id,mode:run.key,score:run.score,
      wpm:run.wpm,acc:run.acc,max_combo:run.maxCombo,duration_s:run.durS,stars:run.stars});
    delete LB_CACHE[run.key];delete REC_CACHE[run.key];
    if(STARS&&STARS.v)STARS.v[run.key]=Math.max(STARS.v[run.key]||0,run.stars|0);
    // the note promises current global standing, so rank the player's best in
    // this mode (the run just uploaded may not be it), never counting themselves
    let rank=null;try{
      const me=await rest("GET",`leaderboard?mode=eq.${run.key}&user_id=eq.${SESS.user.id}&select=score`);
      rank=1+await countBetter(run.key,Math.max(run.score,me&&me[0]?me[0].score:0))}catch(e){}
    // where this run sits among the player's own uploads (it's already in, gt excludes it)
    let myRank=null;try{
      myRank=1+await countRows(`scores?user_id=eq.${SESS.user.id}&mode=eq.${run.key}&score=gt.${run.score}&select=id`)}catch(e){}
    NOTE={ok:true,rank,myRank};
    NEW_BADGES=BADGE_DEFS.filter(b=>!MY_BADGES.has(b[0])&&b[2](run));
    for(const b of NEW_BADGES){MY_BADGES.add(b[0]);
      rest("POST","badges?on_conflict=user_id,badge",{user_id:SESS.user.id,badge:b[0]},
        "resolution=ignore-duplicates").catch(()=>{})}
  }catch(e){NOTE={ok:false}}
  paintCloudNote()}
function paintCloudNote(){
  const el=$("cloudNote"),nb=$("newBadges");
  if(!NOTE){el.hidden=true;nb.hidden=true;return}
  el.hidden=false;
  let msg=NOTE.rank?t("cloudSaved",NOTE.rank):t("cloudSavedNoRank");
  if(NOTE.myRank===1)msg+=" · "+t("cloudPB");
  else if(NOTE.myRank&&NOTE.myRank<=5)msg+=" · "+t("cloudMyBest",NOTE.myRank);
  el.textContent=NOTE.ok?msg:t("cloudErr");
  nb.hidden=!NEW_BADGES.length;
  nb.innerHTML=NEW_BADGES.map(b=>
    `<span class="bdgchip new"${bLc(b)}>${ICO(b[1])} ${badgeName(b[0])} · ${t("badgeNew")}</span>`).join("")}

/* ---------- the world map's stars: the signed-in player's best per mode (1 GET of their own scores, once a session) ---------- */
// cloudStars() → Promise<{mode: 1–3}>: {} signed out, offline or on an error (not cached then); the cache drops on sign-in / out
function cloudStars(){
  if(!SESS||!PROFILE)return Promise.resolve({});
  if(STARS&&STARS.uid===SESS.user.id)return STARS.p;
  const me={uid:SESS.user.id,v:null};STARS=me;
  return me.p=rest("GET",`scores?user_id=eq.${SESS.user.id}&stars=gt.0&select=mode,stars`).then(rows=>{const o={};
      for(const r of rows||[])if(r&&r.mode)o[r.mode]=Math.max(o[r.mode]||0,Math.min(3,r.stars|0));
      me.v=o;return SESS&&SESS.user.id===me.uid?o:{}},
    ()=>{if(STARS===me)STARS=null;return{}})}

/* ---------- leaderboard (#lbDlg, opened by game.js's trophy chip → cloudLbOpen): 20 mode tabs (roving tabindex, ←/→/Home/End),
   the line number (full name in the tooltip), the top 10 as kit rows; loads only once opened ---------- */
const MODES=()=>[...LINES.map(L=>L.id),"boss"];
const tabsHTML=cur=>MODES().map(m=>{const L=LINES.find(l=>l.id===m),on=m===cur,nm=L?esc(t("lineName",L)):"";
  return `<button class="lbtab pk-tab${on?" on":""}" type="button" role="tab" data-m="${m}" data-lc="${m}" aria-selected="${on}" tabindex="${on?0:-1}"${L?` title="${nm}" aria-label="${nm}"`:""}>${L?esc(L.num):esc(t("lbBoss"))}</button>`}).join("");
function selTab(el,m){el.querySelectorAll(".lbtab").forEach(b=>{const on=b.dataset.m===m;
  b.classList.toggle("on",on);b.setAttribute("aria-selected",on);b.tabIndex=on?0:-1})}
function tabNav(el,get,pick){el.addEventListener("keydown",e=>{const ids=MODES(),i=ids.indexOf(get()),k=e.key,
    j=k==="ArrowRight"?i+1:k==="ArrowLeft"?i-1:k==="Home"?0:k==="End"?ids.length-1:null;
  if(j===null||!e.target.closest(".lbtab"))return;e.preventDefault();pick(ids[(j+ids.length)%ids.length]);
  const b=el.querySelector('.lbtab[aria-selected="true"]');if(b)b.focus()})}
function renderLbTabs(){const el=$("lbTabs");el.innerHTML=tabsHTML(LB_MODE);
  el.querySelectorAll(".lbtab").forEach(b=>b.onclick=()=>pickLb(b.dataset.m))}
function pickLb(m){if(m!==LB_MODE&&typeof blip==="function")blip("move");LB_MODE=m;selTab($("lbTabs"),m);loadLb(m)}
// game.js opens the dialog (before or after this call) with the picked id (a line id or "boss"); the picked tab takes the focus
function cloudLbOpen(mode){
  if(mode&&MODES().includes(mode))LB_MODE=mode;
  renderLbTabs();const b=$("lbTabs").querySelector('.lbtab[aria-selected="true"]');
  if(b){b.autofocus=true;if($("lbDlg").open)b.focus()}
  LB_SEEN=true;if(LB_HAN)han();
  loadLb(LB_MODE);place("lbDlg")}
const lbMsg=k=>`<p class="lbmsg f12">${t(k)}</p>`;
const row=(i,me,name,wpm,acc,score,cls="")=>`<div class="pk-row${cls}${me?" me":""}"><span class="rk ${i<3?"acc":"dim"}">${i+1}</span><span class="grow f12">${name}</span>`+
  `<span class="dim w">${+wpm} wpm</span><span class="dim a">${Math.round(acc)}%</span><span class="sc">${+score}</span></div>`;
const LB_PEND={};
async function loadLb(mode){
  if(LB_CACHE[mode]){paintLb(LB_CACHE[mode]);return}
  $("lbBody").innerHTML=lbMsg("lbLoading");place("lbDlg");
  if(LB_PEND[mode])return; // (one request per mode in flight: a second open, a tab flicked back and forth)
  LB_PEND[mode]=1;
  try{const rows=await rest("GET",
      `leaderboard?mode=eq.${mode}&select=nickname,score,wpm,acc&order=score.desc,created_at.asc&limit=10`);
    LB_CACHE[mode]=rows;if(mode===LB_MODE)paintLb(rows)}
  catch(e){if(mode===LB_MODE){$("lbBody").innerHTML=lbMsg("lbErr");place("lbDlg")}}
  finally{delete LB_PEND[mode]}}
function paintLb(rows){
  if(!rows.length)$("lbBody").innerHTML=lbMsg("lbEmpty");
  else{$("lbBody").innerHTML=rows.map((r,i)=>row(i,PROFILE&&r.nickname===PROFILE.nickname,esc(r.nickname),r.wpm,r.acc,r.score)).join("");
    if(rows.some(r=>/[^\x00-\xff]/.test(r.nickname))){LB_HAN=true;if(LB_SEEN)han()}}
  place("lbDlg")}

/* ---------- account dialog (modes login · reg · nick · in; kit fields, the badge wall, personal records) ---------- */
let DLG_MODE="login",DLG_BUSY=false;
function openDlg(){DLG_MODE=SESS?(PROFILE?"in":"nick"):"login";renderDlg();
  $("accDlg").showModal();place();const f=$("accDlg").querySelector("input");if(f)f.focus();han()}
// the message (aria-live) + the field it is about, marked aria-invalid and focused
function setErr(m,f){const d=$("accDlg"),e=d.querySelector(".derr");if(e)e.textContent=m||"";
  d.querySelectorAll("input[aria-invalid]").forEach(i=>i.removeAttribute("aria-invalid"));
  const x=f&&d.querySelector("#"+f);if(x){x.setAttribute("aria-invalid","true");x.focus()}}
function setBusy(on){DLG_BUSY=on;
  $("accDlg").querySelectorAll("button").forEach(b=>b.disabled=on)}
const fld=(lb,id,a)=>`<label class="pk-field"><span>${lb}</span><input id="${id}"${a}></label>`;
const dBtn=(id,tx,pri)=>`<button class="pk-btn${pri?" pri":""}" id="${id}" type="button">${tx}</button>`;
const F_NICK=' maxlength="20" autocomplete="nickname"',F_INV=' maxlength="40" autocomplete="off"',D_ERR='<p class="derr pk-msg" aria-live="polite"></p>';
function renderDlg(){const d=$("accDlg");let h;
  d.className="pk-dlg "+(DLG_MODE==="in"?"w-in":"w-acc");
  if(DLG_MODE==="in"){
    h=`<h3 id="accH" class="nick">${esc(PROFILE.nickname)}</h3><p class="dmut f10">${esc(SESS.user.email)}</p>
      <p class="dmut f10">${t("accSync")}</p><h4 class="f12">${t("accBadges")}</h4>
      <div class="bdgs">${BADGE_DEFS.map(b=>
        `<span class="pk-badge${MY_BADGES.has(b[0])?"":" off"}"${bLc(b)}>${ICO(b[1])}${badgeName(b[0])}</span>`).join("")}</div>
      ${MY_BADGES.size?"":`<p class="dmut f10">${t("accNoBadges")}</p>`}
      <h4 class="f12">${t("accRecords")}</h4>
      <div class="rectabs" id="recTabs" role="tablist" aria-label="${esc(t("accRecords"))}"></div>
      <div class="pk-inset lbbody" id="recBody" aria-live="polite"></div>
      <div class="dbtns">${dBtn("dLogout",t("accLogout"))}${dBtn("dClose",t("accClose"))}</div>`}
  else if(DLG_MODE==="nick"){
    h=`<h3 id="accH">${t("accTitle")}</h3><p class="dmut f10">${t("accNeedNick")}</p>
      ${fld(t("accNick"),"dNick",F_NICK)}${fld(t("accInvite"),"dInv",F_INV)}${D_ERR}
      <div class="dbtns">${dBtn("dGo",t("accDoReg"),1)}${dBtn("dClose",t("accClose"))}</div>`}
  else{const reg=DLG_MODE==="reg";
    h=`<h3 id="accH">${reg?t("accDoReg"):t("accLogin")}</h3>
      ${reg?fld(t("accNick"),"dNick",F_NICK):""}
      ${fld(t("accEmail"),"dEmail",' type="email" autocomplete="email"')}
      ${fld(t("accPw"),"dPw",` type="password" autocomplete="${reg?"new-password":"current-password"}"`)}
      ${reg?fld(t("accInvite"),"dInv",F_INV):""}${D_ERR}
      <div class="dbtns">${dBtn("dGo",reg?t("accDoReg"):t("accLogin"),1)}${dBtn("dClose",t("accClose"))}</div>
      <button class="dlink f10" id="dSwap" type="button">${reg?t("accToLogin"):t("accToReg")}</button>`}
  d.innerHTML=h;
  const q=id=>d.querySelector("#"+id);
  if(q("dClose"))q("dClose").onclick=()=>d.close();
  if(q("dLogout"))q("dLogout").onclick=()=>doLogout();
  if(q("dSwap"))q("dSwap").onclick=()=>{DLG_MODE=DLG_MODE==="reg"?"login":"reg";renderDlg();
    const f=d.querySelector("input");if(f)f.focus()};
  if(q("dGo"))q("dGo").onclick=dlgSubmit;
  d.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();dlgSubmit()}}));
  if(DLG_MODE==="in"){renderRecTabs();loadRecs(REC_MODE)}
  place()}

/* ---------- personal records (best 5 per mode, in the account dialog) ---------- */
const recDate=iso=>new Date(iso).toLocaleDateString(LANG==="zh"?"zh-CN":"en-GB",{month:"short",day:"numeric"});
function renderRecTabs(){const el=$("recTabs");if(!el)return;
  el.innerHTML=tabsHTML(REC_MODE);
  el.querySelectorAll(".lbtab").forEach(b=>b.onclick=()=>pickRec(b.dataset.m));tabNav(el,()=>REC_MODE,pickRec)}
function pickRec(m){REC_MODE=m;const el=$("recTabs");if(el)selTab(el,m);loadRecs(m)}
async function loadRecs(mode){if(!$("recBody"))return;
  if(REC_CACHE[mode]){paintRecs(REC_CACHE[mode]);return}
  $("recBody").innerHTML=lbMsg("lbLoading");place();
  try{const rows=await rest("GET",
      `scores?user_id=eq.${SESS.user.id}&mode=eq.${mode}&select=score,wpm,acc,stars,created_at&order=score.desc,created_at.asc&limit=5`);
    REC_CACHE[mode]=rows;if(mode===REC_MODE&&$("recBody"))paintRecs(rows)}
  catch(e){if(mode===REC_MODE&&$("recBody")){$("recBody").innerHTML=lbMsg("recErr");place()}}}
function paintRecs(rows){const el=$("recBody");
  el.innerHTML=rows.length?rows.map((r,i)=>row(i,!i,`${esc(recDate(r.created_at))}<i>${"★".repeat(Math.max(0,Math.min(3,r.stars|0)))}</i>`,r.wpm,r.acc,r.score," rec")).join(""):lbMsg("recEmpty");
  place()}
// server errors that are about one field
const ERR_F={user_already_exists:"dEmail",email_exists:"dEmail",weak_password:"dPw",validation_failed:"dEmail",IV001:"dInv","23505":"dNick"};
function mapErr(e){
  if(e instanceof TypeError)return t("accNetErr");
  switch(e.code){
    case"invalid_credentials":return t("accBadCred");
    case"user_already_exists":case"email_exists":return t("accEmailUsed");
    case"weak_password":return t("accWeakPw");
    case"validation_failed":return t("accBadEmail");
    case"IV001":return t("accBadInvite");
    case"23505":return t("accNickTaken");
    default:return e.msg||t("accNetErr")}}
async function dlgSubmit(){if(DLG_BUSY)return;setErr("");
  const d=$("accDlg"),val=id=>{const e=d.querySelector("#"+id);return e?e.value.trim():""};
  try{
    if(DLG_MODE==="nick"){
      const nick=val("dNick"),code=val("dInv");
      if(nick.length<2){setErr(t("accNickShort"),"dNick");return}
      if(!code){setErr(t("accNeedInvite"),"dInv");return}
      setBusy(true);await claimNick(nick,code);loadBadges();d.close()}
    else if(DLG_MODE==="reg"){
      const nick=val("dNick"),email=val("dEmail"),pw=d.querySelector("#dPw").value,code=val("dInv");
      if(nick.length<2){setErr(t("accNickShort"),"dNick");return}
      if(pw.length<6){setErr(t("accWeakPw"),"dPw");return}
      if(!code){setErr(t("accNeedInvite"),"dInv");return}
      setBusy(true);
      // reject bad invites and taken nicknames before creating the account
      if((await rest("POST","rpc/check_invite",{p_code:code}))!==true){
        setBusy(false);setErr(t("accBadInvite"),"dInv");return}
      try{const hit=await rest("GET",
        `profiles?select=id&nickname=ilike.${encodeURIComponent(nick.replace(/[%_\\]/g,""))}&limit=1`);
        if(hit&&hit.length){setBusy(false);setErr(t("accNickTaken"),"dNick");return}}catch(e){}
      const j=await authReq("signup",{email,password:pw});
      if(!j.access_token)throw{code:"",msg:t("accConfirm")};
      saveSess(j);
      try{await claimNick(nick,code)}
      catch(e){setBusy(false);DLG_MODE="nick";renderDlg();setErr(mapErr(e),ERR_F[e&&e.code]);return}
      d.close()}
    else{
      const email=val("dEmail"),pw=d.querySelector("#dPw").value;
      setBusy(true);
      saveSess(await authReq("token?grant_type=password",{email,password:pw}));
      await afterLogin();
      if(!PROFILE){setBusy(false);DLG_MODE="nick";renderDlg();return}
      d.close()}
    updAccBtn();LB_CACHE={};REC_CACHE={};if($("lbDlg").open)loadLb(LB_MODE)}
  catch(e){
    if(e&&e.code==="23503"){ // session points at a deleted auth user — start over
      saveSess(null);PROFILE=null;MY_BADGES=new Set();updAccBtn();
      DLG_MODE="reg";renderDlg();setErr(t("accStale"))}
    else setErr(mapErr(e),ERR_F[e&&e.code])}
  finally{setBusy(false)}}

/* ---------- header button + i18n refresh ---------- */
function updAccBtn(){const b=$("accBtn");
  if(PROFILE){b.innerHTML=ICO("user")+`<span>${esc(PROFILE.nickname)}</span>`;b.setAttribute("aria-label",`${t("accTitle")} · ${PROFILE.nickname}`);han()}
  else{b.innerHTML=ICO("user")+`<span>${esc(t("accLogin"))}</span>`;b.setAttribute("aria-label",`Account · 账号 · ${t("accLogin")}`)}
  b.classList.toggle("on",!!PROFILE)}
function cloudLangRefresh(){updAccBtn();renderLbTabs();
  if(LB_CACHE[LB_MODE])paintLb(LB_CACHE[LB_MODE]);
  paintCloudNote();
  if($("accDlg").open)renderDlg()}

/* ---------- boot ---------- */
(function cloudBoot(){
  $("accBtn").onclick=openDlg;
  ["langBtn","langPrev","langNext","themeBtn"].forEach(id=>$(id).addEventListener("click",queuePrefs));
  renderLbTabs();tabNav($("lbTabs"),()=>LB_MODE,pickLb);
  const lb=$("lbDlg");$("lbClose").addEventListener("click",()=>lb.close());
  lb.addEventListener("click",e=>{const r=lb.getBoundingClientRect(); // (the backdrop, not the dialog's own padding)
    if(e.target===lb&&(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom))lb.close()});
  updAccBtn();
  if(SESS)ensureToken().then(tk=>{if(tk)afterLogin().catch(()=>{})});
})();
