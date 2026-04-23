# Step 2 | 3 Punch Card — Setup Guide

This is a shared real-time attendance tracker for Yonas & Rahel.
It uses **Firebase** for live sync and **Vercel** for free public hosting.

Total setup time: ~10 minutes.

---

## Step 1 — Create a Firebase project (free)

1. Go to https://console.firebase.google.com
2. Click **"Add project"** → give it any name (e.g. `step23-punchcard`) → Continue
3. Disable Google Analytics if prompted → **Create project**
4. Once created, click the **Web icon `</>`** to add a web app
5. Give it a nickname (e.g. `punchcard`) → click **Register app**
6. You'll see a `firebaseConfig` object like this — **copy it**:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "yourproject.firebaseapp.com",
  databaseURL: "https://yourproject-default-rtdb.firebaseio.com",
  projectId: "yourproject",
  storageBucket: "yourproject.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123..."
};
```

7. In the left sidebar → **Build → Realtime Database** → **Create database**
8. Choose **"Start in test mode"** → Enable
   *(Test mode allows reads/writes for 30 days — enough to get started)*

---

## Step 2 — Paste your Firebase config into the app

Open `src/App.jsx` in any text editor (TextEdit on Mac works, or VS Code).

Find this block near the top (around line 20):

```js
const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  databaseURL:       "REPLACE_WITH_YOUR_DATABASE_URL",
  ...
};
```

Replace all the `"REPLACE_WITH_..."` values with your actual values from Step 1.

**Save the file.**

---

## Step 3 — Deploy to Vercel (free public URL)

### Option A: Drag & Drop (no terminal needed)
1. Go to https://vercel.com → sign up free with GitHub
2. Click **"Add New Project"**
3. Drag the entire `punch-card` folder into Vercel's upload area
4. Click **Deploy**
5. In ~60 seconds you'll get a URL like `https://punch-card-abc123.vercel.app`

### Option B: Via terminal (if you have Node.js)
```bash
cd punch-card
npm install
npx vercel
```
Follow the prompts — it'll give you a public URL.

---

## Step 4 — Share the URL

Send the URL to Rahel. You both open it in any browser, pick your name, and edits sync live instantly.

---

## Notes

- Data is stored in Firebase (free tier: 1 GB storage, 10 GB/month transfer — way more than you'll need)
- The Firebase test mode expires after 30 days. To extend it:
  - Firebase Console → Realtime Database → Rules → change `"now < 1234..."` to a later date, or set `".read": true, ".write": true` permanently for a private project
- You can rename the Vercel URL to something custom (e.g. `step23card.vercel.app`) in Vercel project settings
