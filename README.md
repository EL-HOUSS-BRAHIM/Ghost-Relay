# Ghost Relay

End-to-end encrypted messaging application built with Tauri.

## Building the Application

### Prerequisites
- Node.js (v14 or higher)
- Rust (for Tauri)

### Development

1. Install dependencies:
```bash
npm install
```

2. Bundle the JavaScript (required before running):
```bash
npm run bundle
```

3. Run the development build:
```bash
npm run dev
```

### Production Build

1. Install dependencies and bundle:
```bash
npm install
npm run bundle
```

2. Build the Tauri application:
```bash
npm run build
```

## Architecture

- **Frontend**: Vanilla JavaScript with inline CSS (no external CDN dependencies)
- **Crypto**: libsodium-wrappers for encryption, bip39 for mnemonic generation
- **Backend**: WebSocket connection to Ghost Relay server
- **Build**: esbuild bundles all dependencies into a single JavaScript file

## Features

- End-to-end encryption using libsodium
- 12-word mnemonic recovery phrases
- Voice message support
- Dark terminal-style UI (hacker theme)
- 100% offline-capable (no external CDN requests)
- Compact and optimized UI (360x550 window size)
- Production-ready builds with minification and tree shaking
