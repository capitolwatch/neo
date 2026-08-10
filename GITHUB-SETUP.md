# Getting NEO onto GitHub — your walkthrough

Follow these once, top to bottom. Delete this file afterward (it's for you, not the repo).

## 1. Create the account and repo

1. Sign up at https://github.com (free account is fine).
2. Click the **+** (top right) → **New repository**.
3. Name it `neo` (or `neo-writer` if taken). Description: "A word processor for authors. Distraction-free by default."
4. Set it to **Public**. Do NOT check "Add a README" (we have one). Click **Create repository**.

## 2. Push the code

Open Terminal and run these one at a time (replace YOURUSERNAME):

```
cd ~/Downloads/NEO
git init
git add .
git commit -m "NEO v0.1.0 — first public release"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/neo.git
git push -u origin main
```

GitHub will ask you to sign in the first time (it may walk you through creating a "personal access token" — follow its prompts, it's a one-time dance).

The `.gitignore` file already keeps `node_modules/` and `dist/` out of the repo, so only the real source goes up.

## 3. Build the installers

```
cd ~/Downloads/NEO
npm install electron-builder --save-dev
npm run package
```

When it finishes, look in the `dist/` folder for `NEO-0.1.0.dmg` (or similar). That's the Mac installer. (`npm run package:win` for Windows needs a bit more setup — start Mac-only and add Windows when a PC-owning friend can test it.)

## 4. Create the first release

1. On your repo page, click **Releases** (right sidebar) → **Draft a new release**.
2. Click **Choose a tag**, type `v0.1.0`, click "Create new tag".
3. Title: `NEO 0.1.0 — first flight`.
4. Write a few lines about what it is (or paste from the README).
5. Drag the installers from `dist/` into the attachments box — **and for auto-update to work, also attach the extra files electron-builder made**: `latest-mac.yml` (and `latest.yml` for Windows), the `.zip`, and the `.blockmap` files. Installed copies of NEO check these to discover new versions and update themselves.
6. Click **Publish release**.

The release page URL is what you share. Anyone can download the .dmg from there — no ads, no middlemen.

## 5. Updating later

Each time we improve NEO:

```
cd ~/Downloads/NEO
git add .
git commit -m "Describe what changed"
git push
```

Then bump the version in `package.json` (0.1.0 → 0.2.0), rebuild with `npm run package`, and draft a new release with the new tag and the new .dmg.

## Worth doing before wide release

- **Apple Developer ID** ($99/yr, https://developer.apple.com) — lets the .dmg be signed and notarized so friends don't see the "unidentified developer" warning. electron-builder handles the signing once the certificate is on your Mac.
- **Repo settings → enable Issues** so testers can file bugs in one place.
- A screenshot or two at the top of the README makes a huge difference — take them in the editor with a chapter of real prose on screen, plus one of the bookshelf.
