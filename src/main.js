import sodium from 'https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.13/+esm';
import * as bip39 from 'https://cdn.jsdelivr.net/npm/bip39@3.1.0/+esm';
import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';

// Make Buffer global for bip39
window.Buffer = Buffer;

const serverUrl = 'https://ghost-relay-server--el-houss-brahim.replit.app';
const wsUrl = 'wss://ghost-relay-server--el-houss-brahim.replit.app/ws';
const APP_SECRET = 'ghost-relay-secure-2026-v1'; // API key for backend authentication

let keypairSign = null; // Ed25519
let keypairEncrypt = null; // X25519
let ws = null;
let mediaRecorder = null;
let recordedChunks = [];
let unlockKey = null; // derived from password

const els = {
  loginCard: document.getElementById('loginCard'),
  chatCard: document.getElementById('chatCard'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  loginBtn: document.getElementById('loginBtn'),
  registerBtn: document.getElementById('registerBtn'),
  recoverBtn: document.getElementById('recoverBtn'),
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.querySelector('#status span:last-child'),
  wsDot: document.getElementById('wsDot'),
  wsState: document.getElementById('wsState'),
  messages: document.getElementById('messages'),
  textInput: document.getElementById('textInput'),
  sendBtn: document.getElementById('sendBtn'),
  recordBtn: document.getElementById('recordBtn'),
  mnemonicModal: document.getElementById('mnemonicModal'),
  mnemonicDisplay: document.getElementById('mnemonicDisplay'),
  copyMnemonicBtn: document.getElementById('copyMnemonicBtn'),
  closeMnemonicBtn: document.getElementById('closeMnemonicBtn'),
  recoveryModal: document.getElementById('recoveryModal'),
  recoverUsername: document.getElementById('recoverUsername'),
  recoverPassword: document.getElementById('recoverPassword'),
  recoverPhrase: document.getElementById('recoverPhrase'),
  confirmRecoverBtn: document.getElementById('confirmRecoverBtn'),
  cancelRecoverBtn: document.getElementById('cancelRecoverBtn'),
};

function setStatus(online) {
  els.statusDot.classList.toggle('bg-green-400', online);
  els.statusDot.classList.toggle('bg-red-500', !online);
  els.statusLabel.textContent = online ? 'Online' : 'Offline';
}

function setWsState(connected) {
  els.wsDot.classList.toggle('bg-green-400', connected);
  els.wsDot.classList.toggle('bg-red-500', !connected);
  els.wsState.textContent = connected ? 'Connected' : 'Disconnected';
  setStatus(connected);
}

function deriveKey(password, salt) {
  return sodium.crypto_pwhash(
    32,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_DEFAULT
  );
}

function saveKeys(encrypted) {
  localStorage.setItem('ghost_keys', encrypted);
}

function loadKeys() {
  return localStorage.getItem('ghost_keys');
}

async function encryptKeysForStorage(keysObj, password) {
  const salt = sodium.randombytes_buf(16);
  const key = deriveKey(password, salt);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.from_string(JSON.stringify(keysObj));
  const cipher = sodium.crypto_secretbox(plaintext, nonce, key);
  return sodium.to_base64(salt) + ':' + sodium.to_base64(nonce) + ':' + sodium.to_base64(cipher);
}

async function decryptKeysFromStorage(data, password) {
  const [saltB64, nonceB64, cipherB64] = data.split(':');
  if (!saltB64 || !nonceB64 || !cipherB64) throw new Error('Invalid stored data');
  const salt = sodium.from_base64(saltB64);
  const nonce = sodium.from_base64(nonceB64);
  const cipher = sodium.from_base64(cipherB64);
  const key = deriveKey(password, salt);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
  return JSON.parse(sodium.to_string(plain));
}

// Generate keypair from BIP39 mnemonic
function deriveKeypairFromMnemonic(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedBytes = new Uint8Array(seed.slice(0, 32)); // Use first 32 bytes as Ed25519 seed
  
  // Generate Ed25519 keypair from seed
  const keypairSign = sodium.crypto_sign_seed_keypair(seedBytes);
  
  // Convert Ed25519 keys to X25519 for encryption
  const pubEncrypt = sodium.crypto_sign_ed25519_pk_to_curve25519(keypairSign.publicKey);
  const privEncrypt = sodium.crypto_sign_ed25519_sk_to_curve25519(keypairSign.privateKey);
  
  return {
    sign: keypairSign,
    encrypt: { publicKey: pubEncrypt, privateKey: privEncrypt }
  };
}

// Register user with backend
async function registerUser(username, publicKey, encKey) {
  try {
    const response = await fetch(`${serverUrl}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ghost-Auth': APP_SECRET
      },
      body: JSON.stringify({
        username: username,
        public_key: publicKey,
        encryption_key: encKey
      })
    });

    if (response.ok) {
      // Save user data to localStorage
      localStorage.setItem('ghost_username', username);
      localStorage.setItem('ghost_registered', 'true');
      return { success: true };
    } else if (response.status === 403) {
      alert('Invalid App Secret');
      return { success: false, error: 'forbidden' };
    } else if (response.status === 409) {
      alert('Username taken');
      return { success: false, error: 'conflict' };
    } else {
      alert('Registration failed. Please try again.');
      return { success: false, error: 'unknown' };
    }
  } catch (error) {
    console.error('Registration error:', error);
    alert('Network error during registration');
    return { success: false, error: 'network' };
  }
}

// Sync user list from backend
async function syncUserList() {
  try {
    const response = await fetch(`${serverUrl}/api/users`, {
      method: 'GET',
      headers: {
        'X-Ghost-Auth': APP_SECRET
      }
    });

    if (response.ok) {
      const users = await response.json();
      // Save to localStorage
      localStorage.setItem('ghost_users', JSON.stringify(users));
      // Update UI if needed (future enhancement)
      console.log('User list synced:', users.length, 'users');
      return users;
    } else if (response.status === 403) {
      console.error('Invalid App Secret for user sync');
      return [];
    } else {
      console.error('Failed to sync users:', response.status);
      return [];
    }
  } catch (error) {
    console.error('User sync error:', error);
    return [];
  }
}

// Auto-sync user list every 60 seconds
let userSyncInterval = null;
function startUserSync() {
  if (userSyncInterval) clearInterval(userSyncInterval);
  syncUserList(); // Initial sync
  userSyncInterval = setInterval(syncUserList, 60000); // Every 60 seconds
}

function renderMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'border border-gray-800 rounded px-3 py-2 bg-black/60 text-sm';
  if (msg.t === 'aud') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = `data:audio/webm;base64,${msg.c}`;
    wrapper.appendChild(audio);
  } else {
    wrapper.textContent = msg.c;
  }
  els.messages.appendChild(wrapper);
  while (els.messages.children.length > 10) {
    els.messages.removeChild(els.messages.firstChild);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function makePayload(type, content) {
  return { t: type, c: content };
}

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

function connectWs() {
  if (ws) ws.close();
  // Append ghost_auth to URL query for WebSocket authentication
  const wsUrlWithAuth = `${wsUrl}?ghost_auth=${encodeURIComponent(APP_SECRET)}`;
  ws = new WebSocket(wsUrlWithAuth);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => setWsState(true);
  ws.onclose = () => setWsState(false);
  ws.onerror = () => setWsState(false);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      const msg = decryptFromWire(data);
      renderMessage(msg);
    } catch (err) {
      console.error('Failed to decrypt message', err);
    }
  };
}

async function handleLogin() {
  await sodium.ready;
  const username = els.username.value.trim();
  const password = els.password.value;
  if (!username || !password) {
    alert('Username and password required');
    return;
  }

  const stored = loadKeys();
  if (!stored) {
    alert('No account found locally. Please use "Create New Account" or "Recover with Phrase".');
    return;
  }

  try {
    const keys = await decryptKeysFromStorage(stored, password);
    keypairSign = {
      publicKey: sodium.from_base64(keys.pubSign),
      privateKey: sodium.from_base64(keys.privSign),
    };
    keypairEncrypt = {
      publicKey: sodium.from_base64(keys.pubEncrypt),
      privateKey: sodium.from_base64(keys.privEncrypt),
    };
  } catch (e) {
    alert('Incorrect password');
    return;
  }

  els.loginCard.classList.add('hidden');
  els.chatCard.classList.remove('hidden');
  await syncUserList();
  startUserSync();
  connectWs();
}

async function handleRegister() {
  await sodium.ready;
  const username = els.username.value.trim();
  const password = els.password.value;
  if (!username || !password) {
    alert('Username and password required');
    return;
  }

  // Generate 12-word mnemonic
  const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words
  
  // Derive keypairs from mnemonic
  const keypairs = deriveKeypairFromMnemonic(mnemonic);
  keypairSign = keypairs.sign;
  keypairEncrypt = keypairs.encrypt;
  
  // Prepare keys for storage (including mnemonic)
  const keysObj = {
    pubSign: sodium.to_base64(keypairSign.publicKey),
    privSign: sodium.to_base64(keypairSign.privateKey),
    pubEncrypt: sodium.to_base64(keypairEncrypt.publicKey),
    privEncrypt: sodium.to_base64(keypairEncrypt.privateKey),
    mnemonic: mnemonic // Store the mnemonic encrypted
  };
  
  // Encrypt and save to localStorage
  const encrypted = await encryptKeysForStorage(keysObj, password);
  saveKeys(encrypted);
  
  // Register with backend
  const publicKeyB64 = sodium.to_base64(keypairSign.publicKey);
  const encKeyB64 = sodium.to_base64(keypairEncrypt.publicKey);
  await registerUser(username, publicKeyB64, encKeyB64);
  
  // Display mnemonic to user
  els.mnemonicDisplay.textContent = mnemonic;
  els.mnemonicModal.classList.remove('hidden');
}

async function handleRecover() {
  await sodium.ready;
  const username = els.recoverUsername.value.trim();
  const password = els.recoverPassword.value;
  const phrase = els.recoverPhrase.value.trim();
  
  if (!username || !password || !phrase) {
    alert('All fields are required for recovery');
    return;
  }
  
  // Validate mnemonic
  if (!bip39.validateMnemonic(phrase)) {
    alert('Invalid recovery phrase. Please check the words and try again.');
    return;
  }
  
  try {
    // Derive keypairs from mnemonic
    const keypairs = deriveKeypairFromMnemonic(phrase);
    keypairSign = keypairs.sign;
    keypairEncrypt = keypairs.encrypt;
    
    // Prepare keys for storage
    const keysObj = {
      pubSign: sodium.to_base64(keypairSign.publicKey),
      privSign: sodium.to_base64(keypairSign.privateKey),
      pubEncrypt: sodium.to_base64(keypairEncrypt.publicKey),
      privEncrypt: sodium.to_base64(keypairEncrypt.privateKey),
      mnemonic: phrase
    };
    
    // Encrypt and save to localStorage
    const encrypted = await encryptKeysForStorage(keysObj, password);
    saveKeys(encrypted);
    
    // Register with backend if not already registered
    const isRegistered = localStorage.getItem('ghost_registered');
    if (!isRegistered) {
      const publicKeyB64 = sodium.to_base64(keypairSign.publicKey);
      const encKeyB64 = sodium.to_base64(keypairEncrypt.publicKey);
      await registerUser(username, publicKeyB64, encKeyB64);
    }
    
    // Close recovery modal and show chat
    els.recoveryModal.classList.add('hidden');
    els.loginCard.classList.add('hidden');
    els.chatCard.classList.remove('hidden');
    await syncUserList();
    startUserSync();
    connectWs();
    
  } catch (e) {
    alert('Recovery failed. If you have an existing account with a different phrase, please contact admin to reset.');
    console.error(e);
  }
}

async function sendText() {
  const text = els.textInput.value.trim();
  if (!text) return;
  const payload = encryptForWire(makePayload('txt', text));
  ws?.send(JSON.stringify(payload));
  els.textInput.value = '';
}

async function startRecording() {
  recordedChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  let stopTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  }, 50000);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = async () => {
    clearTimeout(stopTimer);
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const base64 = await blobToBase64(blob);
    if (base64.length > 200000) {
      alert('Voice note too long');
      return;
    }
    const payload = encryptForWire(makePayload('aud', base64));
    ws?.send(JSON.stringify(payload));
  };

  mediaRecorder.start();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

els.loginBtn.addEventListener('click', handleLogin);
els.registerBtn.addEventListener('click', handleRegister);
els.recoverBtn.addEventListener('click', () => {
  els.recoveryModal.classList.remove('hidden');
});
els.cancelRecoverBtn.addEventListener('click', () => {
  els.recoveryModal.classList.add('hidden');
});
els.confirmRecoverBtn.addEventListener('click', handleRecover);
els.copyMnemonicBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(els.mnemonicDisplay.textContent);
  els.copyMnemonicBtn.textContent = '✓ Copied!';
  setTimeout(() => {
    els.copyMnemonicBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});
els.closeMnemonicBtn.addEventListener('click', async () => {
  els.mnemonicModal.classList.add('hidden');
  els.loginCard.classList.add('hidden');
  els.chatCard.classList.remove('hidden');
  await syncUserList();
  startUserSync();
  connectWs();
});
els.sendBtn.addEventListener('click', sendText);
els.recordBtn.addEventListener('mousedown', startRecording);
els.recordBtn.addEventListener('mouseup', stopRecording);
els.recordBtn.addEventListener('mouseleave', stopRecording);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (document.activeElement === els.textInput)) {
    sendText();
  }
});
