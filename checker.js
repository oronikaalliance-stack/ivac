/**
 * IVAC Appointment Slot Checker
 * ─────────────────────────────
 * Monitors appointment.ivacbd.com for available slots
 * and alerts you via terminal + sound + optional email.
 *
 * Usage:
 *   1. npm install node-fetch nodemailer
 *   2. Fill in CONFIG below
 *   3. node checker.js
 */

const https = require("https");
const http = require("http");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  // Your session cookie after manual login
  // F12 → Application → Cookies → copy PHPSESSID value
  cookie: "PHPSESSID=PASTE_YOUR_SESSION_ID_HERE",

  // Visa center city: "Dhaka", "Chittagong", "Sylhet", "Rajshahi", "Khulna"
  city: "Dhaka",

  // Visa type: "Tourist", "Medical", "Business", "Student", "Employment"
  visaType: "Tourist",

  // How often to check (in seconds). Don't go below 15 to avoid being blocked.
  intervalSeconds: 30,

  // Optional: get email alerts (set enabled: true and fill smtp details)
  email: {
    enabled: false,
    smtp: {
      host: "smtp.gmail.com",
      port: 587,
      user: "your@gmail.com",
      pass: "your_app_password", // Gmail App Password (not your real password)
    },
    to: "your@gmail.com",
  },

  // Optional: play a beep sound alert in terminal
  soundAlert: true,

  // Stop automatically after finding a slot
  stopOnFound: false,
};

// ─── COLORS ──────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function log(msg, type = "info") {
  const icons = { info: "·", success: "✓", warn: "!", err: "✗", found: "★" };
  const colors = {
    info: c.gray,
    success: c.green,
    warn: c.yellow,
    err: c.red,
    found: c.green + c.bold,
  };
  const color = colors[type] || c.gray;
  const icon = icons[type] || "·";
  console.log(`${c.gray}[${timestamp()}]${c.reset} ${color}${icon}${c.reset} ${color}${msg}${c.reset}`);
}

function beep() {
  if (CONFIG.soundAlert) {
    process.stdout.write("\x07\x07\x07");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HTTP REQUEST ─────────────────────────────────────────────────────────────

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const lib = options.port === 443 || options.protocol === "https:" ? https : http;
    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: data })
      );
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ─── IVAC API CALLS ──────────────────────────────────────────────────────────

async function fetchAvailableSlots() {
  const options = {
    hostname: "appointment.ivacbd.com",
    port: 443,
    protocol: "https:",
    // Try common appointment API endpoints
    path: "/highcom/appointment-slot",
    method: "GET",
    headers: {
      Cookie: CONFIG.cookie,
      Accept: "application/json, text/html, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://appointment.ivacbd.com/",
    },
  };

  const response = await makeRequest(options);
  return response;
}

async function fetchSlotsByForm() {
  // Some IVAC pages use form POST to fetch available dates
  const body = JSON.stringify({
    center: CONFIG.city,
    visa_type: CONFIG.visaType,
  });

  const options = {
    hostname: "appointment.ivacbd.com",
    port: 443,
    protocol: "https:",
    path: "/highcom/get-slots",
    method: "POST",
    headers: {
      Cookie: CONFIG.cookie,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://appointment.ivacbd.com/",
    },
  };

  const response = await makeRequest(options, body);
  return response;
}

// ─── PARSE RESPONSE ──────────────────────────────────────────────────────────

function parseSlots(responseBody) {
  let data;
  try {
    data = JSON.parse(responseBody);
  } catch {
    // Try to extract slot info from HTML if not JSON
    const html = responseBody;
    const hasSlot =
      html.includes("available") ||
      html.includes("slot") ||
      html.includes("appointment");
    const noSlot =
      html.includes("no slot") ||
      html.includes("not available") ||
      html.includes("fully booked");

    if (noSlot) return { found: false, slots: [], raw: "HTML: no slots" };
    if (hasSlot) return { found: true, slots: ["Possible slot — check manually"], raw: "HTML: possible slots" };
    return { found: false, slots: [], raw: "Could not parse response" };
  }

  // Handle various JSON structures IVAC might return
  const slots =
    data.slots ||
    data.available_slots ||
    data.data ||
    data.appointments ||
    (Array.isArray(data) ? data : []);

  const available = slots.filter((s) => {
    if (typeof s === "string") return true;
    return (
      s.available === true ||
      s.status === "available" ||
      s.count > 0 ||
      s.slots > 0
    );
  });

  return {
    found: available.length > 0,
    slots: available,
    raw: JSON.stringify(data).substring(0, 200),
  };
}

// ─── EMAIL ALERT ─────────────────────────────────────────────────────────────

async function sendEmailAlert(slots) {
  if (!CONFIG.email.enabled) return;

  try {
    // Dynamically require nodemailer (optional dep)
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: CONFIG.email.smtp.host,
      port: CONFIG.email.smtp.port,
      secure: false,
      auth: {
        user: CONFIG.email.smtp.user,
        pass: CONFIG.email.smtp.pass,
      },
    });

    await transporter.sendMail({
      from: CONFIG.email.smtp.user,
      to: CONFIG.email.to,
      subject: `🟢 IVAC Slot Available — ${CONFIG.visaType} visa in ${CONFIG.city}!`,
      html: `
        <h2>Appointment slot found!</h2>
        <p><strong>City:</strong> ${CONFIG.city}</p>
        <p><strong>Visa type:</strong> ${CONFIG.visaType}</p>
        <p><strong>Time found:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>Slots:</strong> ${JSON.stringify(slots)}</p>
        <p><a href="https://appointment.ivacbd.com/">Book now →</a></p>
      `,
    });

    log("Email alert sent!", "success");
  } catch (err) {
    log(`Email failed: ${err.message}`, "warn");
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

let checkCount = 0;
let slotsFoundCount = 0;
let running = true;

async function check() {
  checkCount++;

  try {
    // Try GET first, then POST
    let response = await fetchAvailableSlots();

    if (response.status === 401 || response.status === 403) {
      log("Session expired — please log in again and update your PHPSESSID cookie.", "err");
      log("Pausing for 5 minutes before retrying...", "warn");
      await sleep(5 * 60 * 1000);
      return;
    }

    if (response.status === 429) {
      log("Rate limited by server — waiting 2 minutes before next check.", "warn");
      await sleep(2 * 60 * 1000);
      return;
    }

    if (response.status !== 200) {
      // Try POST endpoint as fallback
      response = await fetchSlotsByForm();
    }

    const result = parseSlots(response.body);

    if (result.found) {
      slotsFoundCount++;
      log(`━━━ SLOT FOUND! ${result.slots.length} slot(s) available ━━━`, "found");
      log(`City: ${CONFIG.city} | Visa: ${CONFIG.visaType}`, "found");
      log(`Book now → https://appointment.ivacbd.com/`, "found");
      beep();
      await sendEmailAlert(result.slots);

      if (CONFIG.stopOnFound) {
        log("Stopping monitor (stopOnFound = true).", "info");
        running = false;
      }
    } else {
      log(
        `Check #${checkCount} — No slots available. (${CONFIG.city} · ${CONFIG.visaType})`,
        "info"
      );
    }
  } catch (err) {
    log(`Request error: ${err.message}`, "err");
  }
}

async function main() {
  console.log(`
${c.cyan}${c.bold}  IVAC Appointment Slot Checker${c.reset}
${c.gray}  ─────────────────────────────${c.reset}
  ${c.cyan}City:${c.reset}     ${CONFIG.city}
  ${c.cyan}Visa:${c.reset}     ${CONFIG.visaType}
  ${c.cyan}Interval:${c.reset} every ${CONFIG.intervalSeconds}s
  ${c.cyan}Email:${c.reset}    ${CONFIG.email.enabled ? CONFIG.email.to : "disabled"}
${c.gray}  ─────────────────────────────${c.reset}
  ${c.yellow}Make sure you're logged in and PHPSESSID is set in CONFIG.cookie${c.reset}
  ${c.gray}Press Ctrl+C to stop${c.reset}
`);

  if (CONFIG.cookie.includes("PASTE_YOUR")) {
    log("ERROR: You haven't set your session cookie in CONFIG.cookie!", "err");
    log("Steps: Log in at appointment.ivacbd.com → F12 → Application → Cookies → copy PHPSESSID", "warn");
    process.exit(1);
  }

  // Run immediately on start
  await check();

  // Then loop
  while (running) {
    await sleep(CONFIG.intervalSeconds * 1000);
    if (running) await check();
  }

  console.log(`\n${c.green}Done. Found ${slotsFoundCount} slot(s) across ${checkCount} checks.${c.reset}`);
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log(`\n${c.yellow}Stopped. Total checks: ${checkCount} | Slots found: ${slotsFoundCount}${c.reset}`);
  process.exit(0);
});

main().catch((err) => {
  log(`Fatal error: ${err.message}`, "err");
  process.exit(1);
});
