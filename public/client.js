const socket = io();
let myUser = null;
let selectedFile = null;
let contextMessageId = null;
let editingMessageId = null;
let deletingMessageId = null;
let replyingTo = null;
let selectedAvatarEmoji = '👤';
let selectedAvatarColor = '#5865f2';
let selectedBannerColor = '#5865f2';
let currentChannel = 'geral';
let allChannels = {};

const EMOJI_AVATARS = ['🐱','🐶','🦊','🐼','🐨','🦁','🐸','🐙','🦄','🐲','🤖','👻','🎃','🦊','🦄','🐲','💀','👽','🤖','🦑','🎃','😈','🦇','🕷','🦂','🐍','🦎','🐙','🦈','🐳','🐋','🦁','🐯','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊'];

const COLORS = ['#5865f2','#eb459e','#57f287','#fee75c','#ed4245','#f47b67','#e8a84e','#45ddc0','#9b59b6','#e91e63','#00bcd4','#ff9800','#3f51b5','#009688','#795548','#607d8b'];

const EMOJIS = ['😀','😂','😍','🥰','😎','🤔','👍','👎','❤️','🔥','🎮','🎵','💀','🙌','💪','🎉','⭐','🚀','💎','🏆','😊','😢','😡','🤯','🥳','😋','🤗','😴','🤓','😈','👀','💯','✅','❌','⚡','🌟','💥','🎯','📌','🔗','🙏','👏','🤝','✋','💪','🧠','💎','🪐','🌈','🍕','🍔','🍟','🌮','🍦','☕','🍺','🍷'];

const THEMES = { dark: { bg: '#1a1a2e', sidebar: '#14142a', card: '#1e1e35', input: '#252540', hover: '#2e2e50', border: '#2a2a40', text: '#dcddde', muted: '#8e9297' }, light: { bg: '#f0f2f5', sidebar: '#ffffff', card: '#ffffff', input: '#e8eaed', hover: '#f0f2f5', border: '#d1d5db', text: '#1a1a2e', muted: '#6b7280' } };

function getColor(s) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return COLORS[Math.abs(h) % COLORS.length]; }
function getInitials(n) { return n.substring(0, 2).toUpperCase(); }
function formatTime(iso) { const d = new Date(iso); const t = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? `Hoje ${t}` : `${d.toLocaleDateString('pt-BR')} ${t}`; }
function formatDate(iso) { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); }
function formatSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function showToast(m, t='info') { const el = document.getElementById('toast'); el.textContent = m; el.className = `toast show ${t}`; setTimeout(() => el.className = 'toast hidden', 3500); }
function getStatusEmoji(s) { return { online:'🟢', idle:'🟡', dnd:'🔴', invisible:'⚫' }[s] || '⚫'; }
function getStatusText(s) { return { online:'Online', idle:'Ausente', dnd:'Nao perturbe', invisible:'Invisivel' }[s] || 'Offline'; }

// Sons estilo Discord
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
  if (!myUser?.settings?.sounds) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;
  function tone(freq, start, dur, vol, wave) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = wave || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.08, t + start);
    g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t + start); o.stop(t + start + dur);
  }
  if (type === 'join') {
    tone(587, 0, 0.12, 0.09, 'sine');
    tone(880, 0.08, 0.18, 0.07, 'sine');
  } else if (type === 'leave') {
    tone(880, 0, 0.1, 0.08, 'triangle');
    tone(523, 0.07, 0.22, 0.06, 'triangle');
  } else if (type === 'msg') {
    tone(800, 0, 0.08, 0.07, 'sine');
    tone(1000, 0.06, 0.1, 0.06, 'sine');
  } else if (type === 'notif') {
    tone(880, 0, 0.08, 0.07, 'sine');
    tone(1100, 0.07, 0.12, 0.06, 'sine');
  } else if (type === 'screenshare') {
    tone(660, 0, 0.06, 0.07, 'sine');
    tone(880, 0.04, 0.06, 0.07, 'sine');
    tone(1100, 0.08, 0.1, 0.06, 'sine');
  } else if (type === 'screenshareStop') {
    tone(1100, 0, 0.06, 0.07, 'sine');
    tone(880, 0.04, 0.06, 0.07, 'sine');
    tone(660, 0.08, 0.1, 0.06, 'sine');
  }
}

// ============= NOISE SUPPRESSION =============
let noiseSuppressionNodes = null;

const NOISE_LEVELS = {
  0: { label: 'Off', highpass: 0, gateThresh: -100, compThresh: -100, ratio: 1 },
  1: { label: 'Leve', highpass: 60, gateThresh: -50, compThresh: -40, ratio: 4 },
  2: { label: 'Medio', highpass: 80, gateThresh: -40, compThresh: -50, ratio: 8 },
  3: { label: 'Forte', highpass: 100, gateThresh: -35, compThresh: -55, ratio: 12 },
  4: { label: 'Max', highpass: 120, gateThresh: -30, compThresh: -60, ratio: 20 }
};

function applyNoiseLevel(level) {
  toggleSetting('noiseSuppression', level);
  if (noiseSuppressionNodes && noiseSuppressionNodes.active()) {
    const cfg = NOISE_LEVELS[level] || NOISE_LEVELS[0];
    if (noiseSuppressionNodes.highpass) noiseSuppressionNodes.highpass.frequency.value = cfg.highpass;
    if (noiseSuppressionNodes.gate) noiseSuppressionNodes.gate.threshold.value = cfg.gateThresh;
    if (noiseSuppressionNodes.compressor) noiseSuppressionNodes.compressor.threshold.value = cfg.compThresh;
    if (noiseSuppressionNodes.compressor) noiseSuppressionNodes.compressor.ratio.value = cfg.ratio;
  }
}

function applyNoiseSuppression(stream, level) {
  if (!stream || !stream.getAudioTracks().length) return stream;
  const cfg = NOISE_LEVELS[level] || NOISE_LEVELS[0];
  if (level === 0) return stream;

  const source = audioCtx.createMediaStreamSource(stream);
  const destination = audioCtx.createMediaStreamDestination();

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = cfg.highpass;
  highpass.Q.value = 0.7;

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = cfg.compThresh;
  compressor.knee.value = 20;
  compressor.ratio.value = cfg.ratio;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const gate = audioCtx.createDynamicsCompressor();
  gate.threshold.value = cfg.gateThresh;
  gate.knee.value = 10;
  gate.ratio.value = 20;
  gate.attack.value = 0.001;
  gate.release.value = 0.1;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0;

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(gate);
  gate.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(destination);

  let _active = true;
  let lastGateState = false;
  function checkGate() {
    if (!_active) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length;
    const gateOpen = avg > (5 + (level * 3));
    if (gateOpen !== lastGateState) {
      gainNode.gain.linearRampToValueAtTime(gateOpen ? 1.0 : 0.0, audioCtx.currentTime + 0.05);
      lastGateState = gateOpen;
    }
    requestAnimationFrame(checkGate);
  }
  checkGate();

  noiseSuppressionNodes = { source, highpass, compressor, gate, gainNode, analyser, destination, active: () => _active };

  const newStream = new MediaStream(destination.stream.getAudioTracks());
  return newStream;
}

function removeNoiseSuppression() {
  if (noiseSuppressionNodes) {
    const ns = noiseSuppressionNodes;
    try {
      if (ns.active) ns.active = () => false;
      ns.source.disconnect();
      ns.highpass.disconnect();
      ns.compressor.disconnect();
      ns.gate.disconnect();
      ns.gainNode.disconnect();
      ns.analyser.disconnect();
      ns.destination.disconnect();
    } catch (e) {}
    noiseSuppressionNodes = null;
  }
}

// ============= PARTICLES =============
function initParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 8 + 's';
    p.style.animationDuration = (6 + Math.random() * 8) + 's';
    container.appendChild(p);
  }
}

// ============= NAV =============
function hideAll() { ['welcomeScreen','loginScreen','registerScreen','avatarScreen','chatApp'].forEach(id => document.getElementById(id).classList.add('hidden')); }
function showWelcome() { hideAll(); document.getElementById('welcomeScreen').classList.remove('hidden'); initParticles(); }
function showLogin() { hideAll(); document.getElementById('loginScreen').classList.remove('hidden'); document.getElementById('loginEmail').focus(); }
function showRegister() { hideAll(); document.getElementById('registerScreen').classList.remove('hidden'); document.getElementById('regUsername').focus(); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ============= AUTH =============
async function doLogin() {
  const login = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  err.classList.add('hidden');
  if (!login || !password) { err.textContent = 'Preencha todos os campos'; err.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return; }
    myUser = data.user;
    localStorage.setItem('pulseUser', JSON.stringify(myUser));
    enterChat();
  } catch (e) { err.textContent = 'Erro de conexao'; err.classList.remove('hidden'); }
}

async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const err = document.getElementById('registerError');
  err.classList.add('hidden');
  if (!username || !email || !password) { err.textContent = 'Preencha todos os campos'; err.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return; }
    myUser = data.user;
    localStorage.setItem('pulseUser', JSON.stringify(myUser));
    showAvatarSelection();
  } catch (e) { err.textContent = 'Erro de conexao'; err.classList.remove('hidden'); }
}

// ============= AVATAR =============
function showAvatarSelection() {
  hideAll();
  document.getElementById('avatarScreen').classList.remove('hidden');
  selectedAvatarEmoji = myUser.avatarEmoji || '👤';
  selectedAvatarColor = myUser.avatarColor || '#5865f2';
  selectedBannerColor = myUser.bannerColor || myUser.avatarColor || '#5865f2';

  const emojiGrid = document.getElementById('emojiAvatarGrid');
  emojiGrid.innerHTML = '';
  EMOJI_AVATARS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-avatar-btn' + (e === selectedAvatarEmoji ? ' selected' : '');
    btn.textContent = e;
    btn.onclick = () => { selectedAvatarEmoji = e; updateAvatarPreview(); document.querySelectorAll('.emoji-avatar-btn').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); };
    emojiGrid.appendChild(btn);
  });

  const colorGrid = document.getElementById('colorGrid');
  colorGrid.innerHTML = '';
  COLORS.forEach(c => {
    const div = document.createElement('div');
    div.className = 'color-swatch' + (c === selectedAvatarColor ? ' selected' : '');
    div.style.background = c;
    div.onclick = () => { selectedAvatarColor = c; updateAvatarPreview(); document.querySelectorAll('#colorGrid .color-swatch').forEach(d => d.classList.remove('selected')); div.classList.add('selected'); };
    colorGrid.appendChild(div);
  });

  updateAvatarPreview();
}

function updateAvatarPreview() {
  const preview = document.getElementById('avatarPreviewLarge');
  const emoji = document.getElementById('avatarPreviewEmoji');
  preview.style.background = selectedAvatarColor;
  emoji.textContent = selectedAvatarEmoji;
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const res = await fetch('/api/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, base64: e.target.result, filename: file.name }) });
    const data = await res.json();
    if (data.success) { myUser = data.user; localStorage.setItem('pulseUser', JSON.stringify(myUser)); showToast('Avatar atualizado!', 'success'); }
    else showToast(data.error, 'error');
  };
  reader.readAsDataURL(file);
}

async function uploadAvatarEdit(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const res = await fetch('/api/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, base64: e.target.result, filename: file.name }) });
    const data = await res.json();
    if (data.success) { myUser = data.user; localStorage.setItem('pulseUser', JSON.stringify(myUser)); updateMyUI(); showToast('Avatar atualizado!', 'success'); }
    else showToast(data.error, 'error');
  };
  reader.readAsDataURL(file);
}

async function finishAvatar() {
  myUser.avatarEmoji = selectedAvatarEmoji;
  myUser.avatarColor = selectedAvatarColor;
  myUser.bannerColor = selectedBannerColor;
  await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, avatarEmoji: selectedAvatarEmoji, avatarColor: selectedAvatarColor, bannerColor: selectedBannerColor }) });
  localStorage.setItem('pulseUser', JSON.stringify(myUser));
  enterChat();
}

// ============= ENTER CHAT =============
function enterChat() {
  hideAll();
  document.getElementById('chatApp').classList.remove('hidden');
  updateMyUI();
  socket.emit('join', myUser.id);
  loadChannels();
  loadMessages();
  initEmojiPicker();
  applyTheme(myUser.settings?.theme || 'dark');
  applyFontSize(myUser.settings?.fontSize || 14);
  if (myUser.settings?.accentColor) applyAccent(myUser.settings.accentColor);
  applyAccessibility();
  loadFriends();
  const savedVoice = localStorage.getItem('pulseVoice');
  if (savedVoice) {
    try {
      const vc = JSON.parse(savedVoice);
      setTimeout(() => joinVoiceChannel(vc.guildId, vc.channelId), 1500);
    } catch (e) { localStorage.removeItem('pulseVoice'); }
  }
}

function updateMyUI() {
  const avatar = document.getElementById('myAvatar');
  if (myUser.avatar) {
    avatar.innerHTML = `<img src="${myUser.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    avatar.textContent = myUser.avatarEmoji || '👤';
    avatar.style.background = myUser.avatarColor || '#5865f2';
  }
  document.getElementById('myUsername').textContent = myUser.username;
  document.getElementById('myStatus').textContent = myUser.customStatus || getStatusText(myUser.status);
}

function checkSession() {
  const saved = localStorage.getItem('pulseUser');
  if (saved) { myUser = JSON.parse(saved); enterChat(); }
  else { showWelcome(); initParticles(); }
}

// ============= THEME =============
function applyTheme(theme) {
  const t = THEMES[theme] || THEMES.dark;
  const root = document.documentElement;
  Object.entries(t).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
  document.body.style.background = t.bg;
  if (myUser) { myUser.settings = myUser.settings || {}; myUser.settings.theme = theme; }
}

function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-size', size + 'px');
  document.querySelectorAll('.messages .msg-text').forEach(el => el.style.fontSize = size + 'px');
  if (myUser) { myUser.settings = myUser.settings || {}; myUser.settings.fontSize = parseInt(size); }
}

function toggleSetting(key, val) {
  if (!myUser) return;
  myUser.settings[key] = val;
  fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, settings: { [key]: val } }) });
  localStorage.setItem('pulseUser', JSON.stringify(myUser));
}

// ============= EMOJI PICKER =============
function initEmojiPicker() {
  const grid = document.getElementById('emojiGrid');
  if (grid.children.length > 0) return;
  EMOJIS.forEach(e => {
    const span = document.createElement('span');
    span.className = 'emoji-item';
    span.textContent = e;
    span.onclick = () => { document.getElementById('messageInput').value += e; document.getElementById('emojiPicker').classList.add('hidden'); };
    grid.appendChild(span);
  });
}

function toggleEmojiPicker() { document.getElementById('emojiPicker').classList.toggle('hidden'); }

// ============= FILE =============
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file || file.size > 10*1024*1024) { if (file) showToast('Maximo 10MB', 'error'); return; }
  selectedFile = file;
  const preview = document.getElementById('filePreview');
  const content = document.getElementById('filePreviewContent');
  content.innerHTML = '';
  if (file.type.startsWith('image/')) {
    const r = new FileReader();
    r.onload = (e) => { content.innerHTML = `<img src="${e.target.result}" class="preview-image"><span class="file-name">${escapeHtml(file.name)}</span>`; };
    r.readAsDataURL(file);
  } else if (file.type.startsWith('audio/')) {
    content.innerHTML = `<div class="preview-audio">🎙️ ${escapeHtml(file.name)} (${formatSize(file.size)})</div>`;
  } else {
    content.innerHTML = `<div class="preview-doc">📄 ${escapeHtml(file.name)} (${formatSize(file.size)})</div>`;
  }
  preview.classList.remove('hidden');
  event.target.value = '';
}

function removeFilePreview() { selectedFile = null; document.getElementById('filePreview').classList.add('hidden'); }

// ============= REPLY =============
function startReply(msgId, username, text) {
  replyingTo = { id: msgId, username, text: text.substring(0, 80) };
  document.getElementById('replyToName').textContent = username;
  document.getElementById('replyToText').textContent = replyingTo.text;
  document.getElementById('replyPreview').classList.remove('hidden');
  document.getElementById('messageInput').focus();
}

function cancelReply() { replyingTo = null; document.getElementById('replyPreview').classList.add('hidden'); }

// ============= SEND =============
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text && !selectedFile) return;

  const data = { text, channel: currentChannel, replyTo: replyingTo ? { id: replyingTo.id, username: replyingTo.username, text: replyingTo.text } : null };

  if (selectedFile) {
    const reader = new FileReader();
    reader.onload = (e) => {
      data.base64 = e.target.result;
      data.filename = selectedFile.name;
      data.fileType = selectedFile.type.startsWith('image/') ? 'image' : selectedFile.type.startsWith('audio/') ? 'audio' : 'file';
      data.size = selectedFile.size;
      socket.emit('fileMessage', data);
      removeFilePreview();
    };
    reader.readAsDataURL(selectedFile);
  } else {
    socket.emit('message', data);
  }

  input.value = '';
  cancelReply();
  socket.emit('stopTyping');
}

document.getElementById('messageInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } });
let typingTimeout;
document.getElementById('messageInput').addEventListener('input', () => {
  const data = {};
  if (currentGuild) { data.guildId = currentGuild.id; data.channel = currentChannel; }
  else if (currentDM) { data.dmId = currentDM.id; }
  socket.emit('typing', data);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('stopTyping', data), 2000);
});

// ============= AUDIO RECORDER =============
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let recAnalyser = null;
let recAnimFrame = null;

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const cfg = NOISE_LEVELS[myUser?.settings?.noiseSuppression || 0] || NOISE_LEVELS[0];
    let processedStream = stream;
    if (cfg.label !== 'Off') processedStream = applyNoiseSuppression(stream, myUser.settings.noiseSuppression);

    audioChunks = [];
    mediaRecorder = new MediaRecorder(processedStream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });

    const audioCtxRec = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtxRec.createMediaStreamSource(processedStream);
    recAnalyser = audioCtxRec.createAnalyser();
    recAnalyser.fftSize = 64;
    source.connect(recAnalyser);

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(recAnimFrame);
      audioCtxRec.close();
    };

    mediaRecorder.start(100);
    recordingStartTime = Date.now();
    recordingTimer = setInterval(updateRecTimer, 100);
    document.getElementById('recordingBar').classList.remove('hidden');
    document.getElementById('messageInput').disabled = true;
    initWaveformBars();
    drawRecWaveform();
  } catch (e) {
    showToast('Microfone negado', 'error');
  }
}

function initWaveformBars() {
  const container = document.getElementById('recWaveform');
  container.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = '2px';
    container.appendChild(bar);
  }
}

function drawRecWaveform() {
  if (!recAnalyser) return;
  const data = new Uint8Array(recAnalyser.frequencyBinCount);
  recAnalyser.getByteFrequencyData(data);
  const bars = document.querySelectorAll('#recWaveform .bar');
  const step = Math.floor(data.length / bars.length);
  bars.forEach((bar, i) => {
    const val = data[i * step] || 0;
    bar.style.height = Math.max(2, (val / 255) * 32) + 'px';
  });
  recAnimFrame = requestAnimationFrame(drawRecWaveform);
}

function updateRecTimer() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  document.getElementById('recTimer').textContent = `${m}:${s}`;
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(recordingTimer);
    document.getElementById('recordingBar').classList.add('hidden');
    document.getElementById('messageInput').disabled = false;
    document.getElementById('messageInput').focus();
  }
}

function cancelRecording() {
  audioChunks = [];
  stopRecording();
}

function sendRecording() {
  if (!audioChunks.length) { stopRecording(); return; }
  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const blob = new Blob(audioChunks, { type: mimeType });
  const file = new File([blob], `audio-${Date.now()}.webm`, { type: mimeType });

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = { text: '', channel: currentChannel, base64: e.target.result, filename: file.name, fileType: 'audio', size: file.size, replyTo: replyingTo ? { id: replyingTo.id, username: replyingTo.username, text: replyingTo.text } : null, guildId: currentGuild?.id || null, dmId: currentDM?.id || null };
    socket.emit('fileMessage', data);
    cancelReply();
  };
  reader.readAsDataURL(file);
  audioChunks = [];
  stopRecording();
}

// ============= RENDER MESSAGE =============
function renderMessage(msg) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message' + (msg.pinned ? ' pinned' : '');
  div.id = `msg-${msg.id}`;
  div.dataset.userId = msg.userId || '';

  // Reply
  let replyHtml = '';
  if (msg.replyTo) {
    replyHtml = `<div class="msg-reply"><span class="reply-author">@${escapeHtml(msg.replyTo.username)}</span> <span class="reply-text">${escapeHtml(msg.replyTo.text)}</span></div>`;
  }

  // File
  let fileHtml = '';
  if (msg.file) {
    if (msg.file.type === 'image') fileHtml = `<div class="msg-file"><img src="${msg.file.url}" class="msg-image" onclick="window.open('${msg.file.url}','_blank')"><div class="file-info">${escapeHtml(msg.file.name)} (${formatSize(msg.file.size)})</div></div>`;
    else if (msg.file.type === 'audio') fileHtml = `<div class="msg-file"><audio controls src="${msg.file.url}" class="msg-audio"></audio><div class="file-info">${escapeHtml(msg.file.name)}</div></div>`;
    else fileHtml = `<div class="msg-file"><a href="${msg.file.url}" target="_blank" class="msg-doc">📄 ${escapeHtml(msg.file.name)}<span>${formatSize(msg.file.size)}</span></a></div>`;
  }

  // Reactions
  let reactionsHtml = '';
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    reactionsHtml = '<div class="reactions">';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      const active = users.includes(myUser?.username) ? ' active' : '';
      reactionsHtml += `<button class="reaction-btn${active}" onclick="toggleReaction(${msg.id},'${emoji}')">${emoji} <span>${users.length}</span></button>`;
    }
    reactionsHtml += `<button class="reaction-add" onclick="showQuickReact(event,${msg.id})">+</button></div>`;
  }

  // Mention highlight
  let textHtml = escapeHtml(msg.text);
  if (msg.mentions?.includes(myUser?.id)) {
    textHtml = textHtml.replace(/@(\w+)/g, '<span class="mention-highlight">@$1</span>');
    div.classList.add('mentioned');
  }

  const isOwn = msg.userId === myUser?.id;
  const avatarContent = msg.avatar ? `<img src="${msg.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (msg.avatarEmoji || '👤');

  div.innerHTML = `
    <div class="msg-avatar clickable" onclick="openUserProfile('${msg.userId}')" style="background:${msg.avatarColor || getColor(msg.username)}">${avatarContent}</div>
    <div class="msg-content">
      <div class="msg-header">
        <span class="msg-username clickable" onclick="openUserProfile('${msg.userId}')" style="color:${msg.avatarColor || getColor(msg.username)}">${escapeHtml(msg.username)}</span>
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        ${msg.edited ? '<span class="msg-edited">(editado)</span>' : ''}
        ${msg.pinned ? '<span class="msg-pin-badge">📌</span>' : ''}
      </div>
      ${replyHtml}
      <div class="msg-text">${textHtml}</div>
      ${fileHtml}
      ${reactionsHtml}
    </div>
    ${isOwn ? `<div class="msg-menu-btn" onclick="showContextMenu(event,${msg.id},'${escapeHtml(msg.username)}','${escapeHtml(msg.text)}')">⋯</div>` : `<div class="msg-menu-btn react-btn" onclick="showQuickReact(event,${msg.id})">😀</div>`}
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ============= CONTEXT MENU =============
function showContextMenu(event, msgId, username, text) {
  event.preventDefault(); event.stopPropagation();
  contextMessageId = msgId;
  const menu = document.getElementById('contextMenu');
  menu.classList.remove('hidden');
  let x = event.clientX, y = event.clientY;
  if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
  if (y + 300 > window.innerHeight) y = window.innerHeight - 310;
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.context-menu')) document.getElementById('contextMenu').classList.add('hidden');
  if (!e.target.closest('.emoji-picker') && !e.target.closest('[onclick*="toggleEmojiPicker"]')) document.getElementById('emojiPicker')?.classList.add('hidden');
});

function contextEdit() { editingMessageId = contextMessageId; document.getElementById('editInput').value = document.querySelector(`#msg-${contextMessageId} .msg-text`)?.textContent || ''; document.getElementById('editModal').classList.remove('hidden'); document.getElementById('contextMenu').classList.add('hidden'); }
function contextDelete() { deletingMessageId = contextMessageId; document.getElementById('deleteModal').classList.remove('hidden'); document.getElementById('contextMenu').classList.add('hidden'); }
function contextPin() { socket.emit('pinMessage', { id: contextMessageId }); document.getElementById('contextMenu').classList.add('hidden'); }
function contextReact(emoji) { socket.emit('addReaction', { id: contextMessageId, emoji }); document.getElementById('contextMenu').classList.add('hidden'); }
function contextReply() { const msg = document.getElementById(`msg-${contextMessageId}`); if (msg) { const u = msg.querySelector('.msg-username')?.textContent; const t = msg.querySelector('.msg-text')?.textContent; startReply(contextMessageId, u, t); } document.getElementById('contextMenu').classList.add('hidden'); }

// ============= MODALS =============
function closeEditModal() { document.getElementById('editModal').classList.add('hidden'); }
function confirmEdit() { const text = document.getElementById('editInput').value.trim(); if (text && editingMessageId) socket.emit('editMessage', { id: editingMessageId, text }); closeEditModal(); }
document.getElementById('editInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmEdit(); });
function closeDeleteModal() { document.getElementById('deleteModal').classList.add('hidden'); }
function confirmDelete() { if (deletingMessageId) socket.emit('deleteMessage', { id: deletingMessageId }); closeDeleteModal(); }

// ============= REACTIONS =============
function toggleReaction(msgId, emoji) { socket.emit('addReaction', { id: msgId, emoji }); }

function showQuickReact(event, msgId) {
  event.stopPropagation();
  document.querySelectorAll('.quick-react').forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = 'quick-react';
  div.style.left = Math.min(event.clientX, window.innerWidth - 280) + 'px';
  div.style.top = (event.clientY - 44) + 'px';
  ['👍','❤️','😂','😮','😢','🔥'].forEach(e => {
    const btn = document.createElement('button');
    btn.textContent = e;
    btn.onclick = (ev) => { ev.stopPropagation(); toggleReaction(msgId, e); div.remove(); };
    div.appendChild(btn);
  });
  document.body.appendChild(div);
  setTimeout(() => document.addEventListener('click', function rm() { div.remove(); document.removeEventListener('click', rm); }, { once: true }), 10);
}

// ============= PINS =============
function togglePins() { document.getElementById('pinsPanel').classList.toggle('hidden'); }

function toggleFilesPanel() {
  const panel = document.getElementById('filesPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) loadChannelFiles();
}

async function loadChannelFiles() {
  if (!currentGuild || !currentChannel) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/channels/${currentChannel}/messages?limit=200`);
    const msgs = await res.json();
    const files = msgs.filter(m => m.file).map(m => ({ ...m, fileInfo: m.file }));
    const list = document.getElementById('filesList');
    list.innerHTML = '';
    if (!files.length) { list.innerHTML = '<div style="padding:16px;color:var(--muted);text-align:center;">Nenhum arquivo compartilhado</div>'; return; }
    files.reverse().forEach(m => {
      const div = document.createElement('div');
      div.className = 'pin-item';
      const isImage = m.fileInfo.type?.startsWith('image/');
      div.innerHTML = isImage
        ? `<img src="${m.fileInfo.url}" style="width:100%;max-height:200px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="window.open('${m.fileInfo.url}','_blank')">`
        : `<a href="${m.fileInfo.url}" target="_blank" style="color:var(--accent);font-size:13px;">📄 ${escapeHtml(m.fileInfo.name)}</a>`;
      div.innerHTML += `<div style="font-size:11px;color:var(--muted);margin-top:4px;">${escapeHtml(m.username)} - ${formatTime(m.timestamp || m.createdAt)}</div>`;
      list.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

function renderPins(pins) {
  const list = document.getElementById('pinsList');
  list.innerHTML = '';
  document.getElementById('pinCount').textContent = pins.length;
  if (!pins.length) { list.innerHTML = '<div class="pin-empty">Nenhuma mensagem fixada</div>'; return; }
  pins.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pin-item';
    div.innerHTML = `<div class="pin-author" style="color:${getColor(p.username)}">${escapeHtml(p.username)}</div><div class="pin-text">${escapeHtml(p.text)}</div><div class="pin-time">${formatTime(p.timestamp)}</div>`;
    list.appendChild(div);
  });
}

// ============= LOAD =============
async function loadMessages() {
  try {
    const res = await fetch('/api/messages');
    const allMsgs = await res.json();
    messages_cache = allMsgs;
    allMsgs.filter(m => (m.channel || 'geral') === currentChannel).forEach(renderMessage);
    const pinsRes = await fetch('/api/pins');
    renderPins(await pinsRes.json());
  } catch (e) { console.error(e); }
}

function addSystemMessage(text) {
  const c = document.getElementById('messages');
  const d = document.createElement('div');
  d.className = 'system-message';
  d.textContent = text;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}

// ============= FRIENDS =============
async function loadFriends() {
  if (!myUser) return;
  try {
    const res = await fetch(`/api/friends/${myUser.id}`);
    const data = await res.json();
    renderFriendsList(data.friends);
    renderFriendRequests(data.requests);
  } catch (e) { console.error(e); }
}

function renderFriendsList(friends) {
  const list = document.getElementById('friendsListSidebar');
  if (!list) return;
  list.innerHTML = '';
  if (!friends.length) { list.innerHTML = '<div class="no-friends">Nenhum amigo ainda</div>'; return; }
  friends.forEach(f => {
    const div = document.createElement('div');
    div.className = 'friend-item';
    const avatarContent = f.avatar ? `<img src="${f.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (f.avatarEmoji || '👤');
    div.innerHTML = `
      <div class="member-avatar" style="background:${f.avatarColor || '#5865f2'}">${avatarContent}</div>
      <div class="member-info">
        <span class="member-name">${escapeHtml(f.username)}</span>
        <span class="member-status-text">${f.customStatus || getStatusText(f.status)}</span>
      </div>
      <button class="dm-btn" onclick="event.stopPropagation();startDMWith('${f.id}')" title="Enviar mensagem">💬</button>
      <div class="status-dot ${f.status || 'offline'}"></div>
    `;
    div.onclick = () => openUserProfile(f.id);
    list.appendChild(div);
  });
}

function renderFriendRequests(requests) {
  const existing = document.querySelector('.friend-requests');
  if (existing) existing.remove();
  if (!requests?.length) return;

  const container = document.getElementById('friendsSidebar');
  const div = document.createElement('div');
  div.className = 'friend-requests';
  div.innerHTML = `<div class="channel-category">PEDIDOS (${requests.length})</div>`;
  requests.forEach(r => {
    const item = document.createElement('div');
    item.className = 'friend-request-item';
    const avatarContent = r.avatar ? `<img src="${r.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (r.avatarEmoji || '👤');
    item.innerHTML = `
      <div class="member-avatar small" style="background:${r.avatarColor || '#5865f2'}">${avatarContent}</div>
      <span class="member-name">${escapeHtml(r.username)}</span>
      <button class="btn-accept" onclick="event.stopPropagation(); acceptFriend('${r.id}')">✓</button>
    `;
    div.appendChild(item);
  });
  container.insertBefore(div, container.firstChild.nextSibling);
}

function acceptFriend(fromId) { socket.emit('acceptFriend', { fromId }); loadFriends(); }

function openAddFriendModal() { document.getElementById('friendSearchInput').value = ''; document.getElementById('friendSearchResults').innerHTML = ''; document.getElementById('addFriendError').classList.add('hidden'); document.getElementById('addFriendModal').classList.remove('hidden'); }

async function searchUsers() {
  const q = document.getElementById('friendSearchInput').value.trim();
  const results = document.getElementById('friendSearchResults');
  if (!q) { results.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = await res.json();
    results.innerHTML = '';
    users.filter(u => u.id !== myUser?.id).forEach(u => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      const avatarContent = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (u.avatarEmoji || '👤');
      div.innerHTML = `
        <div class="member-avatar" style="background:${u.avatarColor || '#5865f2'}">${avatarContent}</div>
        <span class="member-name">${escapeHtml(u.username)}</span>
        <button class="btn-small" onclick="sendFriendRequest('${escapeHtml(u.username)}')">Adicionar</button>
      `;
      results.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

function sendFriendRequest(username) { socket.emit('sendFriendRequest', { username }); }

// ============= EDIT PROFILE =============
function openEditProfileModal() {
  document.getElementById('editStatus').value = myUser.status || 'online';
  document.getElementById('editCustomStatus').value = myUser.customStatus || '';
  document.getElementById('editBio').value = myUser.bio || '';
  selectedAvatarEmoji = myUser.avatarEmoji || '👤';
  selectedAvatarColor = myUser.avatarColor || '#5865f2';
  selectedBannerColor = myUser.bannerColor || myUser.avatarColor || '#5865f2';

  const emojiGrid = document.getElementById('editEmojiGrid');
  emojiGrid.innerHTML = '';
  EMOJI_AVATARS.slice(0, 30).forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-avatar-btn small' + (e === selectedAvatarEmoji ? ' selected' : '');
    btn.textContent = e;
    btn.onclick = () => { selectedAvatarEmoji = e; updateEditPreview(); document.querySelectorAll('#editEmojiGrid .emoji-avatar-btn').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); };
    emojiGrid.appendChild(btn);
  });

  const colorGrid = document.getElementById('editColorGrid');
  colorGrid.innerHTML = '';
  COLORS.forEach(c => {
    const div = document.createElement('div');
    div.className = 'color-swatch small' + (c === selectedAvatarColor ? ' selected' : '');
    div.style.background = c;
    div.onclick = () => { selectedAvatarColor = c; updateEditPreview(); document.querySelectorAll('#editColorGrid .color-swatch').forEach(d => d.classList.remove('selected')); div.classList.add('selected'); };
    colorGrid.appendChild(div);
  });

  const bannerGrid = document.getElementById('editBannerGrid');
  bannerGrid.innerHTML = '';
  COLORS.forEach(c => {
    const div = document.createElement('div');
    div.className = 'color-swatch small' + (c === selectedBannerColor ? ' selected' : '');
    div.style.background = c;
    div.onclick = () => { selectedBannerColor = c; document.querySelectorAll('#editBannerGrid .color-swatch').forEach(d => d.classList.remove('selected')); div.classList.add('selected'); };
    bannerGrid.appendChild(div);
  });

  updateEditPreview();
  document.getElementById('editProfileModal').classList.remove('hidden');
}

function updateEditPreview() {
  const preview = document.getElementById('editAvatarPreview');
  preview.textContent = selectedAvatarEmoji;
  preview.style.background = selectedAvatarColor;
}

async function saveProfile() {
  const status = document.getElementById('editStatus').value;
  const customStatus = document.getElementById('editCustomStatus').value.trim();
  const bio = document.getElementById('editBio').value.trim();

  myUser.status = status;
  myUser.customStatus = customStatus;
  myUser.bio = bio;
  myUser.avatarEmoji = selectedAvatarEmoji;
  myUser.avatarColor = selectedAvatarColor;
  myUser.bannerColor = selectedBannerColor;

  await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, bio, customStatus, status, avatarEmoji: selectedAvatarEmoji, avatarColor: selectedAvatarColor, bannerColor: selectedBannerColor }) });
  localStorage.setItem('pulseUser', JSON.stringify(myUser));
  socket.emit('updateProfile', { bio, customStatus, status, avatarEmoji: selectedAvatarEmoji, avatarColor: selectedAvatarColor, bannerColor: selectedBannerColor });
  updateMyUI();
  closeModal('editProfileModal');
  showToast('Perfil atualizado!', 'success');
}

// ============= USER PROFILE =============
async function openUserProfile(userId) {
  if (!userId || userId === myUser?.id) { openEditProfileModal(); return; }
  try {
    const res = await fetch(`/api/user/${userId}`);
    const user = await res.json();
    const p = user.privacy || {};
    const isFriend = myUser.friends?.includes(userId);
    const isMe = userId === myUser.id;

    // Respeitar privacidade
    document.getElementById('profileName').textContent = user.username;
    document.getElementById('profileCustomStatus').textContent = (p.showStatus !== false) ? (user.customStatus || getStatusText(user.status)) : 'Oculto';
    document.getElementById('profileBio').textContent = (p.showBio !== false) ? (user.bio || 'Nenhuma bio.') : 'Oculto';
    document.getElementById('profileJoined').textContent = (p.showLastSeen !== false) ? formatDate(user.createdAt) : 'Oculto';
    document.getElementById('profileMsgCount').textContent = user.stats?.messagesSent || 0;
    document.getElementById('profileReactCount').textContent = user.stats?.reactionsGiven || 0;

    const avatar = document.getElementById('profileAvatarLarge');
    if (user.avatar) { avatar.innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`; }
    else { avatar.textContent = user.avatarEmoji || '👤'; avatar.style.background = user.avatarColor || '#5865f2'; }

    document.getElementById('profileBanner').style.background = user.bannerColor || user.avatarColor || '#5865f2';

    const actions = document.getElementById('profileActions');
    let actionsHtml = '';
    if (!isMe) {
      actionsHtml += `<button class="btn-outline small" onclick="closeModal('profileModal');openAddFriendModal()">💬 Mensagem</button>`;
      if (!isFriend) actionsHtml += `<button class="btn-outline small" onclick="socket.emit('sendFriendRequest',{username:'${user.username}'});showToast('Pedido enviado!','info');">➕ Amigo</button>`;
      if (isFriend) actionsHtml += `<button class="btn-outline small danger" onclick="socket.emit('removeFriend',{friendId:'${userId}'});showToast('Amizade removida','info');closeModal('profileModal');">💔 Remover</button>`;
      actionsHtml += `<button class="btn-outline small" style="border-color:var(--danger);color:var(--danger);" onclick="blockUser('${userId}');closeModal('profileModal');">🚫 Bloquear</button>`;
    }
    actions.innerHTML = actionsHtml;
    document.getElementById('profileModal').classList.remove('hidden');
  } catch (e) { showToast('Erro ao carregar perfil', 'error'); }
}

// ============= SETTINGS =============
function openSettingsModal() {
  const s = myUser.settings || {};
  document.getElementById('settingTheme').value = s.theme || 'dark';
  document.getElementById('settingFontSize').value = s.fontSize || 14;
  document.getElementById('settingNotifications').checked = s.notifications !== false;
  document.getElementById('settingSounds').checked = s.sounds !== false;
  document.getElementById('accountInfo').textContent = `${myUser.username} • ${myUser.email}`;
  document.getElementById('settingOldPass').value = '';
  document.getElementById('settingNewPass').value = '';

  // Mensagens
  document.getElementById('settingCompactEmbeds').checked = s.compactEmbeds !== false;
  document.getElementById('settingAutoUpload').checked = s.autoUpload !== false;
  document.getElementById('settingPasteImages').checked = s.pasteImages !== false;
  document.getElementById('settingInlineEmbeds').checked = s.inlineEmbeds !== false;
  document.getElementById('settingMarkdown').checked = s.markdown !== false;

  // Audio & Video
  document.getElementById('settingAudioQuality').value = s.audioQuality || 'medium';
  document.getElementById('settingDefaultCamera').value = s.defaultCamera || 'user';
  document.getElementById('settingPushToTalk').checked = !!s.pushToTalk;
  document.getElementById('settingNoiseSuppression').value = s.noiseSuppression || 0;
  document.getElementById('noiseSupVal').textContent = (NOISE_LEVELS[s.noiseSuppression || 0] || NOISE_LEVELS[0]).label;
  document.getElementById('settingMicGain').value = s.micGain || 100;
  document.getElementById('micGainVal').textContent = (s.micGain || 100) + '%';
  document.getElementById('settingAutoGain').checked = s.autoGain !== false;
  if (s.vadThreshold) { window.vadThreshold = +s.vadThreshold; document.getElementById('settingVadThreshold').value = s.vadThreshold; document.getElementById('vadThreshVal').textContent = s.vadThreshold; }

  // Acessibilidade
  document.getElementById('settingHighContrast').checked = !!s.highContrast;
  document.getElementById('settingReduceMotion').checked = !!s.reduceMotion;
  document.getElementById('settingScreenReader').checked = !!s.screenReader;
  document.getElementById('settingEmojiSize').value = s.emojiSize || 'medium';
  document.getElementById('settingDisableAutoplay').checked = !!s.disableAutoplay;
  document.getElementById('settingTextToSpeech').checked = !!s.textToSpeech;

  // Idioma & Personalizacao
  document.getElementById('settingLanguage').value = s.language || 'pt-BR';
  document.getElementById('settingAnimations').checked = s.animations !== false;
  document.getElementById('settingShowTimestamps').checked = s.showTimestamps !== false;
  document.getElementById('settingCompactMode').checked = !!s.compactMode;

  // Accent color active
  document.querySelectorAll('.accent-btn').forEach(b => b.classList.remove('active'));
  const accent = s.accentColor || '#5865F2';
  document.querySelectorAll('.accent-btn').forEach(b => {
    if (b.style.background === accent || rgbToHex(b.style.background) === accent) b.classList.add('active');
  });

  // Privacidade
  const p = myUser.privacy || {};
  document.getElementById('settingPrivateProfile').checked = !!p.privateProfile;
  document.getElementById('settingDmOnlyFriends').checked = !!p.dmOnlyFriends;
  document.getElementById('settingShowStatus').checked = p.showStatus !== false;
  document.getElementById('settingShowBio').checked = p.showBio !== false;

  document.getElementById('settingsModal').classList.remove('hidden');
}

function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('');
}

function applyAccent(color, btn) {
  document.documentElement.style.setProperty('--accent', color);
  document.querySelectorAll('.accent-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  toggleSetting('accentColor', color);
}

function applyAccessibility() {
  const s = myUser.settings || {};

  // Alto contraste
  if (s.highContrast) {
    document.documentElement.style.setProperty('--text', '#ffffff');
    document.documentElement.style.setProperty('--muted', '#b9bbbe');
  }

  // Reduzir movimento
  if (s.reduceMotion) {
    document.documentElement.style.setProperty('--transition', '0s');
    document.querySelectorAll('*').forEach(el => el.style.animationDuration = '0s');
  } else {
    document.documentElement.style.setProperty('--transition', '0.2s');
  }

  // Animacoes
  if (s.animations === false) {
    document.documentElement.style.setProperty('--transition', '0s');
  }

  // Tamanho de emoji
  const emojiSizes = { small: '16px', medium: '22px', large: '32px', xlarge: '44px' };
  document.documentElement.style.setProperty('--emoji-size', emojiSizes[s.emojiSize] || '22px');

  // Modo compacto
  if (s.compactMode) {
    document.documentElement.style.setProperty('--font-size', '12px');
  }
}

async function changePassword() {
  const oldP = document.getElementById('settingOldPass').value;
  const newP = document.getElementById('settingNewPass').value;
  if (!oldP || !newP) { showToast('Preencha ambos os campos', 'error'); return; }
  const res = await fetch('/api/change-password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, oldPassword: oldP, newPassword: newP }) });
  const data = await res.json();
  if (data.success) { showToast('Senha alterada!', 'success'); document.getElementById('settingOldPass').value = ''; document.getElementById('settingNewPass').value = ''; }
  else showToast(data.error, 'error');
}

function logout() {
  localStorage.removeItem('pulseUser');
  myUser = null;
  socket.disconnect();
  location.reload();
}

// ============= CANAIS =============
let allCategories = {};

async function loadChannels() {
  try {
    const [chRes, catRes] = await Promise.all([
      fetch(`/api/channels?userId=${myUser?.id || ''}`),
      fetch('/api/categories')
    ]);
    allChannels = await chRes.json();
    allCategories = await catRes.json();
    renderChannels();
  } catch (e) { console.error(e); }
}

function renderChannels() {
  const textContainer = document.getElementById('textChannels');
  const voiceContainer = document.getElementById('voiceChannels');
  if (!textContainer || !voiceContainer) return;
  textContainer.innerHTML = '';
  voiceContainer.innerHTML = '';

  const sorted = Object.values(allChannels).sort((a, b) => (a.position || 0) - (b.position || 0));

  sorted.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel' + (ch.id === currentChannel ? ' active' : '');
    if (ch.locked) div.classList.add('locked');
    if (ch.isPrivate) div.classList.add('private');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'channel-name-text';
    nameSpan.textContent = ch.name;

    const iconsSpan = document.createElement('span');
    iconsSpan.className = 'channel-icons';
    if (ch.locked) iconsSpan.innerHTML += '🔒';
    if (ch.isPrivate) iconsSpan.innerHTML += '🔑';

    div.textContent = (ch.type === 'voice' ? '🔊 ' : '# ');
    div.appendChild(nameSpan);
    if (iconsSpan.innerHTML) div.appendChild(iconsSpan);

    div.onclick = () => {
      if (ch.type === 'voice') {
        if (currentGuild) joinVoiceChannel(currentGuild.id, ch.id);
        else showToast('Selecione um servidor para entrar na voz', 'error');
      } else {
        switchChannel(ch.id);
      }
    };
    div.oncontextmenu = (e) => { e.preventDefault(); showChannelContext(e, ch.id, ch.name, ch); };
    if (ch.id === currentChannel) div.classList.add('active');

    if (ch.type === 'voice') voiceContainer.appendChild(div);
    else textContainer.appendChild(div);
  });

  updateChannelHeader();
}

function updateChannelHeader() {
  const ch = allChannels[currentChannel];
  if (!ch) return;
  const lockIcon = ch.locked ? ' 🔒' : '';
  document.querySelector('.channel-name').textContent = (ch.type === 'voice' ? '' : '# ') + ch.name + lockIcon;
  document.getElementById('messageInput').placeholder = ch.locked ? 'Canal trancado...' : `Enviar mensagem para #${ch.name}...`;
  document.getElementById('messageInput').disabled = !!ch.locked;
}

function switchChannel(channelId) {
  currentChannel = channelId;
  document.getElementById('messages').innerHTML = '';
  loadChannelMessages(channelId);
  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  renderChannels();
  document.getElementById('pinsPanel').classList.add('hidden');
  document.getElementById('searchResults')?.classList.add('hidden');
}

async function loadChannelMessages(channelId) {
  try {
    const res = await fetch('/api/messages');
    const allMsgs = await res.json();
    messages_cache = allMsgs;
    const channelMsgs = allMsgs.filter(m => (m.channel || 'geral') === channelId);
    if (!channelMsgs.length) showChannelWelcome(channelId);
    channelMsgs.forEach(renderMessage);
    const ch = allChannels[channelId];
    if (ch && ch.locked) addSystemMessage('🔒 Este canal esta trancado.');
  } catch (e) { console.error(e); }
}

let messages_cache = null;

function openCreateChannelModal(defaultType) {
  document.getElementById('channelNameInput').value = '';
  document.getElementById('channelTypeSelect').value = defaultType || 'text';
  document.getElementById('createChannelError').classList.add('hidden');
  document.getElementById('channelPrivateCheck').checked = false;
  document.getElementById('permSeeChannel').checked = true;
  document.getElementById('permConnect').checked = true;
  document.getElementById('permSpeak').checked = true;
  document.getElementById('selectedChannelIcon').value = '💬';
  document.querySelectorAll('#channelIconPicker .accent-btn').forEach((b, i) => { b.classList.toggle('active', i === 0); });
  toggleVoicePermissionsSection();
  document.getElementById('createChannelModal').classList.remove('hidden');
  document.getElementById('channelNameInput').focus();
}

function selectChannelIcon(icon, btn) {
  document.getElementById('selectedChannelIcon').value = icon;
  document.querySelectorAll('#channelIconPicker .accent-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function toggleVoicePermissionsSection() {
  const isVoice = document.getElementById('channelTypeSelect').value === 'voice';
  document.getElementById('voicePermissionsSection').style.display = isVoice ? 'block' : 'none';
}

async function createChannel() {
  const name = document.getElementById('channelNameInput').value.trim();
  const type = document.getElementById('channelTypeSelect').value;
  const isPrivate = document.getElementById('channelPrivateCheck')?.checked || false;
  const icon = document.getElementById('selectedChannelIcon')?.value || '💬';
  const err = document.getElementById('createChannelError');
  if (!name) { err.textContent = 'Digite um nome'; err.classList.remove('hidden'); return; }
  if (name.length < 2) { err.textContent = 'Minimo 2 caracteres'; err.classList.remove('hidden'); return; }
  const permissions = type === 'voice' ? {
    seeChannel: document.getElementById('permSeeChannel').checked,
    connect: document.getElementById('permConnect').checked,
    speak: document.getElementById('permSpeak').checked
  } : null;
  try {
    let res, data;
    if (currentGuild) {
      res = await fetch(`/api/guilds/${currentGuild.id}/channels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, permissions, icon, userId: myUser?.id }) });
    } else {
      res = await fetch('/api/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, isPrivate, icon, userId: myUser?.id }) });
    }
    data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return; }
    closeModal('createChannelModal');
    showToast(`Canal ${type === 'voice' ? '🔊' : '#'}${name} criado!`, 'success');
    if (currentGuild) selectGuild(currentGuild);
  } catch (e) { err.textContent = 'Erro ao criar canal'; err.classList.remove('hidden'); }
}

let channelContextId = null, channelContextName = null;

function showChannelContext(event, channelId, channelName, ch) {
  channelContextId = channelId;
  channelContextName = channelName;
  const existing = document.querySelector('.channel-context-menu');
  if (existing) existing.remove();
  const isDefault = ['geral', 'random'].includes(channelId);
  const isOwner = ch.createdBy === myUser?.id;
  const div = document.createElement('div');
  div.className = 'context-menu channel-context-menu';
  div.style.left = event.clientX + 'px';
  div.style.top = event.clientY + 'px';
  let html = '';
  if (!isDefault) {
    html += `<div class="context-item" onclick="deleteChannel()">🗑️ Deletar</div>`;
  }
  html += `<div class="context-item" onclick="toggleLockChannel()">🔒 ${ch.locked ? 'Destrancar' : 'Trancar'}</div>`;
  if (ch.isPrivate || isOwner) {
    html += `<div class="context-item" onclick="openInviteModal('${channelId}')">📨 Convidar</div>`;
  }
  if (isOwner) {
    html += `<div class="context-item" onclick="openEditChannelModal('${channelId}')">✏️ Editar canal</div>`;
    html += `<div class="context-item" onclick="toggleChannelPrivacy()">${ch.isPrivate ? '🌐 Publico' : '🔒 Privado'}</div>`;
  }
  html += `<div class="context-item" onclick="moveChannelUp()">⬆️ Mover pra cima</div>`;
  html += `<div class="context-item" onclick="moveChannelDown()">⬇️ Mover pra baixo</div>`;
  div.innerHTML = html;
  document.body.appendChild(div);
  setTimeout(() => document.addEventListener('click', function rm() { div.remove(); document.removeEventListener('click', rm); }, { once: true }), 10);
}

function openEditChannelModal(channelId) {
  const ch = allChannels[channelId];
  if (!ch) return;
  document.getElementById('contextMenu')?.classList.add('hidden');
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'editChannelModal';
  const iconOptions = ['💬','🔊','📢','🎮','🎵','📚','⚡','🔒','🌐','🏷️','📝','🗂️','🎬','💡','🎯','🏆'];
  const iconBtns = iconOptions.map(ic => `<button class="accent-btn${ch.icon === ic ? ' active' : ''}" style="font-size:18px;" onclick="this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('channelIconHidden').value='${ic}'">${ic}</button>`).join('');
  modal.innerHTML = `<div class="modal-content"><h3>Editar #${escapeHtml(ch.name)}</h3>
    <label>Nome do canal</label><input type="text" id="editChannelName" value="${escapeHtml(ch.name)}" placeholder="Nome do canal">
    <label>Icone do canal</label><div class="accent-colors">${iconBtns}</div><input type="hidden" id="channelIconHidden" value="${ch.icon || '💬'}">
    <label>Topico / Descricao</label><input type="text" id="editChannelTopic" value="${escapeHtml(ch.topic || '')}" placeholder="Topico do canal">
    <div class="modal-actions"><button class="modal-cancel" onclick="closeModal('editChannelModal')">Cancelar</button><button class="modal-confirm" onclick="saveChannelEdit('${channelId}')">Salvar</button></div></div>`;
  document.body.appendChild(modal);
}

async function saveChannelEdit(channelId) {
  const name = document.getElementById('editChannelName').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const icon = document.getElementById('channelIconHidden').value;
  const topic = document.getElementById('editChannelTopic').value.trim();
  if (!name) return showToast('Nome obrigatorio', 'error');
  try {
    const res = await fetch(`/api/channels/${channelId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, icon, topic }) });
    const data = await res.json();
    if (data.success) {
      allChannels[channelId] = data.channel;
      renderGuildChannels();
      closeModal('editChannelModal');
      showToast('Canal atualizado!', 'success');
    }
  } catch (e) { showToast('Erro ao editar canal', 'error'); }
}

async function toggleChannelPrivacy() {
  if (!channelContextId) return;
  const ch = allChannels[channelContextId];
  try {
    await fetch(`/api/channels/${channelContextId}/privacy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPrivate: !ch.isPrivate, userId: myUser.id }) });
    showToast(ch.isPrivate ? 'Canal agora publico' : 'Canal agora privado', 'info');
  } catch (e) { showToast('Erro', 'error'); }
}

async function deleteChannel() {
  if (!channelContextId) return;
  try { await fetch(`/api/channels/${channelContextId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser?.id }) }); if (currentChannel === channelContextId) switchChannel('geral'); showToast(`Canal deletado`, 'info'); } catch (e) { showToast('Erro', 'error'); }
}

async function toggleLockChannel() {
  if (!channelContextId) return;
  try {
    const res = await fetch(`/api/channels/${channelContextId}/lock`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser?.id }) });
    const data = await res.json();
    showToast(data.channel.locked ? 'Canal trancado' : 'Canal destrancado', 'info');
  } catch (e) { showToast('Erro', 'error'); }
}

async function moveChannelUp() {
  if (!channelContextId) return;
  const sorted = Object.values(allChannels).sort((a, b) => (a.position || 0) - (b.position || 0));
  const idx = sorted.findIndex(c => c.id === channelContextId);
  if (idx <= 0) return;
  const order = sorted.map(c => c.id);
  [order[idx], order[idx - 1]] = [order[idx - 1], order[idx]];
  await fetch('/api/channels/reorder', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
}

async function moveChannelDown() {
  if (!channelContextId) return;
  const sorted = Object.values(allChannels).sort((a, b) => (a.position || 0) - (b.position || 0));
  const idx = sorted.findIndex(c => c.id === channelContextId);
  if (idx === -1 || idx >= sorted.length - 1) return;
  const order = sorted.map(c => c.id);
  [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
  await fetch('/api/channels/reorder', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
}

// ============= PRIVACIDADE =============
async function updatePrivacy(privacy) {
  try {
    const res = await fetch('/api/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, privacy }) });
    const data = await res.json();
    if (data.success) { myUser.privacy = data.user.privacy; localStorage.setItem('pulseUser', JSON.stringify(myUser)); showToast('Privacidade atualizada!', 'success'); }
  } catch (e) { showToast('Erro ao atualizar', 'error'); }
}

async function blockUser(targetId) {
  try {
    await fetch('/api/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, targetId }) });
    showToast('Usuario bloqueado', 'info');
    loadFriends();
  } catch (e) { showToast('Erro', 'error'); }
}

async function unblockUser(targetId) {
  try {
    await fetch('/api/unblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id, targetId }) });
    showToast('Usuario desbloqueado', 'info');
  } catch (e) { showToast('Erro', 'error'); }
}

async function loadBlocked() {
  try {
    const res = await fetch(`/api/blocked/${myUser.id}`);
    return await res.json();
  } catch (e) { return []; }
}

function isBlocked(userId) {
  return (myUser.blocked || []).includes(userId);
}

function isFriend(userId) {
  return (myUser.friends || []).includes(userId);
}

// ============= CONVITES PARA CANAIS =============
async function inviteToChannel(channelId, targetUserId) {
  try {
    await fetch(`/api/channels/${channelId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUserId, invitedBy: myUser.id }) });
    showToast('Convite enviado!', 'success');
  } catch (e) { showToast('Erro ao enviar convite', 'error'); }
}

async function acceptChannelInvite(channelId) {
  try {
    await fetch(`/api/channels/${channelId}/invite/accept`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUser.id }) });
    showToast('Convite aceito!', 'success');
    loadChannels();
  } catch (e) { showToast('Erro', 'error'); }
}

function openInviteModal(channelId) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'inviteChannelModal';
  modal.innerHTML = `<div class="modal-content"><h3>Convidar para #${allChannels[channelId]?.name || channelId}</h3><div id="inviteFriendList" class="invite-friend-list"></div><div class="modal-actions"><button class="modal-cancel" onclick="closeModal('inviteChannelModal')">Fechar</button></div></div>`;
  document.body.appendChild(modal);

  // Listar amigos para convite
  const list = modal.querySelector('#inviteFriendList');
  if (myUser.friends?.length) {
    myUser.friends.forEach(fid => {
      const div = document.createElement('div');
      div.className = 'invite-friend-item';
      div.innerHTML = `<span>Amigo</span><button class="btn-small" onclick="inviteToChannel('${channelId}','${fid}');this.textContent='Enviado';this.disabled=true;">Convidar</button>`;
      list.appendChild(div);
    });
  } else {
    list.innerHTML = '<div class="search-empty">Adicione amigos primeiro</div>';
  }
}

function openBlockedModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'blockedModal';
  modal.innerHTML = `<div class="modal-content"><h3>Usuarios Bloqueados</h3><div id="blockedList" class="blocked-list"></div><div class="modal-actions"><button class="modal-cancel" onclick="closeModal('blockedModal')">Fechar</button></div></div>`;
  document.body.appendChild(modal);
  loadBlockedList();
}

async function loadBlockedList() {
  const blocked = await loadBlocked();
  const list = document.getElementById('blockedList');
  if (!list) return;
  if (!blocked.length) { list.innerHTML = '<div class="search-empty">Nenhum bloqueado</div>'; return; }
  list.innerHTML = blocked.map(u => `<div class="blocked-item"><span>${escapeHtml(u.username)}</span><button class="btn-small danger" onclick="unblockUser('${u.id}');this.parentElement.remove();">Desbloquear</button></div>`).join('');
}

// ============= PESQUISA =============
function openSearch() {
  const existing = document.querySelector('.search-panel');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.className = 'search-panel';
  panel.innerHTML = `<div class="search-bar"><input type="text" id="searchInput" placeholder="Pesquisar mensagens..." oninput="doSearch(this.value)"><button onclick="this.parentElement.parentElement.remove()">✕</button></div><div id="searchResults" class="search-results-list"></div>`;
  document.querySelector('.chat-main').insertBefore(panel, document.querySelector('.messages'));
  document.getElementById('searchInput').focus();
}

let searchTimeout;
async function doSearch(query) {
  clearTimeout(searchTimeout);
  if (!query || query.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(query)}&channel=${currentChannel}`);
      const results = await res.json();
      const list = document.getElementById('searchResults');
      if (!results.length) { list.innerHTML = '<div class="search-empty">Nenhuma mensagem encontrada</div>'; return; }
      list.innerHTML = results.map(m => `<div class="search-item" onclick="scrollToMessage(${m.id})"><span class="search-author" style="color:${m.avatarColor || getColor(m.username)}">${escapeHtml(m.username)}</span><span class="search-text">${escapeHtml(m.text?.substring(0, 100))}</span><span class="search-time">${formatTime(m.timestamp)}</span></div>`).join('');
    } catch (e) { console.error(e); }
  }, 300);
}

function scrollToMessage(msgId) {
  const el = document.getElementById(`msg-${msgId}`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 2000); }
  document.querySelector('.search-panel')?.remove();
}

// ============= LOG DE ATIVIDADE =============
async function openActivityLog() {
  try {
    const res = await fetch(`/api/activity?channel=${currentChannel}`);
    const log = await res.json();
    const existing = document.querySelector('.activity-panel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.className = 'activity-panel';
    panel.innerHTML = `<div class="activity-header"><span>📋 Atividade Recente</span><button onclick="this.parentElement.parentElement.remove()">✕</button></div><div class="activity-list">${log.length ? log.map(a => `<div class="activity-item">${getActivityIcon(a.type)} ${getActivityText(a)}</div>`).join('') : '<div class="search-empty">Nenhuma atividade</div>'}</div>`;
    document.querySelector('.chat-main').insertBefore(panel, document.querySelector('.messages'));
  } catch (e) { console.error(e); }
}

function getActivityIcon(type) {
  const icons = { channel_create: '✨', channel_delete: '🗑️', channel_lock: '🔒', channel_unlock: '🔓', message_edit: '✏️', message_delete: '🗑️' };
  return icons[type] || '📌';
}

function getActivityText(a) {
  const name = a.username || a.channelName || 'Sistema';
  switch (a.type) {
    case 'channel_create': return `Canal <strong>#${a.channelName}</strong> criado`;
    case 'channel_delete': return `Canal <strong>#${a.channelName}</strong> deletado`;
    case 'channel_lock': return `Canal <strong>#${a.channelName}</strong> trancado`;
    case 'channel_unlock': return `Canal <strong>#${a.channelName}</strong> destrancado`;
    case 'channel_privatize': return `Canal <strong>#${a.channelName}</strong> agora privado`;
    case 'channel_publicize': return `Canal <strong>#${a.channelName}</strong> agora publico`;
    default: return `${a.type} - ${a.channelName || ''}`;
  }
}

// ============= BEM-VINDO POR CANAL =============
function showChannelWelcome(channelId) {
  const ch = allChannels[channelId];
  if (!ch) return;
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'channel-welcome';
  div.innerHTML = `<div class="welcome-icon">${ch.type === 'voice' ? '🔊' : '#'}</div><h3>Bem-vindo ao #${ch.name}</h3><p>Este e o inicio do canal <strong>#${ch.name}</strong>.</p>`;
  container.prepend(div);
}

// ============= SOCKET EVENTS =============
socket.on('message', (msg) => { if ((msg.channel || 'geral') === currentChannel) { renderMessage(msg); playSound('msg'); } });
socket.on('messageEdited', (data) => { const el = document.querySelector(`#msg-${data.id} .msg-text`); if (el) el.textContent = data.text; const h = document.querySelector(`#msg-${data.id} .msg-header`); if (h && !h.querySelector('.msg-edited')) h.insertAdjacentHTML('beforeend', '<span class="msg-edited">(editado)</span>'); });
socket.on('messageDeleted', (data) => { document.getElementById(`msg-${data.id}`)?.remove(); });
socket.on('messagePinned', (data) => { const el = document.getElementById(`msg-${data.id}`); if (el) { el.classList.toggle('pinned', data.pinned); const b = el.querySelector('.msg-pin-badge'); if (data.pinned && !b) el.querySelector('.msg-header')?.insertAdjacentHTML('beforeend', '<span class="msg-pin-badge">📌</span>'); else if (!data.pinned && b) b.remove(); } });
socket.on('pinnedMessages', renderPins);
socket.on('reactionUpdated', (data) => { const el = document.getElementById(`msg-${data.id}`); if (!el) return; const ex = el.querySelector('.reactions'); if (ex) ex.remove(); if (!Object.keys(data.reactions).length) return; let h = '<div class="reactions">'; for (const [emoji, users] of Object.entries(data.reactions)) { h += `<button class="reaction-btn${users.includes(myUser?.username) ? ' active' : ''}" onclick="toggleReaction(${data.id},'${emoji}')">${emoji} <span>${users.length}</span></button>`; } h += `<button class="reaction-add" onclick="showQuickReact(event,${data.id})">+</button></div>`; el.querySelector('.msg-content')?.insertAdjacentHTML('beforeend', h); });

socket.on('userJoined', ({ username, userId }) => { addSystemMessage(`⚡ ${username} entrou no PULSE!`); playSound('join'); loadFriends(); });
socket.on('userLeft', ({ username }) => { addSystemMessage(`${username} saiu.`); playSound('leave'); });
socket.on('usersUpdate', (online) => { document.getElementById('onlineCount').textContent = online.length; const list = document.getElementById('membersList'); list.innerHTML = ''; online.forEach(u => { const d = document.createElement('div'); d.className = 'member'; d.onclick = () => openUserProfile(u.userId); const ac = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (u.avatarEmoji || '👤'); d.innerHTML = `<div class="member-avatar" style="background:${u.avatarColor || '#5865f2'}">${ac}</div><div class="member-info"><span class="member-name">${escapeHtml(u.username)}</span>${u.customStatus ? `<span class="member-status-text">${escapeHtml(u.customStatus)}</span>` : ''}</div><div class="status-dot ${u.status}"></div>`; list.appendChild(d); }); });

const typingUsers = {};
socket.on('typing', ({ username, channel, guildId, dmId }) => {
  if (guildId && guildId !== currentGuild?.id) return;
  if (channel && channel !== currentChannel) return;
  if (dmId && dmId !== currentDM?.id) return;
  typingUsers[username] = Date.now();
  showTypingIndicator();
});
socket.on('stopTyping', ({ username }) => {
  delete typingUsers[username];
  showTypingIndicator();
});

function showTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  const userEl = document.getElementById('typingUser');
  const names = Object.keys(typingUsers);
  if (names.length === 0) { el.classList.add('hidden'); return; }
  const now = Date.now();
  const active = names.filter(n => now - typingUsers[n] < 5000);
  if (active.length === 0) { el.classList.add('hidden'); return; }
  if (active.length === 1) userEl.textContent = active[0];
  else if (active.length === 2) userEl.textContent = active[0] + ' e ' + active[1];
  else userEl.textContent = active[0] + ' e mais ' + (active.length - 1);
  el.classList.remove('hidden');
}
setInterval(showTypingIndicator, 2000);
socket.on('profileUpdated', (data) => {
  if (data.userId === myUser?.id) {
    myUser.avatarEmoji = data.avatarEmoji;
    myUser.avatarColor = data.avatarColor;
    if (data.status) myUser.status = data.status;
    if (data.customStatus !== undefined) myUser.customStatus = data.customStatus;
    localStorage.setItem('pulseUser', JSON.stringify(myUser));
    updateMyUI();
  }
  const memberEl = document.querySelector(`.member[data-user-id="${data.userId}"] .status-dot`);
  if (memberEl && data.status) memberEl.className = `status-dot ${data.status}`;
  const vuItem = document.querySelector(`.voice-user-item[data-user-id="${data.userId}"]`);
  if (vuItem && data.status) {
    let dot = vuItem.querySelector('.status-dot');
    if (!dot) { dot = document.createElement('div'); dot.className = 'status-dot'; vuItem.prepend(dot); }
    dot.className = `status-dot ${data.status}`;
  }
});
socket.on('info', (d) => { showToast(d.message, 'info'); loadFriends(); });
socket.on('channelsUpdate', (channels) => { if (!currentGuild) { allChannels = channels; renderChannels(); } });
socket.on('error', (d) => showToast(d.message, 'error'));
socket.on('friendRequestReceived', (d) => { showToast(`${d.from} quer ser seu amigo!`, 'notif'); playSound('notif'); loadFriends(); });
socket.on('friendsUpdate', () => loadFriends());
socket.on('friendOnline', ({ username }) => { showToast(`${username} esta online!`, 'info'); });
socket.on('mentionNotification', ({ from, text }) => { showToast(`${from} te mencionou: "${text.substring(0,50)}..."`, 'notif'); playSound('notif'); });

// ============= INIT =============
let authToken = localStorage.getItem('pulseToken') || null;

const originalFetch = window.fetch;
window.fetch = function(url, opts = {}) {
  if (authToken) {
    opts.headers = opts.headers || {};
    opts.headers['Authorization'] = 'Bearer ' + authToken;
  }
  return originalFetch(url, opts);
};

// Patch doLogin/doRegister pra salvar token
const _origLogin = doLogin;
doLogin = async function() {
  const login = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  err.classList.add('hidden');
  if (!login || !password) { err.textContent = 'Preencha todos os campos'; err.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return; }
    myUser = data.user;
    authToken = data.token;
    localStorage.setItem('pulseUser', JSON.stringify(myUser));
    localStorage.setItem('pulseToken', authToken);
    enterChat();
  } catch (e) { err.textContent = 'Erro de conexao'; err.classList.remove('hidden'); }
};

const _origRegister = doRegister;
doRegister = async function() {
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const err = document.getElementById('registerError');
  err.classList.add('hidden');
  if (!username || !email || !password) { err.textContent = 'Preencha todos os campos'; err.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email, password }) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return; }
    myUser = data.user;
    authToken = data.token;
    localStorage.setItem('pulseUser', JSON.stringify(myUser));
    localStorage.setItem('pulseToken', authToken);
    showAvatarSelection();
  } catch (e) { err.textContent = 'Erro de conexao'; err.classList.remove('hidden'); }
};

// ============= MARKDOWN RENDERER =============
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  html = html.replace(/`(.+?)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/```([\s\S]+?)```/g, '<pre class="code-block"><code>$1</code></pre>');
  html = html.replace(/^(.+)$/gm, (line) => {
    if (line.startsWith('<strong>') || line.startsWith('<em>') || line.startsWith('<del>') || line.startsWith('<code') || line.startsWith('<pre')) return line;
    return line;
  });
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="msg-link">$1</a>');
  return html;
}

// ============= BROWSER NOTIFICATIONS =============
let notifPermission = 'default';
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => { notifPermission = p; });
  }
}

function sendBrowserNotification(title, body, icon) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;
  try { new Notification(title, { body, icon: icon || undefined, badge: '/favicon.ico' }); } catch(e) {}
}

// ============= GUILDS =============
let currentGuild = null;
let myGuilds = [];

async function loadGuilds() {
  try {
    const res = await fetch('/api/guilds');
    myGuilds = await res.json();
    if (!myGuilds.length) {
      const createRes = await fetch('/api/guilds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Meu Servidor' }) });
      const data = await createRes.json();
      if (data.success && data.guild) {
        myGuilds = [data.guild];
        selectGuild(data.guild);
      }
    } else {
      if (!currentGuild) selectGuild(myGuilds[0]);
      else {
        const updated = myGuilds.find(g => g.id === currentGuild.id);
        if (updated) selectGuild(updated);
      }
    }
    renderGuildsSidebar();
  } catch (e) { console.error(e); }
}

function renderGuildsSidebar() {
  const container = document.getElementById('guildsSidebar');
  if (!container) return;
  container.innerHTML = '';
  myGuilds.forEach(g => {
    const div = document.createElement('div');
    div.className = 'guild-icon' + (currentGuild?.id === g.id ? ' active' : '');
    div.style.background = g.icon ? 'transparent' : getColor(g.name);
    div.title = g.name;
    if (g.icon) div.innerHTML = `<img src="${g.icon}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    else div.textContent = g.name.charAt(0).toUpperCase();
    div.onclick = () => selectGuild(g);
    container.appendChild(div);
  });

  const sep = document.createElement('div');
  sep.className = 'guild-separator';
  container.appendChild(sep);

  const addBtn = document.createElement('div');
  addBtn.className = 'guild-icon guild-add';
  addBtn.textContent = '+';
  addBtn.title = 'Criar ou entrar em servidor';
  addBtn.onclick = openGuildModal;
  container.appendChild(addBtn);
}

async function selectGuild(guild) {
  currentGuild = guild;
  renderGuildsSidebar();
  const gsRow = document.getElementById('guildSettingsRow');
  if (gsRow) gsRow.style.display = guild ? '' : 'none';
  const gHeader = document.getElementById('guildHeader');
  const pHeader = document.getElementById('pulseHeader');
  if (guild) {
    if (gHeader) { gHeader.style.display = 'flex'; document.getElementById('guildHeaderName').textContent = guild.name; }
    if (pHeader) pHeader.style.display = 'none';
  } else {
    if (gHeader) gHeader.style.display = 'none';
    if (pHeader) pHeader.style.display = '';
  }
  try {
    const [chRes, membersRes] = await Promise.all([
      fetch(`/api/guilds/${guild.id}/channels`),
      fetch(`/api/guilds/${guild.id}/members`)
    ]);
    const chData = await chRes.json();
    allChannels = chData.channels || {};
    allCategories = chData.categories || {};
    renderGuildChannels();
    const members = await membersRes.json();
    renderGuildMembers(members);
    const firstText = Object.values(allChannels).find(c => c.type === 'text');
    if (firstText) switchGuildChannel(firstText.id);
  } catch (e) { console.error(e); }
}

function renderGuildChannels() {
  const textContainer = document.getElementById('textChannels');
  const voiceContainer = document.getElementById('voiceChannels');
  if (!textContainer || !voiceContainer) return;
  textContainer.innerHTML = '';
  voiceContainer.innerHTML = '';

  const isOwner = currentGuild?.ownerId === myUser?.id;
  const memberRole = currentGuild?.members?.[myUser?.id]?.role;
  const canManage = isOwner || memberRole === 'owner' || memberRole === 'admin';

  document.querySelectorAll('.channels .add-friend-btn').forEach(btn => {
    btn.style.display = canManage ? '' : 'none';
  });

  Object.values(allChannels).sort((a, b) => (a.position || 0) - (b.position || 0)).forEach(ch => {
    const wrapper = document.createElement('div');
    wrapper.className = 'channel-wrapper';

    const div = document.createElement('div');
    div.className = 'channel' + (ch.id === currentChannel ? ' active' : '');
    if (ch.type === 'voice') {
      div.classList.add('voice-channel');
      if (currentVoiceChannel && ch.id === currentVoiceChannel.channelId) div.classList.add('active');
    }
    div.textContent = (ch.type === 'voice' ? '🔊 ' : (ch.icon || '#') + ' ') + ch.name;
    div.onclick = () => {
      if (ch.type === 'voice') {
        if (currentVoiceChannel && ch.id === currentVoiceChannel.channelId) return;
        if (currentGuild) joinVoiceChannel(currentGuild.id, ch.id);
      } else {
        switchGuildChannel(ch.id);
      }
    };
    div.oncontextmenu = (e) => {
      if (ch.type === 'voice' && currentVoiceChannel && ch.id === currentVoiceChannel.channelId) {
        e.preventDefault();
        leaveVoiceChannel();
      }
    };
    wrapper.appendChild(div);

    if (ch.type === 'voice') {
      const usersDiv = document.createElement('div');
      usersDiv.className = 'voice-users-list';
      usersDiv.id = `voice-users-${ch.id}`;
      wrapper.appendChild(usersDiv);
      voiceContainer.appendChild(wrapper);
    } else {
      textContainer.appendChild(wrapper);
    }
  });

  renderVoiceUsersInSidebar();
}

function renderGuildMembers(members) {
  const list = document.getElementById('membersList');
  if (!list) return;
  list.innerHTML = '';
  const sorted = members.sort((a, b) => {
    const roleOrder = { owner: 4, admin: 3, mod: 2, member: 1 };
    return (roleOrder[b.role] || 0) - (roleOrder[a.role] || 0);
  });
  sorted.forEach(u => {
    const d = document.createElement('div');
    d.className = 'member member-item' + (speakingUsers[u.id] ? ' speaking' : '');
    d.setAttribute('data-user-id', u.id);
    d.onclick = () => openUserProfile(u.id);
    const ac = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (u.avatarEmoji || '👤');
    const roleBadge = u.role !== 'member' ? `<span class="role-badge" style="color:${currentGuild?.roles?.[u.role]?.color || '#99aab5'}">${u.role === 'owner' ? '👑' : u.role === 'admin' ? '⚡' : '🛡️'}</span>` : '';
    d.innerHTML = `<div class="member-avatar" style="background:${u.avatarColor || '#5865f2'}">${ac}</div><div class="member-info"><span class="member-name">${escapeHtml(u.username)} ${roleBadge}</span></div><div class="status-dot ${u.status || 'offline'}"></div>`;
    list.appendChild(d);
  });
}

function switchGuildChannel(channelId) {
  currentChannel = channelId;
  document.getElementById('messages').innerHTML = '';
  loadGuildChannelMessages(channelId);
  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  renderGuildChannels();
  const ch = allChannels[channelId];
  if (ch) {
    document.querySelector('.channel-name').textContent = '# ' + ch.name;
    document.getElementById('messageInput').placeholder = `Enviar mensagem para #${ch.name}...`;
  }
}

async function loadGuildChannelMessages(channelId) {
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/channels/${channelId}/messages?limit=50`);
    const msgs = await res.json();
    msgs.forEach(renderMessage);
    if (msgs.length) oldestMessageId = msgs[0]?.id;
  } catch (e) { console.error(e); }
}

function openGuildModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'guildModal';
  modal.innerHTML = `<div class="modal-content"><h3>Servidores</h3><div class="guild-list-section"><h4>Meus Servidores</h4><div id="myGuildList"></div></div><div class="guild-list-section"><h4>Entrar com codigo</h4><div class="input-row"><input type="text" id="guildInviteCode" placeholder="Codigo do convite"><button onclick="joinGuildByCode()">Entrar</button></div></div><div class="modal-actions"><button class="modal-cancel" onclick="closeModal('guildModal')">Fechar</button><button class="modal-confirm" onclick="createGuild()">Criar Servidor</button></div></div>`;
  document.body.appendChild(modal);
  const list = document.getElementById('myGuildList');
  myGuilds.forEach(g => {
    const div = document.createElement('div');
    div.className = 'guild-list-item';
    div.innerHTML = `<span>${escapeHtml(g.name)}</span><span style="color:var(--muted);font-size:12px;">${g.memberCount} membros</span><button class="btn-small" onclick="selectGuild(${JSON.stringify(g).replace(/"/g, '&quot;')});closeModal('guildModal')">Entrar</button>`;
    list.appendChild(div);
  });
  if (!myGuilds.length) list.innerHTML = '<div class="search-empty">Nenhum servidor</div>';
}

async function createGuild() {
  const name = prompt('Nome do servidor:');
  if (!name) return;
  try {
    const res = await fetch('/api/guilds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (data.success) { closeModal('guildModal'); loadGuilds(); selectGuild(data.guild); showToast('Servidor criado!', 'success'); }
  } catch (e) { showToast('Erro ao criar servidor', 'error'); }
}

async function joinGuildByCode(code) {
  if (!code) code = document.getElementById('guildInviteCode')?.value?.trim();
  if (!code) return;
  try {
    const res = await fetch('/api/guilds/join-by-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json();
    if (data.success) { closeModal('guildModal'); loadGuilds(); showToast('Entrou no servidor!', 'success'); }
    else showToast(data.error, 'error');
  } catch (e) { showToast('Erro', 'error'); }
}

function openGuildEditModal() {
  if (!currentGuild) return;
  const isOwner = currentGuild.ownerId === myUser?.id;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'guildEditModal';
  const bannerPreview = currentGuild.banner ? `<img src="${currentGuild.banner}" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;">` : '';
  const iconPreview = currentGuild.icon ? `<img src="${currentGuild.icon}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--border);">` : `<div style="width:80px;height:80px;border-radius:50%;background:${getColor(currentGuild.name)};display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;">${currentGuild.name.charAt(0).toUpperCase()}</div>`;
  modal.innerHTML = `<div class="modal-content wide">
    <h3>Editar Servidor</h3>
    ${bannerPreview}
    <label>Banner do servidor</label>
    <input type="file" accept="image/*" id="guildBannerInput" onchange="previewGuildBanner(this)" style="margin-bottom:8px;">
    <div id="guildBannerPreview" style="display:none;margin-bottom:8px;"><img style="width:100%;height:120px;object-fit:cover;border-radius:8px;"></div>

    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
      <div id="guildIconPreview">${iconPreview}</div>
      <div style="flex:1;">
        <label>Icone do servidor</label>
        <input type="file" accept="image/*" id="guildIconInput" onchange="previewGuildIcon(this)">
      </div>
    </div>

    <label>Nome do servidor</label>
    <input type="text" id="guildEditName" value="${escapeHtml(currentGuild.name)}" maxlength="50" style="width:100%;padding:8px;background:var(--input);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-bottom:8px;">

    <label>Descricao</label>
    <textarea id="guildEditDesc" maxlength="200" rows="2" style="width:100%;padding:8px;background:var(--input);border:1px solid var(--border);border-radius:6px;color:var(--text);resize:vertical;margin-bottom:8px;">${escapeHtml(currentGuild.description || '')}</textarea>

    <label>Cor do servidor</label>
    <div class="accent-colors" style="margin-bottom:12px;">
      <button class="accent-btn${!currentGuild.splashColor ? ' active' : ''}" style="background:#5865F2" onclick="document.getElementById('guildEditColor').value='#5865F2';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
      <button class="accent-btn" style="background:#EB459E" onclick="document.getElementById('guildEditColor').value='#EB459E';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
      <button class="accent-btn" style="background:#57F287" onclick="document.getElementById('guildEditColor').value='#57F287';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
      <button class="accent-btn" style="background:#FEE75C" onclick="document.getElementById('guildEditColor').value='#FEE75C';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
      <button class="accent-btn" style="background:#ED4245" onclick="document.getElementById('guildEditColor').value='#ED4245';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
      <button class="accent-btn" style="background:#9B59B6" onclick="document.getElementById('guildEditColor').value='#9B59B6';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
      <button class="accent-btn" style="background:#E67E22" onclick="document.getElementById('guildEditColor').value='#E67E22';this.parentElement.querySelectorAll('.accent-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active')"></button>
    </div>
    <input type="hidden" id="guildEditColor" value="${currentGuild.splashColor || '#5865F2'}">

    <div style="margin-top:8px;padding:8px;background:var(--input);border-radius:6px;">
      <label style="margin:0;font-size:12px;color:var(--muted);">Codigo de convite:</label>
      <div style="display:flex;gap:8px;margin-top:4px;">
        <input type="text" id="guildEditCode" value="${currentGuild.inviteCode || ''}" readonly style="flex:1;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:13px;">
        <button class="btn-small" onclick="navigator.clipboard.writeText(document.getElementById('guildEditCode').value);showToast('Copiado!','success')">Copiar</button>
        ${isOwner ? `<button class="btn-small" onclick="regenerateGuildCode()">Gerar novo</button>` : ''}
      </div>
    </div>

    <div class="modal-actions">
      ${isOwner ? `<button class="btn-danger" onclick="deleteGuildConfirm()" style="margin-right:auto;">Deletar Servidor</button>` : ''}
      <button class="modal-cancel" onclick="const m=document.getElementById('guildEditModal');if(m)m.remove()">Cancelar</button>
      <button class="modal-confirm" onclick="saveGuildEdit()">Salvar</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function previewGuildBanner(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('guildBannerPreview');
    preview.style.display = 'block';
    preview.querySelector('img').src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function previewGuildIcon(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('guildIconPreview');
    preview.innerHTML = `<img src="${e.target.result}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--border);">`;
  };
  reader.readAsDataURL(file);
}

async function saveGuildEdit() {
  if (!currentGuild) return;
  const name = document.getElementById('guildEditName').value.trim();
  const description = document.getElementById('guildEditDesc').value.trim();
  const splashColor = document.getElementById('guildEditColor').value;
  if (!name) return showToast('Nome obrigatorio', 'error');

  const updates = { name, description, splashColor };

  const iconFile = document.getElementById('guildIconInput')?.files[0];
  const bannerFile = document.getElementById('guildBannerInput')?.files[0];

  if (iconFile) {
    const iconData = await new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(iconFile); });
    updates.icon = iconData;
  }
  if (bannerFile) {
    const bannerData = await new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(bannerFile); });
    updates.banner = bannerData;
  }

  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${myUser.token}` }, body: JSON.stringify(updates) });
    const data = await res.json();
    if (data.success) {
      Object.assign(currentGuild, updates);
      if (data.guild) Object.assign(currentGuild, data.guild);
      renderGuildsSidebar();
      document.getElementById('guildHeaderName').textContent = currentGuild.name;
      const m = document.getElementById('guildEditModal'); if (m) m.remove();
      showToast('Servidor atualizado!', 'success');
    }
  } catch (e) { showToast('Erro ao salvar', 'error'); }
}

async function regenerateGuildCode() {
  if (!currentGuild) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${myUser.token}` } });
    const data = await res.json();
    if (data.code) {
      document.getElementById('guildEditCode').value = data.code;
      currentGuild.inviteCode = data.code;
      showToast('Novo codigo gerado!', 'success');
    }
  } catch (e) { showToast('Erro', 'error'); }
}

async function deleteGuildConfirm() {
  if (!currentGuild) return;
  if (!confirm(`Tem certeza que quer deletar "${currentGuild.name}"? Essa acao nao pode ser desfeita.`)) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${myUser.token}` } });
    const data = await res.json();
    if (data.success) {
      const m = document.getElementById('guildEditModal'); if (m) m.remove();
      currentGuild = null;
      loadGuilds();
      showToast('Servidor deletado', 'info');
    }
  } catch (e) { showToast('Erro ao deletar', 'error'); }
}

// ============= DMs =============
let currentDM = null;
let myDMs = [];

async function loadDMs() {
  try {
    const res = await fetch('/api/dms');
    myDMs = await res.json();
    renderDMsSidebar();
  } catch (e) { console.error(e); }
}

function renderDMsSidebar() {
  const container = document.getElementById('dmList');
  const section = document.getElementById('dmSection');
  if (!container) return;
  container.innerHTML = '';
  if (!myDMs.length) {
    if (section) section.classList.add('hidden');
    return;
  }
  if (section) section.classList.remove('hidden');
  myDMs.forEach(dm => {
    const div = document.createElement('div');
    div.className = 'dm-item' + (currentDM?.id === dm.id ? ' active' : '');
    const u = dm.otherUser;
    if (u) {
      const ac = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (u.avatarEmoji || '👤');
      div.innerHTML = `<div class="member-avatar small" style="background:${u.avatarColor || '#5865f2'}">${ac}</div><span class="dm-name">${escapeHtml(u.username)}</span><div class="status-dot ${u.status || 'offline'}"></div>`;
    } else {
      div.innerHTML = `<div class="member-avatar small" style="background:#5865f2">👥</div><span class="dm-name">${escapeHtml(dm.name || 'Grupo')}</span>`;
    }
    div.onclick = () => openDM(dm);
    container.appendChild(div);
  });
}

async function openDM(dm) {
  currentDM = dm;
  currentChannel = null;
  document.getElementById('messages').innerHTML = '';
  const u = dm.otherUser;
  document.querySelector('.channel-name').textContent = u ? `@${u.username}` : dm.name;
  document.getElementById('messageInput').placeholder = `Enviar mensagem para ${u ? u.username : dm.name}...`;
  renderDMsSidebar();

  socket.emit('dmOpen', { targetUserId: u?.id || dm.participants.find(p => p !== myUser.id) });
}

function startDMWith(userId) {
  const existing = myDMs.find(dm => dm.participants.includes(userId) && dm.participants.length === 2);
  if (existing) { openDM(existing); return; }
  socket.emit('dmOpen', { targetUserId: userId });
}

// ============= WEBRTC VOICE =============
let localStream = null;
let voicePeers = {};
let voiceConnected = false;
let currentVoiceChannel = null;

async function joinVoiceChannel(guildId, channelId) {
  try {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } });
    currentVoiceChannel = { guildId, channelId };
    localStorage.setItem('pulseVoice', JSON.stringify(currentVoiceChannel));
    socket.emit('voiceJoin', { guildId, channelId });
    voiceConnected = true;
    showVoicePanel();
    renderGuildChannels();
    startLocalVAD(localStream);
  } catch (e) {
    console.error('Voice join error:', e);
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      showToast('Permissao do microfone negada. Verifique as configuracoes do navegador.', 'error');
    } else {
      showToast('Erro ao acessar microfone', 'error');
    }
  }
}

function leaveVoiceChannel() {
  socket.emit('voiceLeave');
  localStorage.removeItem('pulseVoice');
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  Object.values(voicePeers).forEach(p => { if (p.pc) p.pc.close(); });
  voicePeers = {};
  voiceConnected = false;
  currentVoiceChannel = null;
  hideVoicePanel();
  renderGuildChannels();
}

let voiceTimerInterval = null;
let voiceStartTime = 0;

function startVoiceTimer() {
  voiceStartTime = Date.now();
  voiceTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const el = document.getElementById('voiceTimer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function stopVoiceTimer() {
  if (voiceTimerInterval) { clearInterval(voiceTimerInterval); voiceTimerInterval = null; }
  const el = document.getElementById('voiceTimer');
  if (el) el.textContent = '00:00';
}

function showVoicePanel() {
  const panel = document.getElementById('voicePanel');
  if (panel) {
    panel.classList.remove('hidden');
    const ch = allChannels[currentVoiceChannel?.channelId];
    document.getElementById('voiceChannelName').textContent = ch?.name || currentVoiceChannel?.channelId || 'Voz';
    const guildName = currentGuild?.name || 'PULSE';
    document.getElementById('voiceGuildName').textContent = guildName;
  }
  document.getElementById('userScreenBtn').style.display = '';
  document.getElementById('userDisconnectBtn').style.display = '';
  startVoiceTimer();
  updateMyVoiceStatus();
}

function hideVoicePanel() {
  const panel = document.getElementById('voicePanel');
  if (panel) panel.classList.add('hidden');
  document.getElementById('userScreenBtn').style.display = 'none';
  document.getElementById('userDisconnectBtn').style.display = 'none';
  stopVoiceTimer();
  updateMyVoiceStatus();
}

function updateMyVoiceStatus() {
  const statusEl = document.getElementById('myStatus');
  if (statusEl) {
    if (voiceConnected) statusEl.textContent = '🔊 Em voz';
    else statusEl.textContent = myUser.customStatus || getStatusText(myUser.status);
  }
}

function toggleVoiceMute() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  socket.emit('voiceMuteToggle', { muted: !audioTrack.enabled });
  updateMuteButton(!audioTrack.enabled);
}

function toggleDeafen() {
  if (!localStream) return;
  const audioTracks = localStream.getAudioTracks();
  const isDeafened = audioTracks.every(t => !t.enabled);
  audioTracks.forEach(t => t.enabled = isDeafened);
  socket.emit('voiceMuteToggle', { muted: isDeafened });
  updateMuteButton(isDeafened);
  const deafenBtn = document.getElementById('deafenBtn');
  if (deafenBtn) deafenBtn.classList.toggle('active', !isDeafened);
  const userDeafenBtn = document.getElementById('userDeafenBtn');
  if (userDeafenBtn) userDeafenBtn.classList.toggle('active', !isDeafened);
}

function toggleUserMic() {
  if (!localStream) {
    if (currentGuild && currentChannel) joinVoiceChannel(currentGuild.id, currentChannel);
    return;
  }
  toggleVoiceMute();
  const userMicBtn = document.getElementById('userMicBtn');
  const audioTrack = localStream.getAudioTracks()[0];
  if (userMicBtn && audioTrack) userMicBtn.classList.toggle('active', !audioTrack.enabled);
}

function updateMuteButton(muted) {
  const btn = document.getElementById('voiceMuteBtn');
  if (btn) {
    btn.classList.toggle('active', muted);
    btn.innerHTML = muted ? '🔇' : '🎤';
  }
  const userMicBtn = document.getElementById('userMicBtn');
  if (userMicBtn) userMicBtn.classList.toggle('active', muted);
}

// ============= VOICE USERS IN SIDEBAR =============
let voiceChannelUsers = {};

function renderVoiceUsersInSidebar() {
  if (!currentGuild) return;
  Object.keys(voiceChannelUsers).forEach(channelId => {
    const container = document.getElementById(`voice-users-${channelId}`);
    if (!container) return;
    container.innerHTML = '';
    voiceChannelUsers[channelId].forEach(u => {
      const div = document.createElement('div');
      div.className = 'voice-user-item' + (speakingUsers[u.userId] ? ' speaking' : '');
      div.setAttribute('data-user-id', u.userId);
      const ac = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (u.avatarEmoji || '👤');
      const liveBadge = (screenSharing && u.userId === myUser.id) ? '<span class="live-badge-sidebar">🔴 AO VIVO</span>' : '';
      div.innerHTML = `<div class="member-avatar small" style="background:${u.avatarColor || '#5865f2'}">${ac}</div><span class="voice-user-name">${escapeHtml(u.username)}</span>${u.muted ? '<span class="voice-user-muted">🔇</span>' : ''}${liveBadge}`;
      container.appendChild(div);
    });
  });
}

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

socket.on('voiceConnected', async ({ peers, guildId, channelId }) => {
  const ch = allChannels[channelId] || {};
  showToast(`Conectado ao canal de voz ${ch.name || channelId}`, 'success');
  sendBrowserNotification('Conectado ao canal de voz', ch.name || channelId);
  playSound('join');
  startVoiceTimer();
  for (const peer of peers) {
    await createVoicePeerOffer(peer.socketId);
  }
  showVoicePanel();
  renderGuildChannels();
});

socket.on('voiceUserJoined', async ({ socketId, userId, username, channelName }) => {
  showToast(`${username} entrou no canal de voz ${channelName}`, 'info');
  playSound('join');
  if (userId !== myUser?.id) sendBrowserNotification('Canal de voz', `${username} entrou em ${channelName}`);
});

socket.on('voiceUserLeft', ({ socketId, userId, username, channelName }) => {
  if (username) {
    showToast(`${username} saiu do canal de voz ${channelName}`, 'info');
    playSound('leave');
    if (userId !== myUser?.id) sendBrowserNotification('Canal de voz', `${username} saiu de ${channelName}`);
  }
  const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === socketId);
  if (vu) updateSpeakingUI(vu.userId, false);
  if (voicePeers[socketId]) { voicePeers[socketId].pc.close(); delete voicePeers[socketId]; }
  document.getElementById(`voice-peer-${socketId}`)?.remove();
});

socket.on('voiceSpeaking', ({ socketId, speaking }) => {
  const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === socketId);
  if (vu) updateSpeakingUI(vu.userId, speaking);
});

socket.on('voiceMuteToggle', ({ socketId, muted }) => {
  const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === socketId);
  if (!vu) return;
  vu.muted = muted;
  renderVoiceUsersInSidebar();
});

const remoteVideoTypes = {};

socket.on('videoTypeChanged', ({ socketId, videoType }) => {
  remoteVideoTypes[socketId] = videoType;
});

socket.on('voiceOffer', async ({ offer, fromSocketId }) => {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  voicePeers[fromSocketId] = { pc };
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  if (screenStream) {
    screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
  }
  pc.ontrack = (e) => {
    if (e.track.kind === 'video') {
      const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === fromSocketId);
      const userId = vu?.userId || fromSocketId;
      if (remoteVideoTypes[fromSocketId] === 'webcam') {
        addWebcamVideo(userId, e.streams[0], false);
      } else {
        addScreenShareVideo(fromSocketId, e.streams[0]);
      }
    } else {
      addVoicePeerAudio(fromSocketId, e.streams[0]);
    }
  };
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('voiceIceCandidate', { candidate: e.candidate, targetSocketId: fromSocketId }); };
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('voiceAnswer', { answer, targetSocketId: fromSocketId });
});

socket.on('voiceAnswer', async ({ answer, fromSocketId }) => {
  if (voicePeers[fromSocketId]?.pc) await voicePeers[fromSocketId].pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('voiceIceCandidate', ({ candidate, fromSocketId }) => {
  if (voicePeers[fromSocketId]?.pc) voicePeers[fromSocketId].pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
});

async function createVoicePeerOffer(targetSocketId) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  voicePeers[targetSocketId] = { pc };
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  if (screenStream) {
    screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
  }
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => pc.addTrack(t, webcamStream));
  }
  pc.ontrack = (e) => {
    if (e.track.kind === 'video') {
      const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === targetSocketId);
      const userId = vu?.userId || targetSocketId;
      if (remoteVideoTypes[targetSocketId] === 'webcam') {
        addWebcamVideo(userId, e.streams[0], false);
      } else {
        addScreenShareVideo(targetSocketId, e.streams[0]);
      }
    } else {
      addVoicePeerAudio(targetSocketId, e.streams[0]);
    }
  };
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('voiceIceCandidate', { candidate: e.candidate, targetSocketId }); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('voiceOffer', { offer, targetSocketId });
}

function addVoicePeerAudio(socketId, stream) {
  let audio = document.getElementById(`voice-audio-${socketId}`);
  if (!audio) { audio = document.createElement('audio'); audio.id = `voice-audio-${socketId}`; audio.autoplay = true; document.body.appendChild(audio); }
  audio.srcObject = stream;
  audio.volume = 1.0;
  startRemoteVAD(socketId, stream);
}

function addScreenShareVideo(socketId, stream) {
  let panel = document.getElementById(`remoteScreen-${socketId}`);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = `remoteScreen-${socketId}`;
    panel.className = 'ss-floating-panel';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    panel.appendChild(video);
    const controls = createScreenShareControls(video, false);
    panel.appendChild(controls);
    const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === socketId);
    const label = document.createElement('div');
    label.className = 'screen-share-view-label';
    label.innerHTML = `<span class="live-dot"></span> 🔴 Tela de ${vu?.username || 'Alguem'}`;
    panel.appendChild(label);
    const chatMain = document.querySelector('.chat-main');
    if (chatMain) chatMain.appendChild(panel);
  }
  const video = panel.querySelector('video');
  if (video) video.srcObject = stream;
}

function removeScreenShareVideo(socketId) {
  const el = document.getElementById(`remoteScreen-${socketId}`);
  if (el) el.remove();
}

let vadThreshold = 15;
window.vadThreshold = vadThreshold;
const speakingUsers = {};

function startLocalVAD(stream) {
  if (!stream) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 60;
  src.connect(hp);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  hp.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let isSpeaking = false;
  let lastSpeakTime = 0;
  let speakStart = 0;

  function check() {
    if (!localStream) { ctx.close(); return; }
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 10; i < data.length; i++) sum += data[i];
    const avg = sum / (data.length - 10);
    const now = Date.now();
    if (avg > window.vadThreshold) {
      if (!isSpeaking) {
        isSpeaking = true;
        speakStart = now;
      }
      lastSpeakTime = now;
      if (now - speakStart > 100) {
        socket.emit('voiceSpeaking', { speaking: true });
      }
    } else if (isSpeaking && now - lastSpeakTime > 500) {
      isSpeaking = false;
      socket.emit('voiceSpeaking', { speaking: false });
    }
    updateSpeakingUI(myUser.id, isSpeaking);
    requestAnimationFrame(check);
  }
  check();
}

function startRemoteVAD(socketId, stream) {
  if (!stream) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 60;
  src.connect(hp);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  hp.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let isSpeaking = false;
  let lastSpeakTime = 0;

  function check() {
    if (!voicePeers[socketId]) { ctx.close(); return; }
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 10; i < data.length; i++) sum += data[i];
    const avg = sum / (data.length - 10);
    const now = Date.now();
    if (avg > window.vadThreshold) {
      if (!isSpeaking) isSpeaking = true;
      lastSpeakTime = now;
    } else if (isSpeaking && now - lastSpeakTime > 500) {
      isSpeaking = false;
    }
    const vu = Object.values(voiceChannelUsers).flat().find(u => u.socketId === socketId);
    if (vu) updateSpeakingUI(vu.userId, isSpeaking);
    requestAnimationFrame(check);
  }
  check();
}

function updateSpeakingUI(userId, speaking) {
  speakingUsers[userId] = speaking;

  const memberAvatar = document.querySelector(`.member-item[data-user-id="${userId}"] .member-avatar`);
  if (memberAvatar) memberAvatar.classList.toggle('speaking', speaking);

  const voiceUserItem = document.querySelector(`.voice-user-item[data-user-id="${userId}"]`);
  if (voiceUserItem) voiceUserItem.classList.toggle('speaking', speaking);

  const voicePanelUsers = document.querySelector(`.voice-panel-user[data-user-id="${userId}"]`);
  if (voicePanelUsers) voicePanelUsers.classList.toggle('speaking', speaking);
}

// ============= GLOBAL SEARCH =============
function openGlobalSearch() {
  const existing = document.querySelector('.search-panel');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.className = 'search-panel';
  panel.innerHTML = `<div class="search-bar"><select id="searchType"><option value="messages">Mensagens</option><option value="users">Usuarios</option><option value="files">Arquivos</option></select><input type="text" id="searchInput" placeholder="Pesquisar..." oninput="doGlobalSearch(this.value)"><input type="date" id="searchDate" title="Filtrar por data" style="background:var(--input);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:12px;"><button onclick="this.parentElement.parentElement.remove()">✕</button></div><div id="searchResults" class="search-results-list"></div>`;
  document.querySelector('.chat-main').insertBefore(panel, document.querySelector('.messages'));
  document.getElementById('searchInput').focus();
  document.getElementById('searchDate').addEventListener('change', () => doGlobalSearch(document.getElementById('searchInput').value));
}

let globalSearchTimeout;
async function doGlobalSearch(query) {
  clearTimeout(globalSearchTimeout);
  if (!query || query.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
  globalSearchTimeout = setTimeout(async () => {
    try {
      const type = document.getElementById('searchType').value;
      const date = document.getElementById('searchDate')?.value;
      let url = `/api/search?q=${encodeURIComponent(query)}&type=${type}${currentGuild ? '&guildId=' + currentGuild.id : ''}`;
      if (date) url += `&date=${date}`;
      const res = await fetch(url);
      const results = await res.json();
      const list = document.getElementById('searchResults');
      if (!results.length) { list.innerHTML = '<div class="search-empty">Nenhum resultado</div>'; return; }
      if (type === 'users') {
        list.innerHTML = results.map(u => `<div class="search-item" onclick="openUserProfile('${u.id}')"><div class="member-avatar small" style="background:${u.avatarColor || '#5865f2'}">${u.avatarEmoji || '👤'}</div><span>${escapeHtml(u.username)}</span></div>`).join('');
      } else {
        list.innerHTML = results.map(m => `<div class="search-item" onclick="scrollToMessage(${m.id})"><span class="search-author" style="color:${m.avatarColor || getColor(m.username)}">${escapeHtml(m.username)}</span><span class="search-text">${escapeHtml(m.text?.substring(0, 100) || (m.file?.name || ''))}</span><span class="search-time">${formatTime(m.timestamp)}</span></div>`).join('');
      }
    } catch (e) { console.error(e); }
  }, 300);
}

// ============= LAZY LOADING =============
let oldestMessageId = null;
function setupLazyLoading() {
  const container = document.getElementById('messages');
  if (!container) return;
  container.addEventListener('scroll', async () => {
    if (container.scrollTop > 200 || !oldestMessageId) return;
    if (currentGuild && currentChannel) {
      try {
        const res = await fetch(`/api/guilds/${currentGuild.id}/channels/${currentChannel}/messages?limit=30&before=${oldestMessageId}`);
        const msgs = await res.json();
        if (msgs.length) {
          const prevScrollHeight = container.scrollHeight;
          msgs.forEach(m => { const el = renderMessagePrepend(m); });
          container.scrollTop = container.scrollHeight - prevScrollHeight;
          oldestMessageId = msgs[0]?.id;
        }
      } catch (e) {}
    } else if (currentChannel) {
      try {
        const res = await fetch(`/api/messages?channel=${currentChannel}&limit=30&before=${oldestMessageId}`);
        const msgs = await res.json();
        if (msgs.length) {
          const prevScrollHeight = container.scrollHeight;
          msgs.forEach(m => renderMessagePrepend(m));
          container.scrollTop = container.scrollHeight - prevScrollHeight;
          oldestMessageId = msgs[0]?.id;
        }
      } catch (e) {}
    }
  });
}

function renderMessagePrepend(msg) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.id = `msg-${msg.id}`;
  div.dataset.userId = msg.userId || '';
  const textHtml = myUser?.settings?.markdown !== false ? renderMarkdown(msg.text) : escapeHtml(msg.text);
  const isOwn = msg.userId === myUser?.id;
  const avatarContent = msg.avatar ? `<img src="${msg.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (msg.avatarEmoji || '👤');
  let fileHtml = '';
  if (msg.file) {
    if (msg.file.type === 'image') fileHtml = `<div class="msg-file"><img src="${msg.file.url}" class="msg-image" onclick="window.open('${msg.file.url}','_blank')"><div class="file-info">${escapeHtml(msg.file.name)} (${formatSize(msg.file.size)})</div></div>`;
    else if (msg.file.type === 'audio') fileHtml = `<div class="msg-file"><audio controls src="${msg.file.url}" class="msg-audio"></audio><div class="file-info">${escapeHtml(msg.file.name)}</div></div>`;
    else fileHtml = `<div class="msg-file"><a href="${msg.file.url}" target="_blank" class="msg-doc">📄 ${escapeHtml(msg.file.name)}<span>${formatSize(msg.file.size)}</span></a></div>`;
  }
  div.className = 'message' + (msg.pinned ? ' pinned' : '');
  let embedHtml = '';
  if (msg.embeds && msg.embeds.length) {
    msg.embeds.forEach(e => {
      if (e.thumbnail) embedHtml += `<div class="msg-embed"><a href="${e.url}" target="_blank"><img src="${e.thumbnail}"></a><div class="embed-title"><a href="${e.url}" target="_blank">${escapeHtml(e.title)}</a></div><div class="embed-provider">${escapeHtml(e.provider)}</div></div>`;
      else embedHtml += `<div class="msg-embed"><div class="embed-title"><a href="${e.url}" target="_blank">${escapeHtml(e.title)}</a></div><div class="embed-provider">${escapeHtml(e.provider)}</div></div>`;
    });
  }
  div.innerHTML = `<div class="msg-avatar clickable" onclick="openUserProfile('${msg.userId}')" style="background:${msg.avatarColor || getColor(msg.username)}">${avatarContent}</div><div class="msg-content"><div class="msg-header"><span class="msg-username clickable" onclick="openUserProfile('${msg.userId}')" style="color:${msg.avatarColor || getColor(msg.username)}">${escapeHtml(msg.username)}</span><span class="msg-time">${formatTime(msg.timestamp)}</span></div><div class="msg-text">${textHtml}</div>${fileHtml}${embedHtml}</div>`;
  container.insertBefore(div, container.firstChild);
  return div;
}

// ============= DRAG AND DROP =============
function setupDragAndDrop() {
  const chatArea = document.querySelector('.chat-main');
  if (!chatArea) return;
  const overlay = document.createElement('div');
  overlay.className = 'drag-overlay hidden';
  overlay.innerHTML = '<div class="drag-icon">📎</div><div class="drag-text">Solte o arquivo aqui</div>';
  chatArea.appendChild(overlay);

  let dragCounter = 0;
  chatArea.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; overlay.classList.remove('hidden'); });
  chatArea.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { overlay.classList.add('hidden'); dragCounter = 0; } });
  chatArea.addEventListener('dragover', (e) => { e.preventDefault(); });
  chatArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const file = files[0];
    if (file.size > 10 * 1024 * 1024) { showToast('Maximo 10MB', 'error'); return; }
    handleFileDrop(file);
  });
}

function handleFileDrop(file) {
  selectedFile = file;
  const preview = document.getElementById('filePreview');
  const content = document.getElementById('filePreviewContent');
  content.innerHTML = '';
  if (file.type.startsWith('image/')) {
    const r = new FileReader();
    r.onload = (e) => { content.innerHTML = `<img src="${e.target.result}" class="preview-image"><span class="file-name">${escapeHtml(file.name)}</span>`; };
    r.readAsDataURL(file);
  } else if (file.type.startsWith('audio/')) {
    content.innerHTML = `<div class="preview-audio">🎙️ ${escapeHtml(file.name)} (${formatSize(file.size)})</div>`;
  } else {
    content.innerHTML = `<div class="preview-doc">📄 ${escapeHtml(file.name)} (${formatSize(file.size)})</div>`;
  }
  preview.classList.remove('hidden');
}

// ============= PASTE IMAGES =============
document.addEventListener('paste', (e) => {
  if (!myUser?.settings?.pasteImages) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) handleFileDrop(file);
      break;
    }
  }
});

// ============= SOCKET EVENTS GUILDS & DMS =============
socket.on('guildUpdate', (data) => {
  if (currentGuild?.id === data.guildId) {
    if (data.channels) { allChannels = data.channels; allCategories = data.categories || {}; renderGuildChannels(); }
    if (data.name) { currentGuild.name = data.name; document.getElementById('guildHeaderName').textContent = data.name; }
    if (data.icon !== undefined) currentGuild.icon = data.icon;
    if (data.banner !== undefined) currentGuild.banner = data.banner;
    if (data.description !== undefined) currentGuild.description = data.description;
    if (data.splashColor !== undefined) currentGuild.splashColor = data.splashColor;
    renderGuildsSidebar();
  }
});

socket.on('guildDelete', (data) => {
  if (currentGuild?.id === data.guildId) {
    currentGuild = null;
    currentChannel = null;
    loadGuilds();
    loadDMs();
    renderMainContent();
  } else {
    loadGuilds();
  }
});

socket.on('activityUpdate', (log) => {
  const container = document.getElementById('activityList');
  if (container && log) renderActivity(log);
});

socket.on('categoriesUpdate', (cats) => {
  if (currentGuild) { allCategories = cats; renderGuildChannels(); }
});

socket.on('channelInvite', ({ inviteId, channelId, invitedBy }) => {
  showToast(`${invitedBy} te convidou para um canal! Clique para aceitar.`, 'info');
  const ch = allChannels[channelId];
  if (ch) { acceptChannelInvite(channelId); }
});

socket.on('dmMessage', (msg) => {
  if (currentDM && msg.dmId === currentDM.id) {
    renderMessage(msg);
    playSound('msg');
  }
  if (document.visibilityState === 'hidden') sendBrowserNotification(msg.username, msg.text || msg.file?.name || 'Arquivo');
});

socket.on('dmOpened', (dm) => {
  currentDM = dm;
  if (!myDMs.find(d => d.id === dm.id)) myDMs.push(dm);
  renderDMsSidebar();
  document.getElementById('messages').innerHTML = '';
  const u = dm.otherUser;
  document.querySelector('.channel-name').textContent = u ? `@${u.username}` : dm.name;
});

socket.on('voiceDisconnected', () => { playSound('leave'); hideVoicePanel(); });

socket.on('voiceError', ({ error }) => {
  showToast(error, 'error');
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  voiceConnected = false;
  currentVoiceChannel = null;
  hideVoicePanel();
  renderGuildChannels();
});

// ============= VOICE USERS UPDATE =============
socket.on('voiceUsersUpdate', ({ guildId, channelUsers }) => {
  if (currentGuild?.id !== guildId) return;
  voiceChannelUsers = channelUsers;
  renderVoiceUsersInSidebar();
});
socket.on('guildMemberRemoved', (data) => { if (currentGuild?.id === data.guildId) selectGuild(currentGuild); });
socket.on('guildMemberBanned', (data) => { if (currentGuild?.id === data.guildId) selectGuild(currentGuild); });

// Patch renderMessage pra usar markdown
const _origRenderMessage = renderMessage;
renderMessage = function(msg) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message' + (msg.pinned ? ' pinned' : '') + (msg.mentions?.includes(myUser?.id) ? ' mentioned' : '');
  div.id = `msg-${msg.id}`;
  div.dataset.userId = msg.userId || '';

  let replyHtml = '';
  if (msg.replyTo) replyHtml = `<div class="msg-reply"><span class="reply-author">@${escapeHtml(msg.replyTo.username)}</span> <span class="reply-text">${escapeHtml(msg.replyTo.text)}</span></div>`;

  let fileHtml = '';
  if (msg.file) {
    if (msg.file.type === 'image') fileHtml = `<div class="msg-file"><img src="${msg.file.url}" class="msg-image" onclick="window.open('${msg.file.url}','_blank')"><div class="file-info">${escapeHtml(msg.file.name)} (${formatSize(msg.file.size)})</div></div>`;
    else if (msg.file.type === 'audio') fileHtml = `<div class="msg-file"><audio controls src="${msg.file.url}" class="msg-audio"></audio><div class="file-info">${escapeHtml(msg.file.name)}</div></div>`;
    else fileHtml = `<div class="msg-file"><a href="${msg.file.url}" target="_blank" class="msg-doc">📄 ${escapeHtml(msg.file.name)}<span>${formatSize(msg.file.size)}</span></a></div>`;
  }

  let reactionsHtml = '';
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    reactionsHtml = '<div class="reactions">';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      reactionsHtml += `<button class="reaction-btn${users.includes(myUser?.username) ? ' active' : ''}" onclick="toggleReaction(${msg.id},'${emoji}')">${emoji} <span>${users.length}</span></button>`;
    }
    reactionsHtml += `<button class="reaction-add" onclick="showQuickReact(event,${msg.id})">+</button></div>`;
  }

  const textHtml = myUser?.settings?.markdown !== false ? renderMarkdown(msg.text) : escapeHtml(msg.text);
  const isOwn = msg.userId === myUser?.id;
  const avatarContent = msg.avatar ? `<img src="${msg.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (msg.avatarEmoji || '👤');

  div.innerHTML = `
    <div class="msg-avatar clickable" onclick="openUserProfile('${msg.userId}')" style="background:${msg.avatarColor || getColor(msg.username)}">${avatarContent}</div>
    <div class="msg-content">
      <div class="msg-header">
        <span class="msg-username clickable" onclick="openUserProfile('${msg.userId}')" style="color:${msg.avatarColor || getColor(msg.username)}">${escapeHtml(msg.username)}</span>
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        ${msg.edited ? '<span class="msg-edited">(editado)</span>' : ''}
        ${msg.pinned ? '<span class="msg-pin-badge">📌</span>' : ''}
      </div>
      ${replyHtml}
      <div class="msg-text">${textHtml}</div>
      ${fileHtml}
      ${(msg.embeds || []).map(e => e.thumbnail ? `<div class="msg-embed"><a href="${e.url}" target="_blank"><img src="${e.thumbnail}"></a><div class="embed-title"><a href="${e.url}" target="_blank">${escapeHtml(e.title)}</a></div><div class="embed-provider">${escapeHtml(e.provider)}</div></div>` : `<div class="msg-embed"><div class="embed-title"><a href="${e.url}" target="_blank">${escapeHtml(e.title)}</a></div><div class="embed-provider">${escapeHtml(e.provider)}</div></div>`).join('')}
      ${reactionsHtml}
    </div>
    ${isOwn ? `<div class="msg-menu-btn" onclick="showContextMenu(event,${msg.id},'${escapeHtml(msg.username)}','${escapeHtml(msg.text)}')">⋯</div>` : `<div class="msg-menu-btn react-btn" onclick="showQuickReact(event,${msg.id})">😀</div>`}
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  if (document.visibilityState === 'hidden' && msg.userId !== myUser?.id) sendBrowserNotification(msg.username, msg.text || msg.file?.name || 'Arquivo');
};

// Patch sendMessage pra suportar guilds e DMs
const _origSendMessage = sendMessage;
sendMessage = function() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text && !selectedFile) return;

  const data = {
    text,
    channel: currentChannel || 'geral',
    guildId: currentGuild?.id || null,
    dmId: currentDM?.id || null,
    replyTo: replyingTo ? { id: replyingTo.id, username: replyingTo.username, text: replyingTo.text } : null
  };

  if (selectedFile) {
    const reader = new FileReader();
    reader.onload = (e) => {
      data.base64 = e.target.result;
      data.filename = selectedFile.name;
      data.fileType = selectedFile.type.startsWith('image/') ? 'image' : selectedFile.type.startsWith('audio/') ? 'audio' : 'file';
      data.size = selectedFile.size;
      if (data.dmId) socket.emit('dmMessage', data);
      else socket.emit('fileMessage', data);
      removeFilePreview();
    };
    reader.readAsDataURL(selectedFile);
  } else {
    if (data.dmId) socket.emit('dmMessage', data);
    else socket.emit('message', data);
  }

  input.value = '';
  cancelReply();
  socket.emit('stopTyping');
};

// Patch checkSession pra incluir novos sistemas
const _origCheckSession = checkSession;
checkSession = function() {
  const saved = localStorage.getItem('pulseUser');
  const token = localStorage.getItem('pulseToken');
  if (saved) {
    myUser = JSON.parse(saved);
    authToken = token;
    enterChat();
    const params = new URLSearchParams(location.search);
    const inviteCode = params.get('invite');
    if (inviteCode) joinGuildByCode(inviteCode);
  } else {
    showWelcome();
    initParticles();
  }
};

// Patch enterChat pra carregar guilds, DMs, etc
const _origEnterChat = enterChat;
enterChat = function() {
  hideAll();
  document.getElementById('chatApp').classList.remove('hidden');
  updateMyUI();
  socket.emit('join', myUser.id);
  loadChannels();
  loadMessages();
  loadGuilds();
  loadDMs();
  initEmojiPicker();
  applyTheme(myUser.settings?.theme || 'dark');
  applyFontSize(myUser.settings?.fontSize || 14);
  if (myUser.settings?.accentColor) applyAccent(myUser.settings.accentColor);
  applyAccessibility();
  loadFriends();
  requestNotificationPermission();
  setupLazyLoading();
  setupDragAndDrop();
  oldestMessageId = null;
  const savedVoice = localStorage.getItem('pulseVoice');
  if (savedVoice) {
    try {
      const vc = JSON.parse(savedVoice);
      setTimeout(() => joinVoiceChannel(vc.guildId, vc.channelId), 1500);
    } catch (e) { localStorage.removeItem('pulseVoice'); }
  }
};

socket.on('connect', () => {
  if (myUser) {
    socket.emit('join', myUser.id);
    const savedVoice = localStorage.getItem('pulseVoice');
    if (savedVoice && !voiceConnected) {
      try {
        const vc = JSON.parse(savedVoice);
        setTimeout(() => joinVoiceChannel(vc.guildId, vc.channelId), 1000);
      } catch (e) { localStorage.removeItem('pulseVoice'); }
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && myUser && !socket.connected) {
    socket.connect();
  }
});

// ============= THREADS =============
let currentThread = null;
let myThreads = [];

async function loadThreads(guildId, channelId) {
  try {
    const res = await fetch(`/api/guilds/${guildId}/channels/${channelId}/threads`);
    myThreads = await res.json();
    renderThreads();
  } catch (e) { console.error(e); }
}

function renderThreads() {
  const container = document.getElementById('threadsList');
  if (!container) return;
  container.innerHTML = '';
  if (!myThreads.length) { container.innerHTML = '<div class="thread-empty">Nenhuma thread</div>'; return; }
  myThreads.forEach(t => {
    const div = document.createElement('div');
    div.className = 'thread-item' + (currentThread?.id === t.id ? ' active' : '');
    div.onclick = () => openThread(t);
    div.innerHTML = `<div class="thread-info"><span class="thread-name">💬 ${escapeHtml(t.name)}</span><span class="thread-meta">${t.replyCount || 0} respostas</span></div>`;
    container.appendChild(div);
  });
}

async function createThread() {
  const name = prompt('Nome da thread:');
  if (!name || !currentGuild || !currentChannel) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/channels/${currentChannel}/threads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.success) { loadThreads(currentGuild.id, currentChannel); showToast('Thread criada!', 'success'); }
  } catch (e) { showToast('Erro ao criar thread', 'error'); }
}

function openThread(thread) {
  currentThread = thread;
  document.getElementById('messages').innerHTML = '';
  document.querySelector('.channel-name').textContent = `🧵 ${thread.name}`;
  document.getElementById('messageInput').placeholder = `Responder na thread "${thread.name}"...`;
  loadThreadMessages(thread.id);
  document.getElementById('threadPanel')?.classList.remove('hidden');
}

async function loadThreadMessages(threadId) {
  try {
    const res = await fetch(`/api/threads/${threadId}/messages`);
    const msgs = await res.json();
    msgs.forEach(renderMessage);
  } catch (e) { console.error(e); }
}

function closeThread() {
  currentThread = null;
  document.getElementById('threadPanel')?.classList.add('hidden');
  if (currentChannel) {
    const ch = allChannels[currentChannel];
    document.querySelector('.channel-name').textContent = '# ' + (ch?.name || currentChannel);
    document.getElementById('messageInput').placeholder = `Enviar mensagem para #${ch?.name || currentChannel}...`;
  }
}

// Patch sendMessage pra suportar threads
const _prevSendMessage2 = sendMessage;
sendMessage = function() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text && !selectedFile) return;
  if (currentThread) {
    socket.emit('threadMessage', { text, threadId: currentThread.id, guildId: currentGuild?.id, channel: currentChannel });
    input.value = '';
    cancelReply();
    socket.emit('stopTyping');
    return;
  }
  _prevSendMessage2();
};

// ============= CUSTOM EMOJI/STICKERS =============
async function openEmojiManager() {
  if (!currentGuild) { showToast('Selecione um servidor', 'error'); return; }
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'emojiManagerModal';
  modal.innerHTML = `<div class="modal-content wide"><h3>Gerenciar Emojis & Stickers</h3><div class="emoji-manager-tabs"><button class="tab active" onclick="switchEmojiTab('emoji',this)">Emojis</button><button class="tab" onclick="switchEmojiTab('sticker',this)">Stickers</button></div><div id="emojiManagerContent"><div id="emojiUploadSection"><input type="text" id="emojiName" placeholder="Nome do emoji"><input type="file" accept="image/*" id="emojiFile"><button class="btn-small" onclick="uploadCustomEmoji()">Enviar</button><div id="emojiGridManager" class="emoji-grid-manager"></div></div></div><div class="modal-actions"><button class="modal-cancel" onclick="closeModal('emojiManagerModal')">Fechar</button></div></div>`;
  document.body.appendChild(modal);
  loadCustomEmojiList();
}

async function loadCustomEmojiList() {
  if (!currentGuild) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/emoji`);
    const emojis = await res.json();
    const grid = document.getElementById('emojiGridManager');
    if (!grid) return;
    grid.innerHTML = '';
    emojis.forEach(e => {
      const div = document.createElement('div');
      div.className = 'custom-emoji-item';
      div.innerHTML = `<img src="${e.url}" title=":${e.name}:"><span>:${e.name}:</span>`;
      div.onclick = () => { document.getElementById('messageInput').value += ` :${e.name}: `; closeModal('emojiManagerModal'); };
      grid.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

async function uploadCustomEmoji() {
  const name = document.getElementById('emojiName')?.value?.trim();
  const file = document.getElementById('emojiFile')?.files[0];
  if (!name || !file) return showToast('Nome e arquivo obrigatorios', 'error');
  const reader = new FileReader();
  reader.onload = async (e) => {
    const res = await fetch(`/api/guilds/${currentGuild.id}/emoji`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, base64: e.target.result })
    });
    const data = await res.json();
    if (data.success) { loadCustomEmojiList(); showToast('Emoji criado!', 'success'); }
  };
  reader.readAsDataURL(file);
}

function switchEmojiTab(tab, btn) {
  document.querySelectorAll('.emoji-manager-tabs .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ============= BOT FRAMEWORK =============
async function openBotCreator() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'botCreatorModal';
  modal.innerHTML = `<div class="modal-content"><h3>Criar Bot</h3><input type="text" id="botName" placeholder="Nome do bot"><div class="modal-actions"><button class="modal-cancel" onclick="closeModal('botCreatorModal')">Cancelar</button><button class="modal-confirm" onclick="createBot()">Criar</button></div></div>`;
  document.body.appendChild(modal);
}

async function createBot() {
  const name = document.getElementById('botName')?.value?.trim();
  if (!name) return;
  try {
    const res = await fetch('/api/bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (data.success) { showToast(`Bot criado! Token: ${data.bot.token}`, 'success'); closeModal('botCreatorModal'); }
  } catch (e) { showToast('Erro ao criar bot', 'error'); }
}

// ============= EVENTS =============
let currentGuildEvents = [];

async function loadEvents() {
  if (!currentGuild) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/events`);
    currentGuildEvents = await res.json();
    renderEvents();
  } catch (e) { console.error(e); }
}

function renderEvents() {
  const container = document.getElementById('eventsList');
  if (!container) return;
  container.innerHTML = '';
  if (!currentGuildEvents.length) { container.innerHTML = '<div class="event-empty">Nenhum evento</div>'; return; }
  currentGuildEvents.forEach(evt => {
    const div = document.createElement('div');
    div.className = 'event-item';
    const isAttending = evt.attendees?.includes(myUser?.id);
    const date = new Date(evt.startTime);
    div.innerHTML = `<div class="event-info"><span class="event-name">📅 ${escapeHtml(evt.name)}</span><span class="event-date">${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><span class="event-location">📍 ${escapeHtml(evt.location)}</span></div><div class="event-actions"><button class="btn-small ${isAttending ? 'active' : ''}" onclick="rsvpEvent('${evt.id}')">${isAttending ? '✓ Vou' : 'Participar'}</button><span class="event-count">${evt.attendees?.length || 0} irao</span></div>`;
    container.appendChild(div);
  });
}

async function createEvent() {
  if (!currentGuild) return showToast('Selecione um servidor', 'error');
  const name = prompt('Nome do evento:');
  if (!name) return;
  const startTime = prompt('Data e hora (YYYY-MM-DD HH:MM):');
  if (!startTime) return;
  const location = prompt('Local (ou deixe vazio para Online):') || 'Online';
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, startTime, location })
    });
    const data = await res.json();
    if (data.success) { loadEvents(); showToast('Evento criado!', 'success'); }
  } catch (e) { showToast('Erro ao criar evento', 'error'); }
}

async function rsvpEvent(eventId) {
  try {
    const res = await fetch(`/api/events/${eventId}/rsvp`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.success) loadEvents();
  } catch (e) { showToast('Erro', 'error'); }
}

// ============= XP / LEADERBOARD =============
let leaderboardData = [];

async function loadLeaderboard() {
  if (!currentGuild) return;
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/leaderboard`);
    leaderboardData = await res.json();
    renderLeaderboard();
  } catch (e) { console.error(e); }
}

function renderLeaderboard() {
  const container = document.getElementById('leaderboardList');
  if (!container) return;
  container.innerHTML = '';
  if (!leaderboardData.length) { container.innerHTML = '<div class="lb-empty">Nenhum dado ainda</div>'; return; }
  leaderboardData.forEach((u, i) => {
    const div = document.createElement('div');
    div.className = 'lb-item' + (i < 3 ? ' top-' + (i + 1) : '');
    const medals = ['🥇', '🥈', '🥉'];
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    const avatarContent = u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (u.avatarEmoji || '👤');
    div.innerHTML = `<span class="lb-rank">${medal}</span><div class="member-avatar small" style="background:${u.avatarColor || '#5865f2'}">${avatarContent}</div><div class="lb-info"><span class="lb-name">${escapeHtml(u.username)}</span><span class="lb-level">Nivel ${u.level}</span></div><span class="lb-xp">${u.xp} XP</span>`;
    container.appendChild(div);
  });
}

socket.on('levelUp', ({ guildId, userId, level }) => {
  if (userId === myUser?.id && guildId === currentGuild?.id) {
    showToast(`🎉 Voce subiu para o nivel ${level}!`, 'success');
    playSound('join');
  }
});

// ============= ADMIN PANEL =============
async function generateInviteLink() {
  if (!currentGuild) { showToast('Selecione um servidor', 'error'); return; }
  try {
    const res = await fetch(`/api/guilds/${currentGuild.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken } });
    const data = await res.json();
    if (!data.success) { showToast(data.error, 'error'); return; }
    const link = `${location.origin}?invite=${data.code}`;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content"><h3>🔗 Link de Convite</h3><p style="color:var(--muted);font-size:13px;margin-bottom:8px;">Compartilhe este link para convidar pessoas ao servidor:</p><div class="input-row"><input type="text" value="${link}" readonly id="inviteLinkInput"><button onclick="navigator.clipboard.writeText('${link}');showToast('Copiado!','success')">Copiar</button></div><div class="modal-actions"><button class="modal-cancel" onclick="this.closest('.modal').remove()">Fechar</button></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('inviteLinkInput').select();
  } catch (e) { showToast('Erro ao gerar convite', 'error'); }
}

async function openAdminPanel() {
  try {
    const res = await fetch('/api/admin/stats');
    const stats = await res.json();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'adminModal';
    modal.innerHTML = `<div class="modal-content wide"><h3>Painel Admin</h3><div class="admin-stats"><div class="stat-card"><span class="stat-num">${stats.totalUsers}</span><span class="stat-label">Usuarios</span></div><div class="stat-card"><span class="stat-num">${stats.totalGuilds}</span><span class="stat-label">Servidores</span></div><div class="stat-card"><span class="stat-num">${stats.totalMessages}</span><span class="stat-label">Mensagens</span></div><div class="stat-card"><span class="stat-num">${stats.onlineUsers}</span><span class="stat-label">Online</span></div></div><h4>Logins Recentes</h4><div class="admin-logins">${stats.recentLogins.map(l => `<div class="login-item">${l.userId} - ${new Date(l.timestamp).toLocaleString('pt-BR')}</div>`).join('') || 'Nenhum login'}</div><div class="modal-actions"><button class="modal-cancel" onclick="closeModal('adminModal')">Fechar</button></div></div>`;
    document.body.appendChild(modal);
  } catch (e) { showToast('Erro ao carregar admin', 'error'); }
}

// ============= SCREEN SHARE =============
let screenStream = null;
let screenSharing = false;
let webcamStream = null;
let webcamOn = false;

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
    const track = screenStream.getVideoTracks()[0];
    track.onended = () => stopScreenShare();
    screenSharing = true;
    socket.emit('screenShareStart', {});

    for (const [socketId, peer] of Object.entries(voicePeers)) {
      if (peer.pc) {
        const videoSender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(track);
        } else {
          peer.pc.addTrack(track, screenStream);
        }
        const audioTrack = screenStream.getAudioTracks()[0];
        if (audioTrack) {
          const audioSender = peer.pc.getSenders().find(s => s.track?.kind === 'audio' && s !== peer.pc.getSenders().find(ss => ss.track === localStream?.getAudioTracks()[0]));
          if (audioSender) {
            audioSender.replaceTrack(audioTrack);
          } else {
            peer.pc.addTrack(audioTrack, screenStream);
          }
        }
      }
    }
    showScreenShareOverlay(true);
    addLocalScreenPreview(screenStream);
    socket.emit('videoTypeChanged', { videoType: 'screen' });
    playSound('screenshare');
    showToast('Voce esta compartilhando a tela!', 'success');
  } catch (e) { showToast('Compartilhamento cancelado', 'error'); }
}

function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  screenSharing = false;
  socket.emit('screenShareStop', {});
  playSound('screenshareStop');

  for (const [socketId, peer] of Object.entries(voicePeers)) {
    if (peer.pc) {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(null);
    }
  }
  showScreenShareOverlay(false);
  removeLocalScreenPreview();
  socket.emit('videoTypeChanged', { videoType: webcamOn ? 'webcam' : 'none' });
}

function showScreenShareOverlay(show) {
  let overlay = document.getElementById('screenShareOverlay');
  if (show && !overlay) {
    overlay = document.createElement('div');
    overlay.id = 'screenShareOverlay';
    overlay.className = 'screen-share-overlay';
    overlay.innerHTML = `<div class="screen-share-badge">🔴 AO VIVO</div>`;
    document.querySelector('.chat-main')?.prepend(overlay);
  } else if (!show && overlay) {
    overlay.remove();
  }
  const btn = document.getElementById('screenShareBtn');
  if (btn) btn.classList.toggle('active', show);
  updateLiveBadges(show);
}

function updateLiveBadges(live) {
  const items = document.querySelectorAll('.voice-user-item');
  items.forEach(item => {
    const uid = item.getAttribute('data-user-id');
    if (uid === myUser.id) {
      let badge = item.querySelector('.live-badge-sidebar');
      if (live && !badge) {
        badge = document.createElement('span');
        badge.className = 'live-badge-sidebar';
        badge.textContent = '🔴 AO VIVO';
        item.appendChild(badge);
      } else if (!live && badge) {
        badge.remove();
      }
    }
  });
}

function toggleScreenShare() {
  if (screenSharing) stopScreenShare();
  else startScreenShare();
}

async function toggleWebcam() {
  if (webcamOn) { stopWebcam(); return; }
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    webcamOn = true;
    document.getElementById('webcamBtn').classList.add('active');
    for (const [socketId, peer] of Object.entries(voicePeers)) {
      if (peer.pc) {
        const track = webcamStream.getVideoTracks()[0];
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video' && s !== peer.pc.getSenders().find(ss => ss.track === screenStream?.getVideoTracks()[0]));
        if (sender) sender.replaceTrack(track);
        else peer.pc.addTrack(track, webcamStream);
      }
    }
    addWebcamVideo(myUser.id, webcamStream, true);
    socket.emit('videoTypeChanged', { videoType: 'webcam' });
    showToast('Webcam ligada!', 'success');
  } catch (e) { showToast('Webcam negada', 'error'); }
}

function stopWebcam() {
  if (webcamStream) { webcamStream.getTracks().forEach(t => t.stop()); webcamStream = null; }
  webcamOn = false;
  document.getElementById('webcamBtn')?.classList.remove('active');
  removeWebcamVideo(myUser.id);
  socket.emit('videoTypeChanged', { videoType: screenSharing ? 'screen' : 'none' });
  for (const [socketId, peer] of Object.entries(voicePeers)) {
    if (peer.pc) {
      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(null);
    }
  }
}

function addWebcamVideo(userId, stream, isLocal) {
  removeWebcamVideo(userId);
  let grid = document.getElementById('webcamGrid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'webcamGrid';
    grid.className = 'webcam-grid';
    const chatMain = document.querySelector('.chat-main');
    if (chatMain) chatMain.appendChild(grid);
  }
  const item = document.createElement('div');
  item.className = 'webcam-item';
  item.id = `webcam-${userId}`;
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  video.srcObject = stream;
  const label = document.createElement('div');
  label.className = 'webcam-label';
  label.textContent = isLocal ? 'Voce' : (Object.values(voiceChannelUsers).flat().find(u => u.userId === userId)?.username || 'Alguem');
  item.appendChild(video);
  item.appendChild(label);
  grid.appendChild(item);
}

function removeWebcamVideo(userId) {
  const el = document.getElementById(`webcam-${userId}`);
  if (el) el.remove();
  const grid = document.getElementById('webcamGrid');
  if (grid && !grid.children.length) grid.remove();
}

function addLocalScreenPreview(stream) {
  removeLocalScreenPreview();
  const panel = document.createElement('div');
  panel.id = 'localScreenPreview';
  panel.className = 'ss-floating-panel';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  panel.appendChild(video);
  const controls = createScreenShareControls(video, true);
  panel.appendChild(controls);
  const label = document.createElement('div');
  label.className = 'screen-share-view-label';
  label.innerHTML = '<span class="live-dot"></span> 🔴 Sua tela';
  panel.appendChild(label);
  const chatMain = document.querySelector('.chat-main');
  if (chatMain) chatMain.appendChild(panel);
}

function removeLocalScreenPreview() {
  const el = document.getElementById('localScreenPreview');
  if (el) el.remove();
}

function createScreenShareControls(videoEl, isLocal) {
  const bar = document.createElement('div');
  bar.className = 'screen-share-controls';

  const fsBtn = document.createElement('button');
  fsBtn.className = 'ss-ctrl-btn';
  fsBtn.innerHTML = '⛶';
  fsBtn.title = 'Tela cheia';
  fsBtn.onclick = () => {
    if (videoEl.requestFullscreen) videoEl.requestFullscreen();
    else if (videoEl.webkitRequestFullscreen) videoEl.webkitRequestFullscreen();
  };
  bar.appendChild(fsBtn);

  if (!isLocal) {
    const volLabel = document.createElement('span');
    volLabel.className = 'ss-vol-label';
    volLabel.textContent = '🔊';
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = '100';
    volSlider.className = 'ss-vol-slider';
    volSlider.oninput = () => { videoEl.volume = volSlider.value / 100; };
    bar.appendChild(volLabel);
    bar.appendChild(volSlider);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ss-ctrl-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.title = 'Fechar preview';
  closeBtn.onclick = () => {
    if (isLocal) removeLocalScreenPreview();
    else {
      const panel = videoEl.closest('.ss-floating-panel');
      if (panel) panel.remove();
    }
  };
  bar.appendChild(closeBtn);

  return bar;
}

// ============= EVENT HANDLERS FASE 4 =============
socket.on('threadCreated', (thread) => {
  if (thread.guildId === currentGuild?.id && thread.channelId === currentChannel) {
    myThreads.push(thread);
    renderThreads();
  }
});

socket.on('threadMessage', (msg) => {
  if (currentThread && msg.threadId === currentThread.id) {
    renderMessage(msg);
    playSound('msg');
  }
});

socket.on('eventCreated', (evt) => {
  if (evt.guildId === currentGuild?.id) {
    currentGuildEvents.push(evt);
    renderEvents();
    showToast(`📅 Evento: ${evt.name}`, 'info');
  }
});

socket.on('eventDeleted', ({ eventId, guildId }) => {
  if (guildId === currentGuild?.id) {
    currentGuildEvents = currentGuildEvents.filter(e => e.id !== eventId);
    renderEvents();
  }
});

socket.on('screenShareStarted', ({ socketId, username }) => {
  showToast(`${username} esta compartilhando a tela`, 'info');
  let badge = document.getElementById(`live-badge-${socketId}`);
  if (!badge) {
    badge = document.createElement('div');
    badge.id = `live-badge-${socketId}`;
    badge.className = 'live-badge';
    badge.textContent = `🔴 ${username} esta ao vivo`;
    const chatMain = document.querySelector('.chat-main');
    if (chatMain) chatMain.insertBefore(badge, chatMain.firstChild);
  }
});

socket.on('screenShareStopped', ({ socketId }) => {
  removeScreenShareVideo(socketId);
  const badge = document.getElementById(`live-badge-${socketId}`);
  if (badge) badge.remove();
  showToast('Compartilhamento de tela encerrado', 'info');
});

// Atalho Ctrl+Shift+S pra screen share
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); startScreenShare(); }
});

// ============= PATCH enterChat pra incluir threads/events/leaderboard =============
const _prevEnterChat2 = enterChat;
enterChat = function() {
  _prevEnterChat2();
  if (currentGuild) {
    loadThreads(currentGuild.id, currentChannel);
    loadEvents();
    loadLeaderboard();
  }
};

// Patch selectGuild pra carregar threads/events/leaderboard
const _prevSelectGuild = selectGuild;
selectGuild = async function(guild) {
  await _prevSelectGuild(guild);
  loadEvents();
  loadLeaderboard();
};

// Patch switchGuildChannel pra carregar threads
const _prevSwitchGuildChannel = switchGuildChannel;
switchGuildChannel = function(channelId) {
  _prevSwitchGuildChannel(channelId);
  if (currentGuild) loadThreads(currentGuild.id, channelId);
};

checkSession();
