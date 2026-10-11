/* Monarch Healing — shared site content and helpers (loaded by every page) */

/* ---------- connection to the booking database (Supabase) ----------
   Paste the Project URL and the anon / publishable key from Supabase → Project Settings → API.
   Both are designed to be public; the database rules protect the data. Never put the service_role key here. */
const MH_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  timeZone: "America/Vancouver",
  siteUrl: "https://monarch-healing.com",
  cancelHours: 24,
  /* Massage therapy page: keep false until Monika's registration with CCHPBC is active.
     Turning it on also needs the RMT therapies set to bookable in Supabase (see supabase/seed.sql). */
  rmtOpen: false
};

/* ---------- practice data: therapies, practitioners, locations ---------- */
const MONIKA_EMAIL = "contactmonarchhealing@gmail.com";
/* Intuitive and energy work: booked on the main page */
const THERAPIES = [
  {id:"call",name:"Free check-in call",path:"guidance",mins:20,price:"Free",modes:["distance"],formats:false,desc:"A short phone call to talk through what you need and choose the right session.",tags:["Phone"]},
  {id:"qlg",name:"Quantum Life Guidance",path:"guidance",mins:75,price:"$150–250",modes:["nv","distance"],desc:"Intuitive guidance to clear old patterns, beliefs and pain, in person or at a distance. Can be combined with hands-on energy work.",tags:["In person","Distance","Couples","Groups"]},
  {id:"acu",name:"Jin Shin Do® acupressure",path:"hands",mins:60,price:"$150–250",modes:["nv"],desc:"A Japanese acupressure method. Gentle, held pressure on points along the meridians restores flow and releases emotional and physical blockages, tailored to what needs attention now.",tags:["In person"]},
  {id:"reflex",name:"Reflexology",path:"hands",mins:60,price:"$150–250",modes:["nv"],desc:"Precise pressure on the feet, where a map of the whole body and its systems can be reached.",tags:["In person"]}
];
/* Registered Massage Therapy: kept separate, on massage-therapy.html, and only bookable once MH_CONFIG.rmtOpen is true */
const RMT_THERAPIES = [
  {id:"rmt30",name:"Massage therapy · 30 min",path:"rmt",mins:30,price:"Set at opening",modes:["nv"],formats:false,desc:"A focused treatment for one area.",tags:["In person"]},
  {id:"rmt60",name:"Massage therapy · 60 min",path:"rmt",mins:60,price:"Set at opening",modes:["nv"],formats:false,desc:"Assessment and treatment for several areas.",tags:["In person"]},
  {id:"rmt90",name:"Massage therapy · 90 min",path:"rmt",mins:90,price:"Set at opening",modes:["nv"],formats:false,desc:"A longer treatment with time for assessment and home care advice.",tags:["In person"]},
  {id:"stone",name:"Hot stone massage therapy · 90 min",path:"rmt",mins:90,price:"Set at opening",modes:["nv"],formats:false,desc:"Massage therapy using heated basalt stones.",tags:["In person"]}
];
const ALL_THERAPIES = THERAPIES.concat(RMT_THERAPIES);
const PRACTITIONERS = [
  {id:"monika",name:"Monika Kulaga",role:"Founder · Lead practitioner",photo:"img/portrait.jpg",therapies:["call","qlg","acu","reflex","rmt30","rmt60","rmt90","stone"],bio:"Intuitive guide and Quantum Life Guidance practitioner, Jin Shin Do® acupressure practitioner and reflexologist, currently completing her massage therapy training in BC."}
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
