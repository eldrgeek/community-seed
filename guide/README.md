# SOMA Guide

SOMA Guide is a small Chrome Manifest V3 extension for signed, human-operated walkthroughs. It opens an allowed page, points to controls, shows plain instructions, and waits for visible changes. It never clicks, types, or submits on the person's behalf, and it does not report progress. Copy text is always visible and reaches the clipboard only after the person clicks Copy.

Every step has a “Something's wrong” link. A trusted click prepares a privacy-stripped structural snapshot and opens a separate extension popup, outside the page. The popup requires a note and shows the exact JSON, updated as the note is typed, before anything is sent. Only clicking Send posts that JSON to the fixed feedback endpoint at `https://vps.mike-wolf.com/seed-door/feedback`; the background worker makes the request. Cancel clears the pending payload and closes the popup. Snapshots omit ordinary page text, field values, editable content, conversations, articles, and logs. Apart from downloading the selected guide and signature, this feedback POST is the extension's only network call.

The extension has no analytics, recipes, debugger access, or automation runtime. It accepts only the documented data fields. It refuses unsigned or altered guides, sites that a guide did not declare, and copy text longer than 4000 characters.

## Build

Run `npm run build`. The unpacked extension is written to `dist/`. Set `GUIDE_PUBLIC_KEY_SPKI_BASE64` to an Ed25519 public key in base64 DER SPKI form for a production build. Set `GUIDE_BASE_URL` to the HTTPS folder that hosts guides. `FEEDBACK_URL` is a build constant and defaults to the fixed endpoint above. The committed public key verifies signed example guides.

## Sign a guide

Keep the Ed25519 private key outside this repository. Run `npm run sign -- guides/example.json /safe/path/private-key.pem`. The command creates `guides/example.json.sig` and refuses to overwrite an existing signature. Host the JSON and signature side by side over HTTPS. The signature covers the exact JSON bytes, so editing or reformatting the file requires a new signature.

## Install for a first user

Build the extension, open `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select the `guide/dist` folder. Because the manifest has no fixed key, copy the extension id Chrome assigns to this unpacked install when constructing a start link. Send the person one start link that includes the HTTPS guide address and parameters, for example `chrome-extension://EXTENSION_ID/start.html?guide=https%3A%2F%2Fexample.org%2Fguides%2Fchatgpt-project-rule.json&projectName=Coaching&name=Alex`. Chrome shows the source and task site names before granting access.

This implementation was authored for the community-seed public repository from the behavior of Yeshie's Guide mode, without importing or depending on Yeshie.

## Wake my AI

Wake my AI is a separate, optional feature reached from the start page. It is off by default and requests ChatGPT access only when it is turned on. A wake link may bind one SOMA room to one specific ChatGPT chat. When addressed, it sends only the fixed line “Check the SOMA room and reply to anything addressed to you.” It does not read chat content. The Wake page shows status and a privacy-minimal local log, and has a one-click Turn off button. Guides continue to use their existing guide-only path and permissions.
