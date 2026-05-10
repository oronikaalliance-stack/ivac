# IVAC Appointment Slot Checker

Monitors `appointment.ivacbd.com` for available appointment slots and alerts you the moment one opens.

## Setup

### 1. Install Node.js
Download from https://nodejs.org (v18 or newer)

### 2. Install dependencies (optional — only for email alerts)
```bash
npm install nodemailer
```
> No dependencies needed if you only want terminal alerts.

### 3. Get your session cookie
1. Go to https://appointment.ivacbd.com and **log in manually**
2. Press **F12** → **Application** tab → **Cookies** → click `appointment.ivacbd.com`
3. Find `PHPSESSID` and copy its value
4. Open `checker.js` and paste it into `CONFIG.cookie`:
```js
cookie: "PHPSESSID=abc123yourcookiehere",
```

### 4. Set your preferences
Edit the `CONFIG` block at the top of `checker.js`:
```js
city: "Dhaka",           // Dhaka | Chittagong | Sylhet | Rajshahi | Khulna
visaType: "Tourist",     // Tourist | Medical | Business | Student | Employment
intervalSeconds: 30,     // Check every 30 seconds (don't go below 15)
stopOnFound: false,      // Set true to auto-stop when a slot is found
```

### 5. Run it
```bash
node checker.js
```

## Optional: Email alerts
Set `email.enabled: true` in CONFIG and fill in your Gmail details.
Use a Gmail **App Password** (not your real password):
https://myaccount.google.com/apppasswords

## Notes
- Your session cookie expires after a few hours — re-login and update it if you see "Session expired"
- Don't set interval below 15s or the server may temporarily block your IP
- Keep the terminal open while monitoring (or run it on a VPS/server for 24/7 monitoring)

## Output example
```
[14:32:01] · Check #1 — No slots available. (Dhaka · Tourist)
[14:32:31] · Check #2 — No slots available. (Dhaka · Tourist)
[14:33:01] ★ ━━━ SLOT FOUND! 2 slot(s) available ━━━
[14:33:01] ★ City: Dhaka | Visa: Tourist
[14:33:01] ★ Book now → https://appointment.ivacbd.com/
```
