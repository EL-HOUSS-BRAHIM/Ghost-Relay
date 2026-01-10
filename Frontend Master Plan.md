Project: "Ghost Relay" - Client Side

Target: Tauri (Windows .exe + Linux AppImage)
Backend URL: https://ghost-relay-server--el-houss-brahim.replit.app
WebSocket URL: wss://ghost-relay-server--el-houss-brahim.replit.app/ws

1. Directory Structure (Simulated)

Since we are pasting into GitHub, we need the AI to give us the file contents for:

src/index.html (The UI)

src/main.js (The Brains: Crypto, Voice, WebSocket)

src-tauri/tauri.conf.json (The Configuration)

.github/workflows/build.yml (The Cloud Builder)

2. Global Constraints (For the AI)

No Frameworks: Use "Vanilla JS" and "Tailwind via CDN" (or simple CSS). Do not use npm install react. Keep it raw and simple.

Crypto Library: Use libsodium-wrappers via CDN or local file.

Note: Since we are building an offline app, ask the AI to include libsodium.js logic or use a specific npm package in package.json.

Voice Logic:

Use MediaRecorder.

Limit: Stop recording automatically at 50 seconds.

Format: WebM/Opus.

Conversion: Convert Blob -> Base64 string.

Size Check: If Base64 string > 200KB, alert user "Voice note too long".

Message Limit:

Only show the last 10 messages in the UI.

Store encrypted keys in localStorage (for now, simpler than file I/O on phone-coding).

3. Prompts to Copy-Paste to AI Builder

Prompt 1 (The UI & Logic):

"Create the frontend code for my Tauri app.

File 1: package.json
Include libsodium-wrappers and tauri-apps/api.

File 2: index.html
Create a dark-mode, hacker-style UI.
Elements:

Login Screen: Username, Password (for local key encryption).

Chat Screen: List of messages (max 10), Input box (Text), 'Hold to Record' button (Voice).

Status Indicator: Red (Offline) / Green (Online).

File 3: main.js
Implement the logic using libsodium-wrappers.

Key Gen: On first run, generate Ed25519 (Identity) and X25519 (Encryption) keys. Upload public keys to https://ghost-relay-server--el-houss-brahim.replit.app/api/register.

Voice: Record audio (max 50s). Convert to Base64. Check if size < 200KB.

Crypto:

Text: { "t": "txt", "c": "message" } -> Encrypt -> Send.

Audio: { "t": "aud", "c": "base64..." } -> Encrypt -> Send.

Display: Decrypt incoming messages. If t=="aud", render an <audio> tag. Keep max 10 items in DOM."

Prompt 2 (The Tauri Config):

"Generate the src-tauri/tauri.conf.json for a Tauri v1 app.

Identifier: com.ghost.messenger

Window: 400x600, resizable, title 'Ghost Relay'.

Allowlist: Enable http (for Replit), websocket (for Replit), shell (open links), and clipboard.

Bundle: Enable active: true. Targets: msi (or nsis), appimage."

Prompt 3 (The Cloud Builder - CRITICAL):

"Create a .github/workflows/build.yml file.

Trigger: Push to main.

Job 1: Ubuntu-latest. Install dependencies (libwebkit2gtk-4.0-dev, etc.). Build AppImage.

Job 2: Windows-latest. Build .exe.

Action: Upload the builds as 'Artifacts' so I can download them.

Important: Use the standard tauri-apps/tauri-action@v0 action."