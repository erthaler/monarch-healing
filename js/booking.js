/* Monarch Healing — booking steps, shared by the main page (energy work) and the massage therapy page.
   The page sets BOOK_THERAPIES before this file loads and provides the booking markup (#cTherapy, #s1…#s4, #submitBtn …). */
if(typeof BOOK_THERAPIES==="undefined")var BOOK_THERAPIES=THERAPIES;
/* ---------- booking ---------- */
const S={therapy:null,ther:null,loc:null,format:"Individual",date:null,time:null};
let slotMap=null, slotKey="", slotErr="";   // live open times from the booking database: Map(date -> ["10:00",…])
let me=null, meProfile=null, codeSentTo=null, pending=null, busy=false;

function choice(label,small,pressed,attrs,disabled){return `<button type="button" class="choice" aria-pressed="${pressed}" ${attrs} ${disabled?"disabled":""}><span>${label}</span>${small?`<small>${small}</small>`:""}</button>`}
function fallbackDays(){const out=[];const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+1);while(out.length<14){if(HOURS[d.getDay()])out.push(ymd(d));d.setDate(d.getDate()+1)}return out}

async function loadSlots(){
  const t=byId(BOOK_THERAPIES,S.therapy);
  if(!MH.connected||!t||t.soon||!S.ther)return;
  const key=S.ther+"|"+S.therapy; if(key===slotKey&&slotMap)return;
  slotKey=key;slotMap=null;slotErr="";renderBooking();
  try{const rows=await MH.slots(S.ther,S.therapy,null,28);if(slotKey!==key)return;
    slotMap=new Map();rows.forEach(r=>{const tm=String(r.slot_time).slice(0,5);if(!slotMap.has(r.slot_date))slotMap.set(r.slot_date,[]);slotMap.get(r.slot_date).push(tm)});
  }catch(e){slotMap=new Map();slotErr=MH.explain(e)}
  if(S.date&&!(slotMap.get(S.date)||[]).includes(S.time))S.time=null;
  renderBooking();
}

function renderBooking(){
  const t=byId(BOOK_THERAPIES,S.therapy);
  $("#cTherapy").innerHTML=BOOK_THERAPIES.map(x=>choice(esc(x.name),x.soon?"Waitlist":x.price+" · "+x.mins+" min",S.therapy===x.id,`data-t="${x.id}"`)).join("");
  const thers=t?PRACTITIONERS.filter(p=>p.therapies.includes(t.id)):[];
  $("#cTher").innerHTML=t?thers.map(p=>choice(esc(p.name),esc(p.role.split("·")[1]||p.role),S.ther===p.id,`data-p="${p.id}"`)).join(""):'<p class="muted">Choose a therapy first.</p>';
  $("#cLoc").innerHTML=t?LOCATIONS.filter(l=>!l.future&&t.modes.includes(l.id)).map(l=>choice(esc(l.name),esc(l.area),S.loc===l.id,`data-l="${l.id}"`)).join(""):"";
  $("#cFormat").innerHTML=t&&!t.soon&&t.formats!==false?FORMATS.map(f=>choice(f,"",S.format===f,`data-f="${f}"`)).join(""):"";
  const waitlist=t&&t.soon;
  $("#s3").hidden=!!waitlist;
  if(!waitlist){
    const ready=S.ther&&S.loc;
    let dayList=[],timesFor=()=>[];
    if(MH.connected){if(slotMap){dayList=[...slotMap.keys()].slice(0,14);timesFor=d=>slotMap.get(d)||[]}}
    else{dayList=fallbackDays();timesFor=d=>{const [y,m,dd]=d.split("-").map(Number);return HOURS[new Date(y,m-1,dd).getDay()]||[]}}
    let daysHtml;
    if(!ready)daysHtml='<p class="muted">Choose a practitioner and location.</p>';
    else if(MH.connected&&!slotMap)daysHtml='<p class="muted">Finding open times…</p>';
    else if(slotErr)daysHtml=`<p class="muted">${esc(slotErr)}</p>`;
    else if(!dayList.length)daysHtml=`<p class="muted">No open times in the next four weeks. Email ${esc(MONIKA_EMAIL)} and Monika will find one for you.</p>`;
    else daysHtml=dayList.map(k=>{const [y,m,dd]=k.split("-").map(Number);const d=new Date(y,m-1,dd);return `<button type="button" class="choice day" aria-pressed="${S.date===k}" data-d="${k}"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b><small>${MON[d.getMonth()]}</small></button>`}).join("");
    $("#cDays").innerHTML=daysHtml;
    $("#cTimes").innerHTML=ready&&S.date?timesFor(S.date).map(h=>choice(fmtTime(h),"",S.time===h,`data-h="${h}"`)).join("")+(MH.connected?'<p class="muted tz-note">Pacific time</p>':""):"";
  }
  $("#s1").dataset.done=!!t;
  $("#s2").dataset.done=!!(S.ther&&S.loc);$("#s2").dataset.locked=!t;
  $("#s3").dataset.done=!!(S.date&&S.time);$("#s3").dataset.locked=!(S.ther&&S.loc);
  $("#s4").querySelector(".n").textContent=waitlist?"3":"4";
  renderDetails();
  renderSummary();
}

/* step 4: who is booking */
function renderDetails(){
  const signedIn=!!me, name=(meProfile&&meProfile.full_name)||"";
  $("#whoBox").hidden=!signedIn;
  if(signedIn)$("#whoBox").innerHTML=`<span>Booking as <b>${esc(name||me.email)}</b>${name?` · ${esc(me.email)}`:""}</span><button type="button" class="linkish" id="switchUser">Not you?</button>`;
  const needContact=!signedIn;
  ["lName","lPhone","lEmail"].forEach(id=>$("#"+id).hidden=!needContact);
  if(signedIn&&!name){$("#lName").hidden=false;$("#lPhone").hidden=false}
  $("#codeBox").hidden=!(MH.connected&&codeSentTo&&!signedIn);
  if(codeSentTo)$("#codeTo").textContent=codeSentTo;
}
function detailsOk(){
  const nameOk=(me&&meProfile&&meProfile.full_name)||$("#fName").value.trim().length>1;
  const emailOk=me||/^\S+@\S+\.\S+$/.test($("#fEmail").value.trim());
  return nameOk&&emailOk&&$("#fPolicy").checked;
}
function renderSummary(){
  const t=byId(BOOK_THERAPIES,S.therapy),p=byId(PRACTITIONERS,S.ther),l=byId(LOCATIONS,S.loc);
  $("#sumTitle").textContent=t?t.name:"Choose a therapy";
  const rows=[];
  if(t)rows.push(["Length",t.soon?"30, 60 or 90 min":t.mins+" min"],["Fee",t.price]);
  if(p)rows.push(["With",p.name]);
  if(l)rows.push(["Where",l.name]);
  if(t&&!t.soon&&t.formats!==false)rows.push(["Format",S.format]);
  if(S.date)rows.push(["When",fmtDate(S.date)+(S.time?" · "+fmtTime(S.time):"")]);
  $("#sumList").innerHTML=rows.map(r=>`<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join("");
  const waitlist=t&&t.soon;
  const ok=t&&p&&l&&(waitlist||(S.date&&S.time))&&detailsOk()&&!busy&&!(codeSentTo&&!me);
  const btn=$("#submitBtn");btn.disabled=!ok;
  btn.textContent=busy?"Sending…":(MH.connected&&!me)?"Continue: email me a code":waitlist?"Join the waitlist":"Request booking";
  $("#sumNote").textContent=waitlist?"You'll hear first when booking opens. No commitment.":
    (MH.connected&&!me)?"We'll email you a 6-digit code to create your account or sign in. No password needed.":"Nothing is charged online. Payment is taken at your session.";
}

document.addEventListener("click",e=>{
  if(e.target.closest("#switchUser")){MH.signOut().then(()=>{me=null;meProfile=null;renderBooking()});return}
  const b=e.target.closest("button.choice,[data-pick],[data-quick]");if(!b)return;
  if(b.dataset.pick||b.dataset.quick){const id=b.dataset.pick||b.dataset.quick;pickTherapy(id);if(b.dataset.pick)($("#book")||$("#bookRmt")).scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});return}
  if(b.dataset.t)pickTherapy(b.dataset.t);
  else if(b.dataset.p){S.ther=b.dataset.p;S.date=S.time=null;slotKey=""}
  else if(b.dataset.l){S.loc=b.dataset.l}
  else if(b.dataset.f){S.format=b.dataset.f}
  else if(b.dataset.d){S.date=b.dataset.d;S.time=null}
  else if(b.dataset.h){S.time=b.dataset.h}
  renderBooking();loadSlots();
});
document.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.dataset&&e.target.dataset.pick){e.preventDefault();e.target.click()}});
function pickTherapy(id){const t=byId(BOOK_THERAPIES,id);S.therapy=id;const ps=PRACTITIONERS.filter(p=>p.therapies.includes(id));S.ther=ps.length===1?ps[0].id:null;const ls=LOCATIONS.filter(l=>!l.future&&t.modes.includes(l.id));S.loc=ls.length===1?ls[0].id:(ls.find(l=>l.id===S.loc)?S.loc:null);S.date=S.time=null;slotKey="";renderBooking();loadSlots()}
["fName","fEmail","fPhone","fPolicy","fFirst","fNotes"].forEach(id=>document.getElementById(id).addEventListener("input",renderSummary));
$("#details").addEventListener("submit",e=>e.preventDefault());

function currentBooking(){
  const t=byId(BOOK_THERAPIES,S.therapy);
  return {therapy:t.id,practitioner:S.ther,location:S.loc,format:t.soon||t.formats===false?"Individual":S.format,
    date:t.soon?null:S.date,time:t.soon?null:S.time,notes:$("#fNotes").value.trim().slice(0,1000),first:$("#fFirst").checked};
}
function say(html,kind){const m=$("#statusMsg");m.innerHTML=html;m.hidden=false;m.dataset.kind=kind||""}

$("#submitBtn").addEventListener("click",async()=>{
  const t=byId(BOOK_THERAPIES,S.therapy);const b=currentBooking();
  if(!MH.connected)return emailFallback(t,b);
  busy=true;renderSummary();
  try{
    if(!me){
      const email=$("#fEmail").value.trim(), name=$("#fName").value.trim(), phone=$("#fPhone").value.trim();
      pending={...b,name,phone};MH.savePending(pending);
      await MH.sendCode(email,{full_name:name,phone});
      codeSentTo=email;renderDetails();
      say(`We sent a 6-digit code to <b>${esc(email)}</b>. Enter it in step ${t.soon?3:4} to finish booking.`);
      setTimeout(()=>$("#fCode").focus(),50);
    }else{
      if(meProfile&&!meProfile.full_name&&$("#fName").value.trim()){await MH.saveProfile({full_name:$("#fName").value.trim(),phone:$("#fPhone").value.trim()||null});meProfile=await MH.profile()}
      await finishBooking(b);
    }
  }catch(err){say(esc(MH.explain(err)),"error");if(/slot_taken|not_open|too_soon/.test(err.message||"")){S.time=null;slotKey="";loadSlots()}}
  busy=false;renderSummary();
});

$("#verifyBtn").addEventListener("click",verify);
$("#fCode").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();verify()}});
$("#resendBtn").addEventListener("click",async()=>{try{await MH.sendCode(codeSentTo);toast("New code sent")}catch(err){say(esc(MH.explain(err)),"error")}});
$("#changeEmail").addEventListener("click",()=>{codeSentTo=null;renderDetails();renderSummary();$("#fEmail").focus()});
async function verify(){
  const code=$("#fCode").value.replace(/\D/g,"");if(code.length<6){say("Enter the 6-digit code from the email.","error");return}
  busy=true;renderSummary();$("#verifyBtn").disabled=true;
  try{
    await MH.verifyCode(codeSentTo,code);
    await refreshMe();
    if(meProfile&&!meProfile.full_name&&pending&&pending.name){await MH.saveProfile({full_name:pending.name,phone:pending.phone||null});meProfile=await MH.profile()}
    codeSentTo=null;renderDetails();
    const b=pending?{...pending}:currentBooking();MH.takePending();
    await finishBooking(b);
  }catch(err){say(esc(MH.explain(err)),"error")}
  busy=false;$("#verifyBtn").disabled=false;renderBooking();
}

async function finishBooking(b){
  const rect=$("#submitBtn").getBoundingClientRect();
  const id=await MH.request(b);MH.takePending();pending=null;
  const t=byId(BOOK_THERAPIES,b.therapy);
  let row=null;try{row=(await MH.myBookings()).find(x=>x.id===id)}catch{}
  const when=row&&row.starts_at?MH.when(row.starts_at):"";
  say(t.soon?`You're on the waitlist for ${esc(t.name)}. Monika will be in touch when booking opens. <a href="account.html">See my sessions</a>`:
    `<b>Requested for ${esc(when)}.</b> Monika will confirm by email, usually within a day.<span class="done-actions">${row?MH.calendarMenu(row.id):""}<a class="mini-btn" href="account.html">My sessions</a></span>`,"ok");
  if(row)lastRows[row.id]=row;
  if(typeof liftoff==="function")liftoff(rect);toast(t.soon?"Added to the waitlist":"Booking requested");
  S.date=S.time=null;slotKey="";$("#fNotes").value="";renderBooking();loadSlots();
}
const lastRows={};
if(MH.connected)MH.bindCalendar($("#statusMsg"),id=>lastRows[id]);

function emailFallback(t,b){
  const contact={name:$("#fName").value.trim(),email:$("#fEmail").value.trim(),phone:$("#fPhone").value.trim()};
  const th=byId(PRACTITIONERS,b.practitioner),lo=byId(LOCATIONS,b.location);
  const lines=[(t.soon?"Waitlist request":"Booking request")+" — "+t.name,"","Name: "+contact.name,"Email: "+contact.email,"Phone: "+(contact.phone||"—"),
    "Practitioner: "+(th?th.name:""),"Location: "+(lo?lo.name:""),t.soon?"":"Format: "+b.format,t.soon?"":"Requested time: "+fmtDate(b.date)+" at "+fmtTime(b.time),
    "First session: "+(b.first?"Yes":"No"),"","Notes: "+(b.notes||"—")].filter(x=>x!=="");
  const subj=(t.soon?"Waitlist: ":"Booking request: ")+t.name+(b.date?" · "+fmtDate(b.date)+" "+fmtTime(b.time):"");
  location.href="mailto:"+MONIKA_EMAIL+"?subject="+encodeURIComponent(subj)+"&body="+encodeURIComponent(lines.join("\n"));
  say("Your email app should open with the request ready to send. If it didn't, email <strong>"+MONIKA_EMAIL+"</strong> with the details above.");
  if(typeof liftoff==="function")liftoff($("#submitBtn").getBoundingClientRect());
}

async function refreshMe(){me=await MH.user();meProfile=me?await MH.profile().catch(()=>null):null}
if(MH.connected){if($("#bookLede"))$("#bookLede").textContent="Monika confirms every booking personally, usually within a day. Your free account keeps your sessions in one place, where you can move them, cancel them or add them to your calendar.";refreshMe().then(renderBooking);MH.onAuth(()=>refreshMe().then(renderBooking))}


renderBooking();
