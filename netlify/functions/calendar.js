// netlify/functions/calendar.js
// ─────────────────────────────────────────────────────────────────────────────
// This serverless function handles two actions:
//   GET  ?action=slots&date=YYYY-MM-DD&duration=30   → returns free time slots
//   POST { action:"book", ... }                       → creates calendar event + sends email
//
// Environment variables to set in Netlify dashboard (Site → Environment variables):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   your service account email
//   GOOGLE_PRIVATE_KEY             your service account private key (with \n)
//   GOOGLE_CALENDAR_ID             the barber's Google Calendar ID (usually their Gmail)
//   EMAILJS_SERVICE_ID             from emailjs.com
//   EMAILJS_TEMPLATE_ID            from emailjs.com
//   EMAILJS_PRIVATE_KEY            your EmailJS private key (Account → API Keys)
// ─────────────────────────────────────────────────────────────────────────────

const { google } = require('googleapis');

// Working hours (24h). Sunday = 0, Monday = 1 … Saturday = 6
const SCHEDULE = {
  1: null,              // Monday: closed
  2: { open: 10, close: 19 },  // Tuesday
  3: { open: 10, close: 19 },  // Wednesday
  4: { open: 10, close: 19 },  // Thursday
  5: { open: 10, close: 19 },  // Friday
  6: { open: 9,  close: 17 },  // Saturday
  0: null,              // Sunday: closed
};

const SLOT_INTERVAL = 30; // minutes between slot start times

// ── Google Auth via Service Account ──────────────────────────────────────────
function getGoogleAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  return new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );
}

// ── Fetch busy intervals from Google Calendar ─────────────────────────────────
async function getBusySlots(auth, calendarId, dateStr) {
  const calendar = google.calendar({ version: 'v3', auth });
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd   = new Date(`${dateStr}T23:59:59`);

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  return (res.data.calendars[calendarId]?.busy || []).map(b => ({
    start: new Date(b.start),
    end:   new Date(b.end),
  }));
}

// ── Compute free slots ────────────────────────────────────────────────────────
function computeFreeSlots(dateStr, durationMinutes, busySlots) {
  const date    = new Date(dateStr + 'T12:00:00'); // noon to avoid DST issues
  const dayOfWeek = date.getDay();
  const hours   = SCHEDULE[dayOfWeek];

  if (!hours) return []; // closed

  const slots = [];
  const now   = new Date();

  let cursor = new Date(`${dateStr}T${String(hours.open).padStart(2,'0')}:00:00`);
  const closeTime = new Date(`${dateStr}T${String(hours.close).padStart(2,'0')}:00:00`);

  while (true) {
    const slotEnd = new Date(cursor.getTime() + durationMinutes * 60000);
    if (slotEnd > closeTime) break;

    // Skip slots in the past (+ 30 min buffer)
    if (cursor <= new Date(now.getTime() + 30 * 60000)) {
      cursor = new Date(cursor.getTime() + SLOT_INTERVAL * 60000);
      continue;
    }

    // Check overlap with busy slots
    const blocked = busySlots.some(b => cursor < b.end && slotEnd > b.start);

    if (!blocked) {
      const hh = String(cursor.getHours()).padStart(2, '0');
      const mm = String(cursor.getMinutes()).padStart(2, '0');
      slots.push(`${hh}:${mm}`);
    }

    cursor = new Date(cursor.getTime() + SLOT_INTERVAL * 60000);
  }

  return slots;
}

// ── Create calendar event ─────────────────────────────────────────────────────
async function createEvent(auth, calendarId, { name, email, phone, service, date, time, duration, notes }) {
  const calendar = google.calendar({ version: 'v3', auth });

  const [h, m]  = time.split(':').map(Number);
  const start   = new Date(`${date}T${time}:00`);
  const end     = new Date(start.getTime() + duration * 60000);

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary:     `✂ ${service} — ${name}`,
      description: `Cliente: ${name}\nEmail: ${email}\nTelefone: ${phone || 'N/A'}\nServiço: ${service}\nNotas: ${notes || 'Nenhuma'}`,
      location:    'Av Dr. António Rodrigues Manito 53A, Setúbal',
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Lisbon' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Europe/Lisbon' },
      attendees: [{ email, displayName: name }],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 30 }],
      },
      colorId: '11', // tomato red — stands out in calendar
    },
  });
}

// ── Send email via EmailJS REST API ──────────────────────────────────────────
async function sendEmail({ name, email, phone, service, date, time, price }) {
  const dateDisplay = new Date(date + 'T12:00:00').toLocaleDateString('pt-PT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id:  process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id:     process.env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_name:  name,
        to_email: email,
        service,
        date:     dateDisplay,
        time,
        price:    `€${price}`,
        phone:    phone || 'Não fornecido',
        reply_to: 'info@barbeariaebenezer.pt',
      },
    }),
  });

  if (!res.ok) throw new Error(`EmailJS error: ${res.status}`);
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const auth       = getGoogleAuth();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    // ── GET slots ──────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { date, duration } = event.queryStringParameters || {};
      if (!date || !duration) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing date or duration' }) };
      }

      const busy  = await getBusySlots(auth, calendarId, date);
      const slots = computeFreeSlots(date, parseInt(duration), busy);
      return { statusCode: 200, headers, body: JSON.stringify({ slots }) };
    }

    // ── POST book ──────────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { name, email, phone, service, serviceName, date, time, duration, price, notes } = body;

      if (!name || !email || !service || !date || !time) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
      }

      // Double-check slot is still free (race condition protection)
      const busy  = await getBusySlots(auth, calendarId, date);
      const slots = computeFreeSlots(date, parseInt(duration), busy);

      if (!slots.includes(time)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'slot_taken', message: 'Este horário já foi reservado. Por favor escolha outro.' }) };
      }

      await createEvent(auth, calendarId, { name, email, phone, service: serviceName, date, time, duration: parseInt(duration), notes });
      await sendEmail({ name, email, phone, service: serviceName, date, time, price });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
