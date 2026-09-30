# Client accounts — setup checklist

The site works without this (bookings fall back to an email request). Once these steps are done, clients get accounts.

1. **Supabase project** — region Canada (Central). Copy *Project URL* and *anon / publishable key* into `js/site.js` → `MH_CONFIG`.
2. **Database** — SQL Editor: run `supabase/schema.sql`, then `supabase/seed.sql`.
3. **Auth → URL configuration** — Site URL `https://monarch-healing.com`; Redirect URLs `https://monarch-healing.com/**`.
4. **Auth → Email templates** — Magic Link and Confirm signup: paste `email-templates/magic-link.html`, subject `Your Monarch Healing sign-in code: {{ .Token }}`.
5. **Auth → SMTP (custom)** — Resend: host `smtp.resend.com`, port 465, user `resend`, password = Resend API key, sender `bookings@monarch-healing.com`, name `Monarch Healing`.
6. **Resend** — verify domain monarch-healing.com (DNS records in GoDaddy).
7. **Booking emails** — deploy `functions/booking-emails`, add secret `RESEND_API_KEY`, and create a Database Webhook on `public.bookings` (INSERT, UPDATE) → Edge Function `booking-emails`, with the service-key auth header.
8. **Admins** — edit the list in `seed.sql` (`admin_emails`) and re-run those statements.

## Rules (in `booking_rules()` in schema.sql)
- Book at least 12 hours ahead, up to 60 days ahead.
- Clients can move or cancel a *confirmed* session online until 24 hours before; unconfirmed requests any time.
- Max 5 unconfirmed requests per client.
- Weekly hours live in the `availability` table (weekday 0 = Sunday).
