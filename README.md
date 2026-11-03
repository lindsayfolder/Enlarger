# Enlarger

A photo enlarger you install from the web (a PWA). It turns a photo like 1000 × 1400 px into a print file such as 4000 × 6000 px (20 × 30 in at 200 ppi), with AI that runs on the phone itself.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The app's screens and styling |
| `app.js` | The app's logic: framing, enlarging, saving, settings, updates |
| `encoders.js` | Builds JPEG and PNG files for very large pictures on iPhone and iPad |
| `sw.js` | Makes the app installable, work offline, and update from Settings |
| `version.json` | The current version number and the "What's new" list |
| `manifest.webmanifest`, `icons/` | App name and home-screen icons |

## Put it online (free, one time)

The app needs a secure (https) web address. Either of these is free.

**GitHub Pages (works from a phone browser)**
1. Sign in at github.com and create a new public repository, for example `enlarger`.
2. Tap **Add file → Upload files**, and upload everything from this folder, keeping the `icons` folder.
3. Go to **Settings → Pages**. Under "Branch", choose `main` and `/ (root)`, then **Save**.
4. After a minute your app is at `https://YOUR-NAME.github.io/enlarger/`.

**Netlify Drop (easiest from a computer)**
1. Open app.netlify.com/drop.
2. Drag this whole folder onto the page. You get a web address right away.

## Install it on your phone

- **iPhone or iPad (Safari):** open the address, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the address, tap the menu, then **Install app**.

## Publishing an update

This repository is linked to Netlify, so every change pushed here goes live automatically in about a minute. Claude can make and push changes for you.

To do it by hand:

1. Change what you need.
2. Raise the version number in **three** places, all to the same value, for example `1.0.1`:
   - `sw.js` → `const VERSION = '1.0.1';`
   - `app.js` → `const APP_VERSION = '1.0.1';`
   - `version.json` → `"version": "1.0.1"`, and list the changes under `"notes"`
3. Commit the changed files to this repository (on GitHub: **Add file → Upload files**, then commit). Netlify publishes them automatically.

Installed apps find the update on their own when opened (or tap **Settings → Check for updates**), show "What's new", and install it when you tap **Install update**. An update never interrupts a job in progress.

## Good to know

- Photos never leave the device. There are no accounts, credits or watermarks.
- The AI models (from the open-source UpscalerJS project) download the first time you use AI mode, about 1 to 20 MB depending on the model. After that the app works offline. **Settings → Download AI models now** gets them ahead of time.
- On iPhone, very large prints (over about 16.7 MP) are built with the app's own encoder, which is slower but avoids Safari's canvas limit.
- If AI mode can't load (no connection on first use, or an unsupported browser), the app tells you and uses Classic mode instead.
