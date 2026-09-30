/* Monarch Healing — accounts, bookings and calendar helpers (needs js/site.js and js/vendor/supabase) */
const MH = (() => {
  const cfg = MH_CONFIG;
  const connected = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const sb = connected ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  }) : null;

  /* ---------- plain-language errors ---------- */
  const MESSAGES = {
    slot_taken: "That time was just taken. Please choose another time.",
    too_soon: "Sessions need to be booked at least 12 hours ahead. Please choose a later time.",
    too_far: "Sessions can be booked up to 60 days ahead.",
    not_open: "That time isn't open. Please choose another time.",
    choose_time: "Please choose a date and time.",
    too_many_requests: "You already have 5 requests waiting for confirmation. Monika will get back to you soon.",
    already_waitlisted: "You're already on this waitlist.",
    late_cancel: "This session starts within 24 hours, so it can't be cancelled online. Please contact Monika.",
    late_change: "This session starts within 24 hours, so it can't be moved online. Please contact Monika.",
    not_found: "We couldn't find that booking.",
    not_active: "This booking can no longer be changed.",
    sign_in_required: "Please sign in first.",
    admins_only: "Only the practice can do that.",
    practitioner_unavailable: "That practitioner doesn't offer this therapy.",
    location_unavailable: "This therapy isn't offered at that location.",
    unknown_therapy: "That therapy isn't available for booking."
  };
  function explain(err){
    const m = (err && (err.message || err.error_description || String(err))) || "";
    for (const k in MESSAGES) if (m.includes(k)) return MESSAGES[k];
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
    if (/token.*(expired|invalid)|otp/i.test(m)) return "That code didn't work or has expired. Request a new one.";
    if (/fetch|network/i.test(m)) return "We couldn't reach the booking system. Check your connection and try again.";
    return "Something went wrong. Please try again, or email " + MONIKA_EMAIL + ".";
  }
  const must = ({ data, error }) => { if (error) throw error; return data; };

  /* ---------- auth ---------- */
  async function session(){ if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; }
  async function user(){ const s = await session(); return s ? s.user : null; }
  async function sendCode(email, meta){
    return must(await sb.auth.signInWithOtp({ email, options: {
      shouldCreateUser: true, data: meta || {}, emailRedirectTo: cfg.siteUrl + "/account.html"
    }}));
  }
  async function verifyCode(email, token){ return must(await sb.auth.verifyOtp({ email, token: String(token).trim(), type: "email" })); }
  async function signOut(){ if (sb) await sb.auth.signOut(); }
  const onAuth = fn => sb && sb.auth.onAuthStateChange((_e, s) => fn(s ? s.user : null));

  /* ---------- data ---------- */
  async function profile(){ const u = await user(); if (!u) return null;
    return must(await sb.from("profiles").select("id,email,full_name,phone").eq("id", u.id).maybeSingle()); }
  async function saveProfile(p){ const u = await user();
    return must(await sb.from("profiles").update({ full_name: p.full_name, phone: p.phone }).eq("id", u.id)); }
  async function slots(practitioner, therapy, from, days){
    return must(await sb.rpc("available_slots", { p_practitioner: practitioner, p_therapy: therapy, p_from: from || null, p_days: days || 21 })) || [];
  }
  async function request(b){
    return must(await sb.rpc("request_booking", { p_therapy: b.therapy, p_practitioner: b.practitioner, p_location: b.location,
      p_format: b.format || "Individual", p_date: b.date || null, p_time: b.time || null, p_notes: b.notes || null, p_first_visit: !!b.first }));
  }
  async function myBookings(){
    return must(await sb.from("bookings").select("*").order("starts_at", { ascending: true, nullsFirst: true })) || [];
  }
  const cancel = id => sb.rpc("cancel_booking", { p_id: id }).then(must);
  const reschedule = (id, date, time) => sb.rpc("reschedule_booking", { p_id: id, p_date: date, p_time: time }).then(must);
  const address = id => sb.rpc("booking_address", { p_id: id }).then(must);
  async function isAdmin(){ if (!(await user())) return false; try { return !!must(await sb.rpc("is_admin")); } catch { return false; } }
  const setStatus = (id, status) => sb.rpc("admin_set_status", { p_id: id, p_status: status }).then(must);
  async function allBookings(){ return must(await sb.from("bookings").select("*").order("starts_at", { ascending: true, nullsFirst: false })) || []; }
  async function profilesFor(ids){ if (!ids.length) return [];
    return must(await sb.from("profiles").select("id,email,full_name,phone").in("id", ids)) || []; }

  /* ---------- pending booking (kept while someone signs in) ---------- */
  const PKEY = "mh_pending_booking";
  const savePending = b => { try { localStorage.setItem(PKEY, JSON.stringify({ ...b, at: Date.now() })); } catch {} };
  function takePending(){ try { const v = JSON.parse(localStorage.getItem(PKEY) || "null"); localStorage.removeItem(PKEY);
    return v && Date.now() - v.at < 864e5 ? v : null; } catch { return null; } }

  /* ---------- time formatting in Vancouver time ---------- */
  const tz = cfg.timeZone;
  const fmt = (iso, o) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...o }).format(new Date(iso));
  const clock = iso => { const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
    const g = t => (p.find(x => x.type === t) || {}).value || ""; return g("hour") + ":" + g("minute") + " " + g("dayPeriod").toLowerCase(); };
  const when = iso => fmt(iso, { weekday: "long", month: "long", day: "numeric" }) + " at " + clock(iso);
  const parts = iso => ({ mon: fmt(iso, { month: "short" }).replace(".", ""), day: fmt(iso, { day: "numeric" }), dow: fmt(iso, { weekday: "short" }).replace(".", ""), time: clock(iso) });
  const hoursUntil = iso => (new Date(iso) - Date.now()) / 36e5;

  /* ---------- add to calendar ---------- */
  const icsStamp = iso => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  function eventFor(b, addr){
    const t = byId(THERAPIES, b.therapy_id) || { name: b.therapy_id };
    const p = byId(PRACTITIONERS, b.practitioner_id) || { name: "Monarch Healing" };
    const l = byId(LOCATIONS, b.location_id) || { name: "" };
    const remote = b.location_id === "distance";
    const title = t.name + " with " + p.name.split(" ")[0] + (b.status === "requested" ? " (awaiting confirmation)" : "");
    const where = remote ? "Phone or video. Monika will send the details." : (addr || (l.name + ", " + (l.area || "North Vancouver, BC")));
    const details = [
      "Monarch Healing · " + t.name,
      "With " + p.name + " · " + l.name + (b.format && b.format !== "Individual" ? " · " + b.format : ""),
      b.status === "requested" ? "This time is requested. Monika will confirm it by email." : "",
      "Need to change it? " + cfg.siteUrl + "/account.html",
      "Changes and cancellations up to " + cfg.cancelHours + " hours before."
    ].filter(Boolean).join("\n");
    return { uid: b.id + "@monarch-healing.com", title, where, details, start: b.starts_at, end: b.ends_at, tentative: b.status === "requested" };
  }
  function googleUrl(e){
    const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: icsStamp(e.start) + "/" + icsStamp(e.end), details: e.details, location: e.where, ctz: tz });
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }
  function outlookUrl(e){
    const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: e.title, startdt: new Date(e.start).toISOString(), enddt: new Date(e.end).toISOString(), body: e.details, location: e.where });
    return "https://outlook.live.com/calendar/0/action/compose?" + q.toString();
  }
  function icsText(e){
    const escI = s => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m);
    const fold = l => l.length <= 74 ? l : l.match(/.{1,74}/g).join("\r\n ");
    return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Monarch Healing//Bookings//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",
      "BEGIN:VEVENT","UID:" + e.uid,"DTSTAMP:" + icsStamp(new Date().toISOString()),"DTSTART:" + icsStamp(e.start),"DTEND:" + icsStamp(e.end),
      "SUMMARY:" + escI(e.title),"LOCATION:" + escI(e.where),"DESCRIPTION:" + escI(e.details),"STATUS:" + (e.tentative ? "TENTATIVE" : "CONFIRMED"),
      "BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:" + escI(e.title),"TRIGGER:-PT2H","END:VALARM",
      "END:VEVENT","END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
  }
  function downloadIcs(e){
    const blob = new Blob([icsText(e)], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "monarch-healing-" + icsStamp(e.start).slice(0, 8) + ".ics";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  /* markup for an "Add to calendar" menu; wire with MH.bindCalendar(container, bookingsById) */
  const calendarMenu = id => `<details class="cal"><summary class="mini-btn">Add to calendar</summary><div class="cal-menu" role="menu">
      <a role="menuitem" data-cal="google" data-id="${id}" href="#" target="_blank" rel="noopener">Google Calendar</a>
      <a role="menuitem" data-cal="apple" data-id="${id}" href="#">Apple Calendar (.ics)</a>
      <a role="menuitem" data-cal="outlook" data-id="${id}" href="#" target="_blank" rel="noopener">Outlook.com</a>
      <a role="menuitem" data-cal="ics" data-id="${id}" href="#">Other calendar (.ics)</a></div></details>`;
  function bindCalendar(root, getBooking){
    root.addEventListener("click", async ev => {
      const a = ev.target.closest("[data-cal]"); if (!a) return;
      const b = getBooking(a.dataset.id); if (!b) return;
      let addr = null; if (b.status === "confirmed" && b.location_id !== "distance") { try { addr = await address(b.id); } catch {} }
      const e = eventFor(b, addr);
      if (a.dataset.cal === "google" || a.dataset.cal === "outlook") {
        ev.preventDefault(); window.open(a.dataset.cal === "google" ? googleUrl(e) : outlookUrl(e), "_blank", "noopener");
      } else { ev.preventDefault(); downloadIcs(e); }
      a.closest("details").open = false;
    });
    document.addEventListener("click", ev => root.querySelectorAll("details.cal[open]").forEach(d => { if (!d.contains(ev.target)) d.open = false; }));
  }

  /* ---------- nav: Sign in / My sessions ---------- */
  async function paintNav(){
    const el = document.getElementById("acctLink"); if (!el) return;
    if (!connected) { el.hidden = true; return; }
    const u = await user();
    const label = u ? "My sessions" : "Sign in"; el.hidden = false; el.href = "account.html"; el.setAttribute("aria-label", label); const l = el.querySelector(".lbl"); if (l) l.textContent = label; else el.textContent = label;
  }
  if (connected) { document.addEventListener("DOMContentLoaded", paintNav); onAuth(paintNav); }

  return { connected, sb, explain, session, user, sendCode, verifyCode, signOut, onAuth, profile, saveProfile, slots, request,
    myBookings, cancel, reschedule, address, isAdmin, setStatus, allBookings, profilesFor, savePending, takePending,
    when, parts, hoursUntil, eventFor, googleUrl, outlookUrl, icsText, downloadIcs, calendarMenu, bindCalendar, paintNav };
})();
