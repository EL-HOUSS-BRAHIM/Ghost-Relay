import sodium from 'https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.13/+esm';

const serverUrl = 'https://ghost-relay-server--el-houss-brahim.replit.app';
const wsUrl = 'wss://ghost-relay-server--el-houss-brahim.replit.app/ws';

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
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.querySelector('#status span:last-child'),
  wsDot: document.getElementById('wsDot'),
  wsState: document.getElementById('wsState'),
  messages: document.getElementById('messages'),
  textInput: document.getElementById('textInput'),
  sendBtn: document.getElementById('sendBtn'),
  recordBtn: document.getElementById('recordBtn'),
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
  ws = new WebSocket(wsUrl);
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
    alert('No account found. Please contact admin to create your account first.');
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
  connectWs();
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
els.sendBtn.addEventListener('click', sendText);
els.recordBtn.addEventListener('mousedown', startRecording);
els.recordBtn.addEventListener('mouseup', stopRecording);
els.recordBtn.addEventListener('mouseleave', stopRecording);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (document.activeElement === els.textInput)) {
    sendText();
  }
});
