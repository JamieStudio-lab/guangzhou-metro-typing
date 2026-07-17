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
let NOTE=null,NEW_BADGES=[],LB_MODE="l1",LB_CACHE={},REC_MODE="l1",REC_CACHE={};
try{SESS=JSON.parse(store.get("sb_session")||"null")}catch(e){SESS=null}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

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
  catch(e){if(e&&e.code!==undefined){saveSess(null);PROFILE=null;MY_BADGES=new Set();updAccBtn()}}
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
  updAccBtn()}
function applyPrefs(){
  if(PROFILE.theme&&PROFILE.theme!==document.documentElement.dataset.theme){
    themeManual=true;setTheme(PROFILE.theme);store.set("theme",PROFILE.theme)}
  if(PROFILE.lang&&PROFILE.lang!==LANG)setLang(PROFILE.lang)}
async function loadBadges(){try{
  const rows=await rest("GET",`badges?user_id=eq.${SESS.user.id}&select=badge`);
  MY_BADGES=new Set(rows.map(r=>r.badge));
  if($("accDlg").open&&DLG_MODE==="in")renderDlg()}catch(e){}}
async function claimNick(nick,code){
  const lang=LANG,theme=document.documentElement.dataset.theme;
  await rest("POST","rpc/register_profile",
    {p_nickname:nick,p_code:code,p_lang:lang,p_theme:theme});
  PROFILE={nickname:nick,lang,theme};updAccBtn()}
function doLogout(){const tok=SESS&&SESS.access_token;
  saveSess(null);PROFILE=null;MY_BADGES=new Set();NOTE=null;NEW_BADGES=[];REC_CACHE={};
  if(tok)fetch(SB_URL+"/auth/v1/logout",{method:"POST",
    headers:{apikey:SB_KEY,Authorization:"Bearer "+tok}}).catch(()=>{});
  updAccBtn();paintCloudNote();if(LB_CACHE[LB_MODE])paintLb(LB_CACHE[LB_MODE])}

/* settings sync: runs after game.js's own click handlers updated LANG/theme */
let prefT=null;
function queuePrefs(){if(!SESS||!PROFILE)return;clearTimeout(prefT);
  prefT=setTimeout(()=>{rest("PATCH",`profiles?id=eq.${SESS.user.id}`,
    {lang:LANG,theme:document.documentElement.dataset.theme}).catch(()=>{})},600)}

/* ---------- badges ---------- */
const BADGE_DEFS=[
  ["first","🎫",r=>r.mode==="line"],
  ["l1","🟡",r=>r.key==="l1"],["l2","🔵",r=>r.key==="l2"],["l3","🟠",r=>r.key==="l3"],
  ["star3","🌟",r=>r.stars===3],
  ["boss","👑",r=>r.mode==="boss"&&r.cleared>=r.total&&r.lives>0],
  ["wpm60","🚄",r=>r.wpm>=60],["wpm100","🚀",r=>r.wpm>=100],
  ["combo20","🔥",r=>r.maxCombo>=20],
  ["acc100","🎯",r=>r.mode==="line"&&r.acc>=100]];

/* ---------- score upload (called by showResult) ---------- */
async function cloudOnResult(run){
  NOTE=null;NEW_BADGES=[];paintCloudNote();
  if(!SESS||!PROFILE)return;
  try{
    await rest("POST","scores",{user_id:SESS.user.id,mode:run.key,score:run.score,
      wpm:run.wpm,acc:run.acc,max_combo:run.maxCombo,duration_s:run.durS,stars:run.stars});
    delete LB_CACHE[run.key];delete REC_CACHE[run.key];
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
    `<span class="bdgchip new">${b[1]} ${t("badge_"+b[0])} · ${t("badgeNew")}</span>`).join("")}

/* ---------- leaderboard ---------- */
function renderLbTabs(){
  $("lbTabs").innerHTML=LINES.map(L=>
    `<button class="lbtab${LB_MODE===L.id?" on":""}" data-m="${L.id}" style="--cc:${L.color};--cc-tx:${typeof txOn==="function"?txOn(L.color):"#0a0f1a"}">${t("lineName",L)}</button>`).join("")+
    `<button class="lbtab${LB_MODE==="boss"?" on":""}" data-m="boss" style="--cc:var(--bad)">${t("lbBoss")}</button>`;
  $("lbTabs").querySelectorAll(".lbtab").forEach(b=>
    b.onclick=()=>{LB_MODE=b.dataset.m;renderLbTabs();loadLb(LB_MODE)})}
async function loadLb(mode){
  if(LB_CACHE[mode]){paintLb(LB_CACHE[mode]);return}
  $("lbBody").innerHTML=`<p class="lbmsg">${t("lbLoading")}</p>`;
  try{const rows=await rest("GET",
      `leaderboard?mode=eq.${mode}&select=nickname,score,wpm,acc&order=score.desc,created_at.asc&limit=10`);
    LB_CACHE[mode]=rows;if(mode===LB_MODE)paintLb(rows)}
  catch(e){$("lbBody").innerHTML=`<p class="lbmsg">${t("lbErr")}</p>`}}
function paintLb(rows){
  if(!rows.length){$("lbBody").innerHTML=`<p class="lbmsg">${t("lbEmpty")}</p>`;return}
  $("lbBody").innerHTML=rows.map((r,i)=>
    `<div class="lbrow${PROFILE&&r.nickname===PROFILE.nickname?" me":""}">
      <span class="lbrank">${i+1}</span><span class="lbnick">${esc(r.nickname)}</span>
      <span class="lbsub">${r.wpm} wpm</span><span class="lbsub">${Math.round(r.acc)}%</span>
      <b class="lbscore">${r.score}</b></div>`).join("")}

/* ---------- account dialog ---------- */
let DLG_MODE="login",DLG_BUSY=false;
function openDlg(){DLG_MODE=SESS?(PROFILE?"in":"nick"):"login";renderDlg();
  $("accDlg").showModal();const f=$("accDlg").querySelector("input");if(f)f.focus()}
function setErr(m){const e=$("accDlg").querySelector(".derr");if(e)e.textContent=m||""}
function setBusy(on){DLG_BUSY=on;
  $("accDlg").querySelectorAll("button").forEach(b=>b.disabled=on)}
function renderDlg(){const d=$("accDlg");let h;
  if(DLG_MODE==="in"){
    h=`<h3>${esc(PROFILE.nickname)}</h3><p class="dmut">${esc(SESS.user.email)}</p>
      <p class="dmut">${t("accSync")}</p><h4>${t("accBadges")}</h4>
      <div class="bdgs">${BADGE_DEFS.map(b=>
        `<span class="bdgchip${MY_BADGES.has(b[0])?"":" off"}">${b[1]} ${t("badge_"+b[0])}</span>`).join("")}</div>
      ${MY_BADGES.size?"":`<p class="dmut">${t("accNoBadges")}</p>`}
      <h4>${t("accRecords")}</h4>
      <div class="lbtabs rectabs" id="recTabs"></div>
      <div class="recbody" id="recBody"></div>
      <div class="dbtns"><button class="dbtn alt" id="dLogout">${t("accLogout")}</button>
        <button class="dbtn" id="dClose">${t("accClose")}</button></div>`}
  else if(DLG_MODE==="nick"){
    h=`<h3>${t("accTitle")}</h3><p class="dmut">${t("accNeedNick")}</p>
      <label class="fld">${t("accNick")}<input id="dNick" maxlength="20"></label>
      <label class="fld">${t("accInvite")}<input id="dInv" maxlength="40" autocomplete="off"></label>
      <p class="derr"></p>
      <div class="dbtns"><button class="dbtn" id="dGo">${t("accDoReg")}</button>
        <button class="dbtn alt" id="dClose">${t("accClose")}</button></div>`}
  else{const reg=DLG_MODE==="reg";
    h=`<h3>${reg?t("accDoReg"):t("accLogin")}</h3>
      ${reg?`<label class="fld">${t("accNick")}<input id="dNick" maxlength="20" autocomplete="nickname"></label>`:""}
      <label class="fld">${t("accEmail")}<input id="dEmail" type="email" autocomplete="email"></label>
      <label class="fld">${t("accPw")}<input id="dPw" type="password" autocomplete="${reg?"new-password":"current-password"}"></label>
      ${reg?`<label class="fld">${t("accInvite")}<input id="dInv" maxlength="40" autocomplete="off"></label>`:""}
      <p class="derr"></p>
      <div class="dbtns"><button class="dbtn" id="dGo">${reg?t("accDoReg"):t("accLogin")}</button>
        <button class="dbtn alt" id="dClose">${t("accClose")}</button></div>
      <button class="dlink" id="dSwap">${reg?t("accToLogin"):t("accToReg")}</button>`}
  d.innerHTML=h;
  const q=id=>d.querySelector("#"+id);
  if(q("dClose"))q("dClose").onclick=()=>d.close();
  if(q("dLogout"))q("dLogout").onclick=()=>doLogout();
  if(q("dSwap"))q("dSwap").onclick=()=>{DLG_MODE=DLG_MODE==="reg"?"login":"reg";renderDlg();
    const f=d.querySelector("input");if(f)f.focus()};
  if(q("dGo"))q("dGo").onclick=dlgSubmit;
  d.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();dlgSubmit()}}));
  if(DLG_MODE==="in"){renderRecTabs();loadRecs(REC_MODE)}}

/* ---------- personal records (best 5 per mode, in the account dialog) ---------- */
const recDate=iso=>new Date(iso).toLocaleDateString(LANG==="zh"?"zh-CN":"en-GB",{month:"short",day:"numeric"});
function renderRecTabs(){const el=$("recTabs");if(!el)return;
  el.innerHTML=LINES.map(L=>
    `<button class="lbtab${REC_MODE===L.id?" on":""}" data-m="${L.id}" style="--cc:${L.color};--cc-tx:${typeof txOn==="function"?txOn(L.color):"#0a0f1a"}">${t("lineName",L)}</button>`).join("")+
    `<button class="lbtab${REC_MODE==="boss"?" on":""}" data-m="boss" style="--cc:var(--bad)">${t("lbBoss")}</button>`;
  el.querySelectorAll(".lbtab").forEach(b=>
    b.onclick=()=>{REC_MODE=b.dataset.m;renderRecTabs();loadRecs(REC_MODE)})}
async function loadRecs(mode){if(!$("recBody"))return;
  if(REC_CACHE[mode]){paintRecs(REC_CACHE[mode]);return}
  $("recBody").innerHTML=`<p class="lbmsg">${t("lbLoading")}</p>`;
  try{const rows=await rest("GET",
      `scores?user_id=eq.${SESS.user.id}&mode=eq.${mode}&select=score,wpm,acc,stars,created_at&order=score.desc,created_at.asc&limit=5`);
    REC_CACHE[mode]=rows;if(mode===REC_MODE&&$("recBody"))paintRecs(rows)}
  catch(e){if($("recBody"))$("recBody").innerHTML=`<p class="lbmsg">${t("recErr")}</p>`}}
function paintRecs(rows){const el=$("recBody");
  if(!rows.length){el.innerHTML=`<p class="lbmsg">${t("recEmpty")}</p>`;return}
  el.innerHTML=rows.map((r,i)=>
    `<div class="lbrow${i?"":" me"}">
      <span class="lbrank">${i+1}</span>
      <span class="lbnick recwhen">${recDate(r.created_at)}<i>${"★".repeat(r.stars)}</i></span>
      <span class="lbsub">${r.wpm} wpm</span><span class="lbsub">${Math.round(r.acc)}%</span>
      <b class="lbscore">${r.score}</b></div>`).join("")}
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
      if(nick.length<2){setErr(t("accNickShort"));return}
      if(!code){setErr(t("accNeedInvite"));return}
      setBusy(true);await claimNick(nick,code);loadBadges();d.close()}
    else if(DLG_MODE==="reg"){
      const nick=val("dNick"),email=val("dEmail"),pw=d.querySelector("#dPw").value,code=val("dInv");
      if(nick.length<2){setErr(t("accNickShort"));return}
      if(pw.length<6){setErr(t("accWeakPw"));return}
      if(!code){setErr(t("accNeedInvite"));return}
      setBusy(true);
      // reject bad invites and taken nicknames before creating the account
      if((await rest("POST","rpc/check_invite",{p_code:code}))!==true){
        setBusy(false);setErr(t("accBadInvite"));return}
      try{const hit=await rest("GET",
        `profiles?select=id&nickname=ilike.${encodeURIComponent(nick.replace(/[%_\\]/g,""))}&limit=1`);
        if(hit&&hit.length){setBusy(false);setErr(t("accNickTaken"));return}}catch(e){}
      const j=await authReq("signup",{email,password:pw});
      if(!j.access_token)throw{code:"",msg:t("accConfirm")};
      saveSess(j);
      try{await claimNick(nick,code)}
      catch(e){setBusy(false);DLG_MODE="nick";renderDlg();setErr(mapErr(e));return}
      d.close()}
    else{
      const email=val("dEmail"),pw=d.querySelector("#dPw").value;
      setBusy(true);
      saveSess(await authReq("token?grant_type=password",{email,password:pw}));
      await afterLogin();
      if(!PROFILE){setBusy(false);DLG_MODE="nick";renderDlg();return}
      d.close()}
    updAccBtn();LB_CACHE={};REC_CACHE={};loadLb(LB_MODE)}
  catch(e){
    if(e&&e.code==="23503"){ // session points at a deleted auth user — start over
      saveSess(null);PROFILE=null;MY_BADGES=new Set();updAccBtn();
      DLG_MODE="reg";renderDlg();setErr(t("accStale"))}
    else setErr(mapErr(e))}
  finally{setBusy(false)}}

/* ---------- header button + i18n refresh ---------- */
function updAccBtn(){const b=$("accBtn");
  b.textContent=PROFILE?PROFILE.nickname:t("accLogin");
  b.classList.toggle("on",!!PROFILE)}
function cloudLangRefresh(){updAccBtn();renderLbTabs();
  if(LB_CACHE[LB_MODE])paintLb(LB_CACHE[LB_MODE]);
  paintCloudNote();
  if($("accDlg").open)renderDlg()}

/* ---------- boot ---------- */
(function cloudBoot(){
  $("accBtn").onclick=openDlg;
  $("langBtn").addEventListener("click",queuePrefs);
  $("themeBtn").addEventListener("click",queuePrefs);
  const back=()=>{if(!LB_CACHE[LB_MODE])loadLb(LB_MODE)};
  $("rBack").addEventListener("click",back);$("homeBtn").addEventListener("click",back);
  renderLbTabs();loadLb(LB_MODE);
  updAccBtn();
  if(SESS)ensureToken().then(tk=>{if(tk)afterLogin().catch(()=>{})});
})();
