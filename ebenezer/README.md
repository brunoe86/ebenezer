# Ebenézer Barbearia — Setup Guide

## Project structure
```
ebenezer/
├── public/
│   └── index.html          ← the website
├── netlify/
│   └── functions/
│       └── calendar.js     ← serverless backend
├── netlify.toml            ← Netlify config
├── package.json            ← dependencies
└── README.md
```

---

## Step 1 — Google Calendar API (Service Account)

This allows the backend to read/write the barber's calendar.

1. Go to https://console.cloud.google.com/
2. Create a new project (e.g. "Ebenezer Barbearia")
3. Enable the **Google Calendar API**:
   - APIs & Services → Enable APIs → search "Google Calendar API" → Enable
4. Create a **Service Account**:
   - APIs & Services → Credentials → Create Credentials → Service Account
   - Give it a name (e.g. "ebenezer-calendar")
   - Skip role assignment → Done
5. Open the service account → Keys tab → Add Key → JSON
   - Download the JSON file — you'll need `client_email` and `private_key` from it
6. **Share the barber's Google Calendar with the service account**:
   - Open Google Calendar → Settings → find the barber's calendar → Share with specific people
   - Add the service account email (looks like: `name@project.iam.gserviceaccount.com`)
   - Give it "Make changes to events" permission

---

## Step 2 — EmailJS (free — 200 emails/month)

1. Sign up at https://www.emailjs.com/
2. Add Email Service → connect the barber's Gmail
3. Create Email Template with these variables:
   ```
   Subject: Confirmação de agendamento — {{service}}
   
   Olá {{to_name}},
   
   O seu agendamento foi confirmado!
   
   Serviço: {{service}}
   Data: {{date}}
   Hora: {{time}}
   Valor: {{price}}
   Telefone: {{phone}}
   
   Barbearia Ebenezer
   Av Dr. António Rodrigues Manito 53A, Setúbal
   Tel: 934 179 214
   ```
4. Go to Account → API Keys → copy your **Private Key**

---

## Step 3 — Deploy to Netlify

1. Push this folder to a GitHub repo
2. Go to https://netlify.com → New site from Git → connect your repo
3. Build settings:
   - Build command: (leave empty)
   - Publish directory: `public`
4. Deploy the site

---

## Step 4 — Set Environment Variables in Netlify

Go to: Site → Site configuration → Environment variables → Add variable

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The `client_email` from the JSON key file |
| `GOOGLE_PRIVATE_KEY` | The `private_key` from the JSON key file (paste the full value including `-----BEGIN...`) |
| `GOOGLE_CALENDAR_ID` | The barber's Gmail address (e.g. `barber@gmail.com`) or the calendar ID from Google Calendar settings |
| `EMAILJS_SERVICE_ID` | From EmailJS dashboard (e.g. `service_xxxxxxx`) |
| `EMAILJS_TEMPLATE_ID` | From EmailJS dashboard (e.g. `template_xxxxxxx`) |
| `EMAILJS_PRIVATE_KEY` | From EmailJS Account → API Keys (Private Key) |

After adding variables, **trigger a redeploy** (Deploys → Trigger deploy).

---

## Step 5 — Custom Domain (optional)

If the barber has a domain (e.g. `barbeariaebenezer.pt`):
- Netlify → Domain management → Add custom domain
- Update DNS at your registrar: add a CNAME record pointing to the Netlify URL

---

## How bookings work

1. Client picks a service → date → available time slot (fetched live from Google Calendar)
2. Client fills name + email → clicks confirm
3. Backend checks the slot is still free (race-condition safe)
4. Event is created in Google Calendar with the client's name, service, and notes
5. Client receives a confirmation email via EmailJS
6. The barber sees the appointment in his Google Calendar (with a 1h email reminder + 30min popup)

---

## Customisation tips

- **Change working hours**: edit the `SCHEDULE` object in `netlify/functions/calendar.js`
- **Change slot interval**: edit `SLOT_INTERVAL` (default: 30 min between slot start times)
- **Add/remove services**: edit `SERVICES` array in `public/index.html`
- **Change colors**: edit the CSS variables at the top of `public/index.html`
