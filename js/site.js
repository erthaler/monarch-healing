/* Monarch Healing — shared site content and helpers (loaded by every page) */

/* ---------- connection to the booking database (Supabase) ----------
   Paste the Project URL and the anon / publishable key from Supabase → Project Settings → API.
   Both are designed to be public; the database rules protect the data. Never put the service_role key here. */
const MH_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  timeZone: "America/Vancouver",
  siteUrl: "https://monarch-healing.com",
  cancelHours: 24
};

/* ---------- practice data: therapies, practitioners, locations ---------- */
const MONIKA_EMAIL = "contactmonarchhealing@gmail.com";
const THERAPIES = [
  {id:"call",name:"Free check-in call",path:"energy",mins:20,price:"Free",modes:["distance"],desc:"A short phone call to talk through what you need and choose the right session.",tags:["Phone"]},
  {id:"qlg",name:"Quantum Life Guidance",path:"energy",mins:75,price:"$150–250",modes:["nv","distance"],desc:"Intuitive guidance to clear old patterns, beliefs and pain, in person or at a distance. Can be combined with any bodywork.",tags:["In person","Distance","Couples","Groups"]},
  {id:"acu",name:"Jin Shin Do® acupressure",path:"energy",mins:60,price:"$150–250",modes:["nv"],desc:"A Japanese acupressure method. Gentle, held pressure on points along the meridians restores flow and releases emotional and physical blockages, tailored to what needs attention now.",tags:["In person"]},
  {id:"reflex",name:"Reflexology",path:"energy",mins:60,price:"$150–250",modes:["nv"],desc:"Precise pressure on the feet, where a map of the whole body and its systems can be reached.",tags:["In person"]},
  {id:"rmt",name:"Registered Massage Therapy",path:"rmt",mins:60,price:"Rates at launch",modes:["nv"],soon:true,desc:"Clinical massage for pain, tension and recovery, with receipts for extended health plans.",tags:["30 · 60 · 90 min","Insurance receipts"]},
  {id:"stone",name:"Hot stone massage",path:"rmt",mins:90,price:"Rates at launch",modes:["nv"],soon:true,desc:"Warm basalt stones relax deep muscle, ease tension and leave the whole body calm and energized.",tags:["90 min"]}
];
const PRACTITIONERS = [
  {id:"monika",name:"Monika Kulaga",role:"Founder · Lead practitioner",photo:"img/portrait.jpg",therapies:["call","qlg","acu","reflex","rmt","stone"],bio:"Intuitive guide and Quantum Life Guidance practitioner, Jin Shin Do® acupressure practitioner and reflexologist, completing her RMT training in BC."}
];
const LOCATIONS = [
  {id:"nv",name:"North Vancouver studio",area:"North Vancouver, BC",desc:"A quiet treatment room for bodywork and in-person guidance. The address is sent with your confirmation."},
  {id:"distance",name:"Distance session",area:"Phone or video, anywhere",desc:"Quantum Life Guidance and check-in calls, wherever you are."},
  {id:"next",name:"Your community next",area:"Vancouver · Tri-Cities · Fraser Valley",future:true,desc:"New Monarch Healing studios will open with partner practitioners. Tell us where you'd like one."}
];
/* Real client words only, shared with permission. Add entries like:
   {quote:"…", name:"Jane D.", detail:"Quantum Life Guidance · 2026"} */
const TESTIMONIALS = [
  {quote:"Monika has helped me understand how my past traumas can become the very reason I overcome future challenges in my life.",name:"Andre",detail:"Jin Shin Do® acupressure"}
];
const SAMPLE_TESTIMONIALS = [];
const FORMATS = ["Individual","Couples","Group","Walking"];
/* Only used when the booking database isn't connected (email-request fallback). The live hours are in Supabase → availability. */
const HOURS = {2:["10:00","11:30","13:30","15:00","16:30"],3:["10:00","11:30","13:30","15:00","16:30"],4:["12:00","13:30","15:00","16:30","18:00"],5:["10:00","11:30","13:30","15:00"],6:["10:00","11:30","13:30"]};

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const byId = (arr, id) => arr.find(x => x.id === id);
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = s => { if (!s) return ""; const [y,m,d] = s.split("-").map(Number); const dt = new Date(y, m-1, d); return DOW[dt.getDay()] + " " + MON[m-1] + " " + d; };
const fmtTime = t => { if (!t) return ""; let [h,m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + pad(m) + " " + ap; };
function toast(msg){ const t = $("#toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3600); }
function statusPill(s){ const m = {requested:["req","Awaiting confirmation"],confirmed:["open","Confirmed"],waitlist:["soon","Waitlist"],cancelled:["no","Cancelled"],completed:["no","Completed"],no_show:["no","Missed"]}[s] || ["no", s]; return `<span class="pill ${m[0]}">${m[1]}</span>`; }

/* mobile menu (every page) */
document.addEventListener("DOMContentLoaded", () => {
  const b = $("#menuBtn"), m = $("#navLinks"); if (!b || !m) return;
  const set = o => { m.classList.toggle("open", o); b.setAttribute("aria-expanded", o); };
  b.addEventListener("click", () => set(!m.classList.contains("open")));
  m.addEventListener("click", e => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") set(false); });
});
