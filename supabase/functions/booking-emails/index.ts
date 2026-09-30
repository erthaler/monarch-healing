// Monarch Healing — booking emails (Supabase Edge Function)
//
// Sends an email whenever a booking is created or changes status:
//   • to the practice: new request, new time requested, client cancelled, joined waitlist
//   • to the client:   request received, confirmed (with calendar invite attached), cancelled by the practice
//
// Setup (Supabase dashboard):
//   1. Edge Functions → Deploy new function → name "booking-emails" → paste this file → Deploy.
//   2. Edge Functions → Secrets → add RESEND_API_KEY (from resend.com). Optional: PRACTICE_EMAIL, FROM_EMAIL.
//   3. Database → Webhooks → Create: table public.bookings, events INSERT + UPDATE,
//      type "Supabase Edge Functions", function booking-emails, and tick "Add auth header with service key".

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const PRACTICE_EMAIL = Deno.env.get("PRACTICE_EMAIL") ?? "contactmonarchhealing@gmail.com";
const FROM = Deno.env.get("FROM_EMAIL") ?? "Monarch Healing <bookings@monarch-healing.com>";
const SITE = "https://monarch-healing.com";
const TZ = "America/Vancouver";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Booking = {
  id: string; client_id: string; therapy_id: string; practitioner_id: string; location_id: string; format: string;
  starts_at: string | null; ends_at: string | null; status: string; notes: string | null; first_visit: boolean; cancelled_by: string | null;
};

const when = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(d);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${day} at ${g("hour")}:${g("minute")} ${g("dayPeriod").toLowerCase()} (Pacific time)`;
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function ics(b: Booking, title: string, where: string, cancel = false) {
  const e = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => "\\" + m);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Monarch Healing//Bookings//EN", `METHOD:${cancel ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT", `UID:${b.id}@monarch-healing.com`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.starts_at!)}`, `DTEND:${stamp(b.ends_at!)}`, `SUMMARY:${e(title)}`, `LOCATION:${e(where)}`,
    `DESCRIPTION:${e("Manage your sessions: " + SITE + "/account.html")}`, `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`, `SEQUENCE:${cancel ? 1 : 0}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${e(title)}`, "TRIGGER:-PT2H", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
}

function layout(heading: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#FAF4F6;font-family:Helvetica,Arial,sans-serif;color:#2B1A2C">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#D9661A;margin:0 0 8px">Monarch Healing</p>
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.2;margin:0 0 18px">${heading}</h1>
    <div style="background:#fff;border:1px solid #E6D6DF;border-radius:14px;padding:20px;font-size:15px;line-height:1.6">${body}</div>
    <p style="font-size:13px;color:#8C7A8B;margin-top:18px">Manage your sessions at <a href="${SITE}/account.html" style="color:#C9486E">${SITE.replace("https://", "")}/account</a>.
    Sessions can be moved or cancelled online up to 24 hours before they start.</p>
  </div></body></html>`;
}

async function send(to: string, subject: string, html: string, attach?: { name: string; content: string }) {
  if (!RESEND_API_KEY) { console.warn("RESEND_API_KEY missing; skipped", subject); return; }
  const body: Record<string, unknown> = { from: FROM, to: [to], subject, html, reply_to: PRACTICE_EMAIL };
  if (attach) body.attachments = [{ filename: attach.name, content: btoa(unescape(encodeURIComponent(attach.content))), content_type: "text/calendar" }];
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) console.error("Resend error", r.status, await r.text());
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const b: Booking = payload.record, old: Booking | null = payload.old_record ?? null;
    if (payload.table !== "bookings" || !b) return new Response("ignored");

    const changedTime = old && old.starts_at !== b.starts_at;
    const changedStatus = !old || old.status !== b.status;
    if (!changedTime && !changedStatus) return new Response("no change");

    const [{ data: client }, { data: therapy }, { data: prac }, { data: loc }] = await Promise.all([
      admin.from("profiles").select("email,full_name,phone").eq("id", b.client_id).single(),
      admin.from("therapies").select("name").eq("id", b.therapy_id).single(),
      admin.from("practitioners").select("name").eq("id", b.practitioner_id).single(),
      admin.from("locations").select("name,address,is_remote").eq("id", b.location_id).single(),
    ]);
    const name = client?.full_name || "there", first = name.split(" ")[0];
    const tname = therapy?.name ?? b.therapy_id, pname = prac?.name ?? "Monarch Healing";
    const where = loc?.is_remote ? "Phone or video (Monika will send the details)" : (loc?.address || `${loc?.name ?? ""}, North Vancouver, BC`);
    const whenTxt = b.starts_at ? when(b.starts_at) : "";
    const details = `<p style="margin:0"><b>${esc(tname)}</b> with ${esc(pname)}<br>${whenTxt ? esc(whenTxt) + "<br>" : ""}${esc(loc?.name ?? "")}${b.format && b.format !== "Individual" ? " · " + esc(b.format) : ""}</p>`;
    const clientLine = `<p style="margin:12px 0 0">${esc(client?.full_name ?? "")} · ${esc(client?.email ?? "")}${client?.phone ? " · " + esc(client.phone) : ""}${b.first_visit ? "<br><b>First visit</b>" : ""}${b.notes ? `<br>“${esc(b.notes)}”` : ""}</p>`;
    const toPractice = (subj: string, head: string) => send(PRACTICE_EMAIL, subj, layout(head, details + clientLine + `<p style="margin:16px 0 0"><a href="${SITE}/admin.html" style="color:#C9486E">Open the practice page</a></p>`));

    const jobs: Promise<unknown>[] = [];
    if (!old && b.status === "requested") {
      jobs.push(toPractice(`New request: ${tname} · ${whenTxt}`, "New booking request"));
      if (client?.email) jobs.push(send(client.email, `We received your request: ${tname}`, layout(`Thank you, ${esc(first)}.`, details + `<p style="margin:12px 0 0">Monika will confirm this time by email, usually within a day.</p>`)));
    } else if (!old && b.status === "waitlist") {
      jobs.push(toPractice(`Waitlist: ${tname}`, "New waitlist sign-up"));
      if (client?.email) jobs.push(send(client.email, `You're on the ${tname} waitlist`, layout(`You're on the list, ${esc(first)}.`, `<p style="margin:0">We'll let you know as soon as <b>${esc(tname)}</b> opens for booking.</p>`)));
    } else if (old && changedTime && b.status === "requested") {
      jobs.push(toPractice(`New time requested: ${tname} · ${whenTxt}`, "A client asked for a new time"));
    } else if (b.status === "confirmed" && changedStatus && client?.email) {
      jobs.push(send(client.email, `Confirmed: ${tname} · ${whenTxt}`, layout(`You're booked, ${esc(first)}.`, details +
        `<p style="margin:12px 0 0">Where: ${esc(where)}</p><p style="margin:12px 0 0">The attached invite adds it to your calendar.</p>`),
        b.starts_at ? { name: "monarch-healing.ics", content: ics(b, `${tname} with ${pname.split(" ")[0]}`, where) } : undefined));
    } else if (b.status === "cancelled" && changedStatus) {
      if (b.cancelled_by === "client") jobs.push(toPractice(`Cancelled by client: ${tname} · ${whenTxt}`, "A client cancelled"));
      else if (client?.email) jobs.push(send(client.email, `Cancelled: ${tname}${whenTxt ? " · " + whenTxt : ""}`, layout(`Your session was cancelled.`, details +
        `<p style="margin:12px 0 0">Monika had to cancel this session. Reply to this email or <a href="${SITE}/#book" style="color:#C9486E">choose another time</a>.</p>`),
        b.starts_at ? { name: "monarch-healing-cancelled.ics", content: ics(b, `${tname} with ${pname.split(" ")[0]}`, where, true) } : undefined));
    }
    await Promise.all(jobs);
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
