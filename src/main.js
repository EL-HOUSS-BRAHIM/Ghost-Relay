const Alpine = require('alpinejs');
const anime = require('animejs');
const sodium = require('libsodium-wrappers');
const bip39 = require('bip39');
const { Buffer } = require('buffer');
require('./styles.css');

window.Buffer = Buffer;

const serverUrl = 'https://ghost-relay-server--EL-HOUSS-BRAHIM.replit.app';
const wsUrl = 'wss://ghost-relay-server--EL-HOUSS-BRAHIM.replit.app/ws';
const APP_SECRET = 'ghost-relay-secure-2026-v1';

let keypairSign = null;
let keypairEncrypt = null;
let mediaRecorder = null;
let recordedChunks = [];

function deriveKey(password, salt) {
  if (typeof sodium.crypto_generichash === 'function') {
    const combined = new Uint8Array(password.length + salt.length);
    combined.set(new TextEncoder().encode(password), 0);
    combined.set(salt, password.length);
    return sodium.crypto_generichash(32, combined);
  }
  if (typeof sodium.crypto_hash_sha256 === 'function') {
    const combined = new Uint8Array(password.length + salt.length);
    combined.set(new TextEncoder().encode(password), 0);
    combined.set(salt, password.length);
    return sodium.crypto_hash_sha256(combined);
  }
  throw new Error('No suitable hash function available');
}

function saveKeys(encrypted) { localStorage.setItem('ghost_keys', encrypted); }
function loadKeys() { return localStorage.getItem('ghost_keys'); }

async function encryptKeysForStorage(keysObj, password) {
  const salt = sodium.randombytes_buf(16);
  const key = deriveKey(password, salt);
  const plaintext = sodium.from_string(JSON.stringify(keysObj));
  let cipher, nonce;
  if (typeof sodium.crypto_aead_xchacha20poly1305_ietf_encrypt === 'function') {
    nonce = sodium.randombytes_buf(24);
    cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, key);
  } else if (typeof sodium.crypto_aead_chacha20poly1305_ietf_encrypt === 'function') {
    nonce = sodium.randombytes_buf(12);
    cipher = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, key);
  } else if (typeof sodium.crypto_box_seal === 'function') {
    const kp = sodium.crypto_box_seed_keypair(key);
    cipher = sodium.crypto_box_seal(plaintext, kp.publicKey);
    nonce = new Uint8Array(0);
  } else {
    throw new Error('No encryption available');
  }
  return `${sodium.to_base64(salt)}:${sodium.to_base64(nonce)}:${sodium.to_base64(cipher)}`;
}

async function decryptKeysFromStorage(data, password) {
  const [saltB64, nonceB64, cipherB64] = data.split(':');
  const salt = sodium.from_base64(saltB64);
  const nonce = sodium.from_base64(nonceB64);
  const cipher = sodium.from_base64(cipherB64);
  const key = deriveKey(password, salt);
  let plain;
  if (nonce.length === 24 && typeof sodium.crypto_aead_xchacha20poly1305_ietf_decrypt === 'function') {
    plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipher, null, nonce, key);
  } else if (nonce.length === 12 && typeof sodium.crypto_aead_chacha20poly1305_ietf_decrypt === 'function') {
    plain = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(null, cipher, null, nonce, key);
  } else if (nonce.length === 0 && typeof sodium.crypto_box_seal_open === 'function') {
    const kp = sodium.crypto_box_seed_keypair(key);
    plain = sodium.crypto_box_seal_open(cipher, kp.publicKey, kp.privateKey);
  } else {
    throw new Error('No matching decrypt');
  }
  return JSON.parse(sodium.to_string(plain));
}

function deriveKeypairFromMnemonic(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedBytes = new Uint8Array(seed.slice(0, 32));
  const kpSign = sodium.crypto_sign_seed_keypair(seedBytes);
  const pubEncrypt = sodium.crypto_sign_ed25519_pk_to_curve25519(kpSign.publicKey);
  const privEncrypt = sodium.crypto_sign_ed25519_sk_to_curve25519(kpSign.privateKey);
  return { sign: kpSign, encrypt: { publicKey: pubEncrypt, privateKey: privEncrypt } };
}

async function registerUser(username, publicKey, encKey) {
  const response = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ghost-Auth': APP_SECRET },
    body: JSON.stringify({ username, public_key: publicKey, encryption_key: encKey })
  });
  if (response.ok) {
    localStorage.setItem('ghost_username', username);
    localStorage.setItem('ghost_registered', 'true');
    return { success: true };
  }
  if (response.status === 409) return { success: false, error: 'conflict' };
  return { success: false, error: 'network' };
}

async function syncUserList() {
  try {
    const response = await fetch(`${serverUrl}/api/users`, {
      headers: { 'X-Ghost-Auth': APP_SECRET }
    });
    if (!response.ok) return [];
    const users = await response.json();
    localStorage.setItem('ghost_users', JSON.stringify(users));
    return users;
  } catch (err) {
    console.error('User sync error', err);
    return [];
  }
}

function makePayload(type, content) { return { t: type, c: content }; }

function encryptForWire(obj) {
  const message = sodium.from_string(JSON.stringify(obj));
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const cipher = sodium.crypto_box_easy(message, nonce, keypairEncrypt.publicKey, keypairEncrypt.privateKey);
  return { nonce: sodium.to_base64(nonce), cipher: sodium.to_base64(cipher) };
}

function decryptFromWire(payload) {
  const nonce = sodium.from_base64(payload.nonce);
  const cipher = sodium.from_base64(payload.cipher);
  const plain = sodium.crypto_box_open_easy(cipher, nonce, keypairEncrypt.publicKey, keypairEncrypt.privateKey);
  return JSON.parse(sodium.to_string(plain));
}

function hashToGradient(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 12%, 86%), hsl(${hue2}, 18%, 68%))`;
}

function timeLabel() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function animateSendButton() {
  anime({ targets: '.btn-metal', scale: [1, 1.03, 1], duration: 320, easing: 'easeOutQuad' });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    screen: 'login',
    statusLabel: 'OFFLINE',
    wsStatus: 'OFFLINE',
    currentUser: '',
    ws: null,
    users: [],
    messages: [],
    typingUsers: new Set(),
    search: '',
    selectedRecipient: '',
    mnemonic: '',
    modals: { mnemonic: false },
    form: {
      username: '',
      password: '',
      message: '',
      recoverUsername: '',
      recoverPassword: '',
      recoverPhrase: ''
    },

    async init() {
      await sodium.ready;
      this.restoreLocalUser();
      this.users = JSON.parse(localStorage.getItem('ghost_users') || '[]');
    },

    avatarStyle(name) {
      return `background:${hashToGradient(name)};`;
    },

    get filteredUsers() {
      if (!this.search) return this.users;
      return this.users.filter(u => u.username.toLowerCase().includes(this.search.toLowerCase()));
    },

    restoreLocalUser() {
      const storedUser = localStorage.getItem('ghost_username');
      if (storedUser) {
        this.currentUser = storedUser;
        this.form.username = storedUser;
        this.screen = 'login';
      }
    },

    setStatus(online) {
      this.wsStatus = online ? 'ONLINE' : 'OFFLINE';
      this.statusLabel = this.wsStatus;
    },

    async handleLogin() {
      await sodium.ready;
      const username = this.form.username.trim();
      const password = this.form.password;
      if (!username || !password) return alert('Username and password required');
      const stored = loadKeys();
      if (!stored) return alert('No account found locally. Please register or recover.');
      try {
        const keys = await decryptKeysFromStorage(stored, password);
        keypairSign = { publicKey: sodium.from_base64(keys.pubSign), privateKey: sodium.from_base64(keys.privSign) };
        keypairEncrypt = { publicKey: sodium.from_base64(keys.pubEncrypt), privateKey: sodium.from_base64(keys.privEncrypt) };
        this.currentUser = username;
        localStorage.setItem('ghost_username', username);
        await this.refreshUsers();
        this.screen = 'chat';
        this.connectWs();
      } catch (err) {
        alert('Incorrect password');
      }
    },

    async handleRegister() {
      await sodium.ready;
      const username = this.form.username.trim();
      const password = this.form.password;
      if (!username || !password) return alert('Username and password required');
      const mnemonic = bip39.generateMnemonic(128);
      const keypairs = deriveKeypairFromMnemonic(mnemonic);
      keypairSign = keypairs.sign;
      keypairEncrypt = keypairs.encrypt;
      const keysObj = {
        pubSign: sodium.to_base64(keypairSign.publicKey),
        privSign: sodium.to_base64(keypairSign.privateKey),
        pubEncrypt: sodium.to_base64(keypairEncrypt.publicKey),
        privEncrypt: sodium.to_base64(keypairEncrypt.privateKey),
        mnemonic
      };
      const encrypted = await encryptKeysForStorage(keysObj, password);
      saveKeys(encrypted);
      const publicKeyB64 = sodium.to_base64(keypairSign.publicKey);
      const encKeyB64 = sodium.to_base64(keypairEncrypt.publicKey);
      await registerUser(username, publicKeyB64, encKeyB64);
      this.mnemonic = mnemonic;
      this.modals.mnemonic = true;
      this.currentUser = username;
    },

    async handleRecovery() {
      await sodium.ready;
      const username = this.form.recoverUsername.trim();
      const password = this.form.recoverPassword;
      const phrase = this.form.recoverPhrase.trim();
      if (!username || !password || !phrase) return alert('All fields required');
      if (!bip39.validateMnemonic(phrase)) return alert('Invalid recovery phrase');
      const keypairs = deriveKeypairFromMnemonic(phrase);
      keypairSign = keypairs.sign;
      keypairEncrypt = keypairs.encrypt;
      const keysObj = {
        pubSign: sodium.to_base64(keypairSign.publicKey),
        privSign: sodium.to_base64(keypairSign.privateKey),
        pubEncrypt: sodium.to_base64(keypairEncrypt.publicKey),
        privEncrypt: sodium.to_base64(keypairEncrypt.privateKey),
        mnemonic: phrase
      };
      const encrypted = await encryptKeysForStorage(keysObj, password);
      saveKeys(encrypted);
      const publicKeyB64 = sodium.to_base64(keypairSign.publicKey);
      const encKeyB64 = sodium.to_base64(keypairEncrypt.publicKey);
      await registerUser(username, publicKeyB64, encKeyB64);
      this.currentUser = username;
      this.screen = 'chat';
      await this.refreshUsers();
      this.connectWs();
    },

    closeMnemonic() {
      this.modals.mnemonic = false;
      this.screen = 'chat';
      this.connectWs();
    },

    copyMnemonic() {
      navigator.clipboard.writeText(this.mnemonic);
    },

    async refreshUsers() {
      this.users = await syncUserList();
    },

    selectRecipient(username) {
      this.selectedRecipient = username;
    },

    emitTyping() {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const envelope = { type: 'typing_start', to: this.selectedRecipient || '', from: this.currentUser };
      this.ws.send(JSON.stringify(envelope));
    },

    pushMessage(from, payload) {
      const msg = decryptFromWire(payload);
      this.messages.push({ id: crypto.randomUUID(), from, t: msg.t, c: msg.c, time: timeLabel() });
      if (this.messages.length > 100) this.messages.shift();
      this.$nextTick(() => {
        const container = document.getElementById('messages');
        if (container) container.scrollTop = container.scrollHeight;
      });
    },

    connectWs() {
      if (!this.currentUser) return;
      if (this.ws) this.ws.close();
      const url = `${wsUrl}?ghost_auth=${encodeURIComponent(APP_SECRET)}&u=${encodeURIComponent(this.currentUser)}`;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => this.setStatus(true);
      this.ws.onclose = () => this.setStatus(false);
      this.ws.onerror = () => this.setStatus(false);
      this.ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'typing_start') {
            this.typingUsers.add(data.from);
            setTimeout(() => this.typingUsers.delete(data.from), 2000);
            this.typingUsers = new Set(this.typingUsers);
            return;
          }
          if (data.type === 'typing_stop') {
            this.typingUsers.delete(data.from);
            this.typingUsers = new Set(this.typingUsers);
            return;
          }
          if (data.payload) this.pushMessage(data.from, data.payload);
        } catch (err) {
          console.error('WS parse error', err);
        }
      };
    },

    async sendMessage(type = 'txt') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const content = type === 'txt' ? this.form.message.trim() : this.form.message;
      if (!content) return;
      const payload = encryptForWire(makePayload(type, content));
      const envelope = { to: this.selectedRecipient || '', from: this.currentUser, payload, type };
      this.ws.send(JSON.stringify(envelope));
      this.pushMessage(this.currentUser, payload);
      this.form.message = '';
      animateSendButton();
      const stop = { type: 'typing_stop', to: this.selectedRecipient || '', from: this.currentUser };
      this.ws.send(JSON.stringify(stop));
    },

    async startRecording() {
      recordedChunks = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const stopTimer = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 50000);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        clearTimeout(stopTimer);
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        const base64 = await blobToBase64(blob);
        const payload = encryptForWire(makePayload('aud', base64));
        const envelope = { to: this.selectedRecipient || '', from: this.currentUser, payload, type: 'aud' };
        this.ws?.send(JSON.stringify(envelope));
        this.pushMessage(this.currentUser, payload);
      };
      mediaRecorder.start();
    },

    stopRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    },

    handleLogout() {
      if (this.ws) this.ws.close();
      this.screen = 'login';
      this.messages = [];
      this.statusLabel = 'OFFLINE';
    }
  }));
});

window.Alpine = Alpine;
Alpine.start();
