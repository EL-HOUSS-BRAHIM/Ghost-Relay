// ============================================
// GLOBAL ERROR TRAPPING & DEBUG CONSOLE
// ============================================
function logToScreen(msg, type = 'INFO') {
  const consoleDiv = document.getElementById('debug-console');
  if (consoleDiv) {
    const line = document.createElement('div');
    line.innerText = `[${type}] ${msg}`;
    if (type === 'ERROR') line.style.color = 'red';
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
  }
}

// Trap system errors
window.onerror = function(msg, url, line) {
  logToScreen(`${msg} (Line: ${line})`, 'ERROR');
};

// Override console logs
const originalLog = console.log;
console.log = function(...args) {
  originalLog(...args);
  logToScreen(args.join(' '));
};
const originalErr = console.error;
console.error = function(...args) {
  originalErr(...args);
  logToScreen(args.join(' '), 'ERROR');
};

console.log("System booting...");

// Note: For Tauri desktop app, using direct require-style imports for bundling
// The bundler (esbuild) will resolve these from node_modules
const sodium = require('libsodium-wrappers');
const bip39 = require('bip39');
const { Buffer } = require('buffer');

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

// els object will be populated in DOMContentLoaded
let els = {};

// Screen switching helper function
function showScreen(screenId) {
  ['screen-login', 'screen-recovery', 'screen-chat'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.add('hidden');
    }
  });
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.remove('hidden');
  }
}

// Loading state helper function
function setLoading(btnId, isLoading, loadingText = "WAIT...") {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  if (isLoading) {
    btn.dataset.originalText = btn.innerText;
    btn.innerText = loadingText;
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "wait";
  } else {
    btn.innerText = btn.dataset.originalText || "ENTER";
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
  }
}

function setStatus(online) {
  if (els.statusDot) {
    els.statusDot.classList.toggle('status-online', online);
    els.statusDot.classList.toggle('status-offline', !online);
  }
  if (els.statusLabel) {
    els.statusLabel.textContent = online ? 'ONLINE' : 'OFFLINE';
    els.statusLabel.classList.toggle('online', online);
    els.statusLabel.classList.toggle('offline', !online);
  }
}

function setWsState(connected) {
  if (els.wsDot) {
    els.wsDot.classList.toggle('status-online', connected);
    els.wsDot.classList.toggle('status-offline', !connected);
  }
  if (els.wsState) {
    els.wsState.textContent = connected ? 'ONLINE' : 'OFFLINE';
    els.wsState.classList.toggle('online', connected);
    els.wsState.classList.toggle('offline', !connected);
  }
  setStatus(connected);
}

function deriveKey(password, salt) {
  console.log("[DEBUG] deriveKey called with password length:", password.length, "salt length:", salt.length);
  
  try {
    // Use crypto_generichash (BLAKE2b) instead of crypto_pwhash for browser compatibility
    if (typeof sodium.crypto_generichash === 'function') {
      console.log("[DEBUG] Using crypto_generichash for key derivation");
      
      // Combine password and salt
      const combined = new Uint8Array(password.length + salt.length);
      combined.set(new TextEncoder().encode(password), 0);
      combined.set(salt, password.length);
      
      // Hash with BLAKE2b to get 32-byte key
      const result = sodium.crypto_generichash(32, combined);
      console.log("[DEBUG] Key derivation successful with generichash, key length:", result.length);
      return result;
    } 
    // Fallback to crypto_hash_sha256 if generichash not available
    else if (typeof sodium.crypto_hash_sha256 === 'function') {
      console.log("[DEBUG] Using crypto_hash_sha256 for key derivation");
      
      // Combine password and salt
      const combined = new Uint8Array(password.length + salt.length);
      combined.set(new TextEncoder().encode(password), 0);
      combined.set(salt, password.length);
      
      const result = sodium.crypto_hash_sha256(combined);
      console.log("[DEBUG] Key derivation successful with sha256, key length:", result.length);
      return result;
    } else {
      throw new Error('No suitable hash function available in libsodium');
    }
  } catch (error) {
    console.error("[ERROR] Key derivation failed:", error);
    throw error;
  }
}

function saveKeys(encrypted) {
  localStorage.setItem('ghost_keys', encrypted);
}

function loadKeys() {
  return localStorage.getItem('ghost_keys');
}

async function encryptKeysForStorage(keysObj, password) {
  console.log("[DEBUG] encryptKeysForStorage called");
  
  try {
    const salt = sodium.randombytes_buf(16);
    const key = deriveKey(password, salt);
    const plaintext = sodium.from_string(JSON.stringify(keysObj));
    
    console.log("[DEBUG] Checking available encryption functions...");
    
    // Try different encryption methods available in browser libsodium
    let cipher, nonce;
    
    if (typeof sodium.crypto_aead_xchacha20poly1305_ietf_encrypt === 'function') {
      console.log("[DEBUG] Using crypto_aead_xchacha20poly1305_ietf_encrypt");
      nonce = sodium.randombytes_buf(24); // XChaCha20-Poly1305 nonce size
      cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, key);
    }
    else if (typeof sodium.crypto_aead_chacha20poly1305_ietf_encrypt === 'function') {
      console.log("[DEBUG] Using crypto_aead_chacha20poly1305_ietf_encrypt");
      nonce = sodium.randombytes_buf(12); // ChaCha20-Poly1305 nonce size  
      cipher = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, key);
    }
    else if (typeof sodium.crypto_box_seal === 'function') {
      console.log("[DEBUG] Using crypto_box_seal (anonymous encryption)");
      // For crypto_box_seal, we need a keypair from the key
      const keypair = sodium.crypto_box_seed_keypair(key);
      cipher = sodium.crypto_box_seal(plaintext, keypair.publicKey);
      nonce = new Uint8Array(0); // No nonce needed for seal
    } else {
      throw new Error('No suitable encryption function available');
    }
    
    console.log("[DEBUG] Encryption successful");
    return sodium.to_base64(salt) + ':' + sodium.to_base64(nonce) + ':' + sodium.to_base64(cipher);
    
  } catch (error) {
    console.error("[ERROR] Encryption failed:", error);
    throw error;
  }
}

async function decryptKeysFromStorage(data, password) {
  console.log("[DEBUG] decryptKeysFromStorage called");
  
  try {
    const [saltB64, nonceB64, cipherB64] = data.split(':');
    if (!saltB64 || !nonceB64 || !cipherB64) throw new Error('Invalid stored data');
    
    const salt = sodium.from_base64(saltB64);
    const nonce = sodium.from_base64(nonceB64);
    const cipher = sodium.from_base64(cipherB64);
    const key = deriveKey(password, salt);
    
    console.log("[DEBUG] Attempting decryption...");
    
    let plain;
    
    // Try different decryption methods based on nonce size
    if (nonce.length === 24 && typeof sodium.crypto_aead_xchacha20poly1305_ietf_decrypt === 'function') {
      console.log("[DEBUG] Using crypto_aead_xchacha20poly1305_ietf_decrypt");
      plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipher, null, nonce, key);
    }
    else if (nonce.length === 12 && typeof sodium.crypto_aead_chacha20poly1305_ietf_decrypt === 'function') {
      console.log("[DEBUG] Using crypto_aead_chacha20poly1305_ietf_decrypt");
      plain = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(null, cipher, null, nonce, key);
    }
    else if (nonce.length === 0 && typeof sodium.crypto_box_seal_open === 'function') {
      console.log("[DEBUG] Using crypto_box_seal_open");
      const keypair = sodium.crypto_box_seed_keypair(key);
      plain = sodium.crypto_box_seal_open(cipher, keypair.publicKey, keypair.privateKey);
    } else {
      throw new Error('No suitable decryption function available for nonce length: ' + nonce.length);
    }
    
    console.log("[DEBUG] Decryption successful");
    return JSON.parse(sodium.to_string(plain));
    
  } catch (error) {
    console.error("[ERROR] Decryption failed:", error);
    throw error;
  }
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
  wrapper.className = 'message-bubble rounded-xl px-4 py-3 text-sm animate-fadeIn';
  
  if (msg.t === 'aud') {
    const audioContainer = document.createElement('div');
    audioContainer.className = 'flex items-center space-x-3';
    
    const icon = document.createElement('span');
    icon.textContent = '🎤';
    icon.className = 'text-2xl';
    
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = `data:audio/webm;base64,${msg.c}`;
    audio.className = 'flex-1';
    
    audioContainer.appendChild(icon);
    audioContainer.appendChild(audio);
    wrapper.appendChild(audioContainer);
  } else {
    const textContainer = document.createElement('div');
    textContainer.className = 'flex items-start space-x-3';
    
    const icon = document.createElement('span');
    icon.textContent = '💬';
    icon.className = 'text-xl mt-0.5';
    
    const text = document.createElement('p');
    text.textContent = msg.c;
    text.className = 'flex-1 text-gray-100 leading-relaxed';
    
    textContainer.appendChild(icon);
    textContainer.appendChild(text);
    wrapper.appendChild(textContainer);
  }
  
  els.messages.appendChild(wrapper);
  
  // Keep last 20 messages
  while (els.messages.children.length > 20) {
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

  // Set loading state
  setLoading('btn-login', true, 'CONNECTING...');
  console.log("Attempting to reach server at " + serverUrl);

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

    showScreen('screen-chat');
    await syncUserList();
    startUserSync();
    connectWs();
  } catch (e) {
    alert('Incorrect password');
  } finally {
    setLoading('btn-login', false);
  }
}

async function handleRegister() {
  console.log("[DEBUG] Register button clicked!");
  try {
    console.log("[DEBUG] Checking if bip39 is available:", typeof bip39);
    console.log("[DEBUG] bip39 object:", bip39);
    
    if (typeof bip39 === 'undefined' || !bip39) {
      throw new Error('bip39 library not available');
    }
    
    if (typeof bip39.generateMnemonic !== 'function') {
      throw new Error('bip39.generateMnemonic is not a function');
    }
    
    await sodium.ready;
    console.log("[DEBUG] Sodium ready");
    
    const username = els.username.value.trim();
    const password = els.password.value;
    console.log("[DEBUG] Username:", username, "Password length:", password.length);
    
    if (!username || !password) {
      alert('Username and password required');
      return;
    }

    console.log("[DEBUG] Generating mnemonic...");
    // Generate 12-word mnemonic
    const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words
    console.log("[DEBUG] Mnemonic generated:", mnemonic.split(' ').length, "words");
    
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
    console.log("[DEBUG] Registration completed successfully");
  } catch (error) {
    console.error("[ERROR] Registration failed:", error);
    alert('Registration failed: ' + error.message);
  }
}

async function handleRecovery() {
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
  
  // Set loading state
  setLoading('btn-restore', true, 'RECOVERING...');
  
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
    showScreen('screen-chat');
    await syncUserList();
    startUserSync();
    connectWs();
    
  } catch (e) {
    alert('Recovery failed. If you have an existing account with a different phrase, please contact admin to reset.');
    console.error(e);
  } finally {
    setLoading('btn-restore', false);
  }
}

async function sendMessage() {
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

// ============================================
// DOM INITIALIZATION & EVENT LISTENERS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM Loaded. Attaching listeners...");

  // Initialize els object with DOM elements
  els = {
    loginCard: document.getElementById('screen-login'),
    chatCard: document.getElementById('screen-chat'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    loginBtn: document.getElementById('btn-login'),
    registerBtn: document.getElementById('btn-register'),
    recoverBtn: document.getElementById('link-recovery'),
    statusLabel: document.getElementById('status-indicator'),
    wsState: document.getElementById('status-indicator'),
    messages: document.getElementById('messages'),
    textInput: document.getElementById('text-input'),
    sendBtn: document.getElementById('btn-send'),
    recordBtn: document.getElementById('btn-record'),
    mnemonicModal: document.getElementById('modal-mnemonic'),
    mnemonicDisplay: document.getElementById('mnemonicDisplay'),
    copyMnemonicBtn: document.getElementById('btn-copy-mnemonic'),
    closeMnemonicBtn: document.getElementById('btn-close-mnemonic'),
    recoveryModal: document.getElementById('screen-recovery'),
    recoverUsername: document.getElementById('recover-username'),
    recoverPassword: document.getElementById('recover-password'),
    recoverPhrase: document.getElementById('recover-phrase'),
    confirmRecoverBtn: document.getElementById('btn-restore'),
    cancelRecoverBtn: document.getElementById('link-back-login'),
    logoutBtn: document.getElementById('btn-logout'),
  };

  // Login button
  if (els.loginBtn) {
    els.loginBtn.addEventListener('click', handleLogin);
    console.log("Login button attached.");
  } else {
    console.error("CRITICAL: Login button (id='btn-login') not found!");
  }

  // Register button
  if (els.registerBtn) {
    els.registerBtn.addEventListener('click', handleRegister);
    console.log("Register button attached.");
  } else {
    console.error("CRITICAL: Register button (id='btn-register') not found!");
  }

  // Recovery link
  if (els.recoverBtn) {
    els.recoverBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('screen-recovery');
    });
    console.log("Recovery link attached.");
  } else {
    console.error("CRITICAL: Recovery link (id='link-recovery') not found!");
  }

  // Cancel recovery button
  if (els.cancelRecoverBtn) {
    els.cancelRecoverBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('screen-login');
    });
    console.log("Back to login link attached.");
  } else {
    console.error("CRITICAL: Back to login link (id='link-back-login') not found!");
  }

  // Restore button (recovery screen)
  if (els.confirmRecoverBtn) {
    els.confirmRecoverBtn.addEventListener('click', handleRecovery);
    console.log("Restore button attached.");
  } else {
    console.error("CRITICAL: Restore button (id='btn-restore') not found!");
  }

  // Copy mnemonic button
  if (els.copyMnemonicBtn) {
    els.copyMnemonicBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(els.mnemonicDisplay.textContent);
      els.copyMnemonicBtn.textContent = '✓ COPIED!';
      setTimeout(() => {
        els.copyMnemonicBtn.textContent = 'COPY';
      }, 2000);
    });
    console.log("Copy mnemonic button attached.");
  } else {
    console.error("CRITICAL: Copy mnemonic button (id='btn-copy-mnemonic') not found!");
  }

  // Close mnemonic button
  if (els.closeMnemonicBtn) {
    els.closeMnemonicBtn.addEventListener('click', async () => {
      els.mnemonicModal.classList.add('hidden');
      showScreen('screen-chat');
      await syncUserList();
      startUserSync();
      connectWs();
    });
    console.log("Close mnemonic button attached.");
  } else {
    console.error("CRITICAL: Close mnemonic button (id='btn-close-mnemonic') not found!");
  }

  // Send button
  if (els.sendBtn) {
    els.sendBtn.addEventListener('click', sendMessage);
    console.log("Send button attached.");
  } else {
    console.error("CRITICAL: Send button (id='btn-send') not found!");
  }

  // Record button
  if (els.recordBtn) {
    els.recordBtn.addEventListener('mousedown', startRecording);
    els.recordBtn.addEventListener('mouseup', stopRecording);
    els.recordBtn.addEventListener('mouseleave', stopRecording);
    console.log("Record button attached.");
  } else {
    console.error("CRITICAL: Record button (id='btn-record') not found!");
  }

  // Logout button
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', () => {
      if (ws) ws.close();
      showScreen('screen-login');
      els.username.value = '';
      els.password.value = '';
      els.messages.innerHTML = '';
    });
    console.log("Logout button attached.");
  } else {
    console.error("CRITICAL: Logout button (id='btn-logout') not found!");
  }

  // Enter key handler for text input
  if (els.textInput) {
    els.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && document.activeElement === els.textInput) {
        e.preventDefault();
        sendMessage();
      }
    });
    console.log("Text input Enter key handler attached.");
  } else {
    console.error("CRITICAL: Text input (id='text-input') not found!");
  }

  console.log("All event listeners attached successfully!");
});
