const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const dbModule = require('./db');
const { loadDB, saveDB, pool, regFile, initPG, restoreFromPG } = dbModule;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10e6 });

const JWT_SECRET = process.env.JWT_SECRET || 'pulse_' + (fs.existsSync(path.join(__dirname, 'data', '.secret')) ? fs.readFileSync(path.join(__dirname, 'data', '.secret'), 'utf8') : (() => { const s = require('crypto').randomBytes(32).toString('hex'); fs.writeFileSync(path.join(__dirname, 'data', '.secret'), s); return s; })());

const apiLimiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas, tente novamente' } });
const authLimiter = rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas de login' } });

app.use('/api/', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const dirs = ['public/uploads', 'public/uploads/avatars', 'data'];
dirs.forEach(d => { const p = path.join(__dirname, d); if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });

const DB_FILE = path.join(__dirname, 'data', 'users.json');
const MSG_DB = path.join(__dirname, 'data', 'messages.json');
const CHANNELS_FILE = path.join(__dirname, 'data', 'channels.json');
const GUILDS_FILE = path.join(__dirname, 'data', 'guilds.json');
const DMS_FILE = path.join(__dirname, 'data', 'dms.json');
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categories.json');
const ACTIVITY_FILE = path.join(__dirname, 'data', 'activity.json');
const CHANNEL_INVITES_FILE = path.join(__dirname, 'data', 'channel_invites.json');
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');
const XP_FILE = path.join(__dirname, 'data', 'xp.json');
const THREADS_FILE = path.join(__dirname, 'data', 'threads.json');
const EMOJI_FILE = path.join(__dirname, 'data', 'custom_emoji.json');
const BOTS_FILE = path.join(__dirname, 'data', 'bots.json');
const EVENTS_FILE = path.join(__dirname, 'data', 'events.json');
const STICKERS_FILE = path.join(__dirname, 'data', 'stickers.json');

regFile('users', DB_FILE);
regFile('messages', MSG_DB);
regFile('channels', CHANNELS_FILE);
regFile('guilds', GUILDS_FILE);
regFile('dms', DMS_FILE);
regFile('categories', CATEGORIES_FILE);
regFile('activity', ACTIVITY_FILE);
regFile('channel_invites', CHANNEL_INVITES_FILE);
regFile('admin', ADMIN_FILE);
regFile('xp', XP_FILE);
regFile('threads', THREADS_FILE);
regFile('custom_emoji', EMOJI_FILE);
regFile('bots', BOTS_FILE);
regFile('events', EVENTS_FILE);
regFile('stickers', STICKERS_FILE);

function generateToken(userId) { return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' }); }
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token necessario' });
  try { req.userId = jwt.verify(token, JWT_SECRET).userId; next(); } catch { res.status(401).json({ error: 'Token invalido' }); }
}

const messages = new Map();
const users = new Map();
const pinnedMessages = new Map();
let messageIdCounter = 0;

function loadMessagesFromDisk() {
  if (fs.existsSync(MSG_DB)) {
    const saved = JSON.parse(fs.readFileSync(MSG_DB, 'utf8'));
    saved.forEach(m => { messages.set(m.id, m); messageIdCounter = Math.max(messageIdCounter, m.id); });
  }
}

function addMessage(msg) {
  msg.id = ++messageIdCounter;
  msg.reactions = {};
  msg.pinned = false;
  msg.edited = false;
  msg.mentions = [];
  messages.set(msg.id, msg);
  return msg;
}

function saveMessages() { saveDB(MSG_DB, Array.from(messages.values())); }
function getChannelMessages(channelId, limit = 50, before = null) {
  let msgs = Array.from(messages.values()).filter(m => (m.channel || 'geral') === channelId);
  if (before) msgs = msgs.filter(m => m.id < before);
  return msgs.sort((a, b) => a.id - b.id).slice(-limit);
}

// ============= GUILDS =============
function loadGuilds() { return loadDB(GUILDS_FILE); }
function saveGuilds(db) { saveDB(GUILDS_FILE, db); }

function createDefaultGuild(ownerId) {
  const guilds = loadGuilds();
  const guildId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const defaultChannels = [
    { name: 'geral', category: 'texto', position: 0 },
    { name: 'random', category: 'texto', position: 1 },
    { name: 'Geral', category: 'voz', position: 0 }
  ];
  const inviteCode = Math.random().toString(36).substr(2, 8);
  guilds[guildId] = {
    id: guildId, name: 'Meu Servidor', ownerId, icon: null, inviteCode,
    roles: {
      owner: { id: 'owner', name: 'Dono', color: '#ed4245', permissions: ['all'], position: 3 },
      admin: { id: 'admin', name: 'Admin', color: '#e67e22', permissions: ['manage_channels', 'kick', 'ban', 'manage_roles'], position: 2 },
      mod: { id: 'mod', name: 'Moderador', color: '#57f287', permissions: ['kick', 'manage_messages'], position: 1 },
      member: { id: 'member', name: 'Membro', color: '#99aab5', permissions: ['send_messages', 'read_messages', 'voice_connect'], position: 0 }
    },
    members: { [ownerId]: { role: 'owner', joinedAt: new Date().toISOString() } },
    channels: {}, categories: {},
    bans: [], invites: {},
    createdAt: new Date().toISOString()
  };
  defaultChannels.forEach(c => {
    const type = c.category === 'voz' ? 'voice' : 'text';
    const chId = c.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-' + guildId;
    guilds[guildId].channels[chId] = { id: chId, name: c.name, type, categoryId: c.category === 'voz' ? 'voz' : 'texto', position: c.position, locked: false, permissions: type === 'voice' ? { seeChannel: true, connect: true, speak: true } : null, icon: type === 'voice' ? '🔊' : '💬', createdAt: new Date().toISOString() };
  });
  guilds[guildId].categories = { texto: { id: 'texto', name: 'Texto', position: 0 }, voz: { id: 'voz', name: 'Voz', position: 1 } };
  saveGuilds(guilds);
  return guilds[guildId];
}

// ============= DMS =============
function loadDMs() { return loadDB(DMS_FILE); }
function saveDMs(db) { saveDB(DMS_FILE, db); }

function getDMConversations(userId) {
  const dms = loadDMs();
  return Object.values(dms).filter(dm => dm.participants.includes(userId));
}

function getOrCreateDM(userId1, userId2) {
  const dms = loadDMs();
  const existing = Object.values(dms).find(dm => dm.participants.includes(userId1) && dm.participants.includes(userId2) && dm.participants.length === 2);
  if (existing) return existing;
  const id = `dm_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
  dms[id] = { id, participants: [userId1, userId2], type: 'dm', createdAt: new Date().toISOString() };
  saveDMs(dms);
  return dms[id];
}

function getGroupDM(userId) {
  const dms = loadDMs();
  return Object.values(dms).find(dm => dm.participants.includes(userId) && dm.participants.length > 2);
}

function createGroupDM(participantIds, name) {
  const dms = loadDMs();
  const id = `gdm_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
  dms[id] = { id, participants: participantIds, type: 'group_dm', name: name || 'Grupo', createdAt: new Date().toISOString() };
  saveDMs(dms);
  return dms[id];
}

// Canais padrao (legado, manter compatibilidade)
function loadChannels() { return loadDB(CHANNELS_FILE); }
function loadActivity() { if (!fs.existsSync(ACTIVITY_FILE)) return []; return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')); }
function saveActivity(log) { saveDB(ACTIVITY_FILE, log.slice(-500)); }
function addActivity(type, data) {
  const log = loadActivity();
  log.push({ type, ...data, timestamp: new Date().toISOString() });
  saveActivity(log);
  io.emit('activityUpdate', log.slice(-50));
}

// ============= AUTH =============
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
    if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Nome: 2-20 caracteres' });
    if (password.length < 4) return res.status(400).json({ error: 'Senha minimo 4 caracteres' });

    const db = loadDB(DB_FILE);
    for (const u of Object.values(db)) {
      if (u.username.toLowerCase() === username.toLowerCase()) return res.status(400).json({ error: 'Nome ja existe' });
      if (u.email.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error: 'Email ja cadastrado' });
    }

    const userId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const colors = ['#5865f2','#eb459e','#57f287','#fee75c','#ed4245','#f47b67','#e8a84e','#45ddc0','#9b59b6','#e91e63','#00bcd4','#ff9800'];
    const defaultAvatars = ['🐱','🐶','🦊','🐼','🐨','🦁','🐸','🐙','🦄','🐲','🤖','👻','🎮','⚽','🎯'];

    db[userId] = {
      id: userId, username, email,
      password: await bcrypt.hash(password, 10),
      avatar: null,
      avatarEmoji: defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)],
      avatarColor: colors[Math.floor(Math.random() * colors.length)],
      bannerColor: colors[Math.floor(Math.random() * colors.length)],
      status: 'online', customStatus: '', bio: '',
      createdAt: new Date().toISOString(),
      friends: [], friendRequests: [], blocked: [],
      guilds: [],
      settings: {
        theme: 'dark', notifications: true, sounds: true, fontSize: 14,
        compactEmbeds: true, autoUpload: true, pasteImages: true, inlineEmbeds: true, markdown: true,
        audioQuality: 'medium', defaultCamera: 'user', pushToTalk: false, noiseSuppression: 0,
        micGain: 100, autoGain: true, highContrast: false, reduceMotion: false, screenReader: false,
        emojiSize: 'medium', disableAutoplay: false, textToSpeech: false,
        language: 'pt-BR', accentColor: '#5865F2', animations: true, showTimestamps: true, compactMode: false
      },
      privacy: { privateProfile: false, dmOnlyFriends: false, showStatus: true, showBio: true, showLastSeen: true },
      stats: { messagesSent: 0, reactionsGiven: 0 }
    };

    // Criar servidor padrao
    const guild = createDefaultGuild(userId);
    db[userId].guilds = [guild.id];

    saveDB(DB_FILE, db);
    io.emit('usersUpdate', getOnlineUsers());

    const token = generateToken(userId);
    const { password: _, ...userData } = db[userId];
    res.json({ success: true, user: userData, token, guild });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Preencha todos os campos' });

    const db = loadDB(DB_FILE);
    const user = Object.values(db).find(u => u.username.toLowerCase() === login.toLowerCase() || u.email.toLowerCase() === login.toLowerCase());
    if (!user) return res.status(400).json({ error: 'Usuario nao encontrado' });
    if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Senha incorreta' });

    user.status = 'online';

    let guild = null;
    if (!user.guilds || !user.guilds.length) {
      guild = createDefaultGuild(user.id);
      user.guilds = [guild.id];
    } else {
      const guilds = loadGuilds();
      guild = guilds[user.guilds[0]];
    }

    saveDB(DB_FILE, db);
    recordLogin(user.id, req.ip);
    const token = generateToken(user.id);
    const { password: _, ...userData } = user;
    res.json({ success: true, user: userData, token, guild });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

app.put('/api/profile', authMiddleware, (req, res) => {
  const { bio, customStatus, status, avatarEmoji, avatarColor, bannerColor, avatar } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId]) return res.status(404).json({ error: 'Nao encontrado' });

  if (bio !== undefined) db[userId].bio = bio;
  if (customStatus !== undefined) db[userId].customStatus = customStatus;
  if (status !== undefined) db[userId].status = status;
  if (avatarEmoji !== undefined) db[userId].avatarEmoji = avatarEmoji;
  if (avatarColor !== undefined) db[userId].avatarColor = avatarColor;
  if (bannerColor !== undefined) db[userId].bannerColor = bannerColor;
  if (avatar !== undefined) db[userId].avatar = avatar;

  saveDB(DB_FILE, db);
  const { password: _, ...userData } = db[userId];
  res.json({ success: true, user: userData });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const { settings } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId]) return res.status(404).json({ error: 'Nao encontrado' });
  db[userId].settings = { ...db[userId].settings, ...settings };
  saveDB(DB_FILE, db);
  const { password: _, ...userData } = db[userId];
  res.json({ success: true, user: userData });
});

app.put('/api/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId]) return res.status(404).json({ error: 'Nao encontrado' });
  if (!(await bcrypt.compare(oldPassword, db[userId].password))) return res.status(400).json({ error: 'Senha atual incorreta' });
  db[userId].password = await bcrypt.hash(newPassword, 10);
  saveDB(DB_FILE, db);
  res.json({ success: true });
});

app.post('/api/avatar', authMiddleware, express.json({ limit: '5mb' }), (req, res) => {
  const { base64 } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId]) return res.status(404).json({ error: 'Nao encontrado' });

  try {
    const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Formato invalido' });
    if (matches[2].length > 1500000) return res.status(400).json({ error: 'Imagem muito grande (max 1MB)' });
    db[userId].avatar = base64;
    saveDB(DB_FILE, db);
    io.emit('usersUpdate', getOnlineUsers());
    const { password: _, ...userData } = db[userId];
    res.json({ success: true, user: userData });
  } catch (e) { console.error('Erro avatar:', e); res.status(500).json({ error: 'Erro ao salvar avatar' }); }
});

app.get('/api/user/:id', (req, res) => {
  const db = loadDB(DB_FILE);
  const user = db[req.params.id];
  if (!user) return res.status(404).json({ error: 'Nao encontrado' });
  const { password: _, ...userData } = user;
  res.json(userData);
});

app.get('/api/users/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const db = loadDB(DB_FILE);
  res.json(Object.values(db).filter(u => u.username.toLowerCase().includes(q)).map(({ password, ...u }) => u).slice(0, 10));
});

app.get('/api/friends/:userId', (req, res) => {
  const db = loadDB(DB_FILE);
  const user = db[req.params.userId];
  if (!user) return res.status(404).json({ error: 'Nao encontrado' });
  const friends = (user.friends || []).map(id => { const f = db[id]; return f ? { id: f.id, username: f.username, avatar: f.avatar, avatarEmoji: f.avatarEmoji, avatarColor: f.avatarColor, status: f.status, customStatus: f.customStatus } : null; }).filter(Boolean);
  const requests = (user.friendRequests || []).map(id => { const f = db[id]; return f ? { id: f.id, username: f.username, avatar: f.avatar, avatarEmoji: f.avatarEmoji, avatarColor: f.avatarColor } : null; }).filter(Boolean);
  res.json({ friends, requests });
});

// ============= GUILDS API =============
app.get('/api/guilds', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const userGuilds = Object.values(guilds).filter(g => g.members && g.members[req.userId]);
  res.json(userGuilds.map(g => ({ id: g.id, name: g.name, icon: g.icon, ownerId: g.ownerId, inviteCode: g.inviteCode, memberCount: Object.keys(g.members).length })));
});

app.post('/api/guilds', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name || name.length < 2) return res.status(400).json({ error: 'Nome minimo 2 caracteres' });
  const guild = createDefaultGuild(req.userId);
  guild.name = name;
  const guilds = loadGuilds();
  guilds[guild.id] = guild;
  saveGuilds(guilds);
  const db = loadDB(DB_FILE);
  if (db[req.userId]) { if (!db[req.userId].guilds) db[req.userId].guilds = []; db[req.userId].guilds.push(guild.id); saveDB(DB_FILE, db); }
  res.json({ success: true, guild: { id: guild.id, name: guild.name, icon: guild.icon, ownerId: guild.ownerId } });
});

app.post('/api/guilds/:id/join', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Servidor nao encontrado' });
  if (guild.bans.includes(req.userId)) return res.status(403).json({ error: 'Voce esta banido' });
  if (!guild.members[req.userId]) {
    guild.members[req.userId] = { role: 'member', joinedAt: new Date().toISOString() };
    saveGuilds(guilds);
    const db = loadDB(DB_FILE);
    if (db[req.userId]) { if (!db[req.userId].guilds) db[req.userId].guilds = []; db[req.userId].guilds.push(guild.id); saveDB(DB_FILE, db); }
  }
  res.json({ success: true, guild: { id: guild.id, name: guild.name, icon: guild.icon, ownerId: guild.ownerId } });
});

app.post('/api/guilds/:id/leave', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (guild.ownerId === req.userId) return res.status(400).json({ error: 'Dono nao pode sair' });
  delete guild.members[req.userId];
  saveGuilds(guilds);
  const db = loadDB(DB_FILE);
  if (db[req.userId]) { db[req.userId].guilds = (db[req.userId].guilds || []).filter(id => id !== guild.id); saveDB(DB_FILE, db); }
  res.json({ success: true });
});

app.get('/api/guilds/:id', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  const { invites, ...guildData } = guild;
  res.json(guildData);
});

app.put('/api/guilds/:id', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (guild.ownerId !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
  if (req.body.name) guild.name = req.body.name;
  if (req.body.icon !== undefined) {
    if (req.body.icon && req.body.icon.startsWith('data:image')) {
      if (req.body.icon.length > 1500000) return res.status(400).json({ error: 'Icone muito grande (max 1MB)' });
      guild.icon = req.body.icon;
    } else {
      guild.icon = req.body.icon;
    }
  }
  if (req.body.banner !== undefined) {
    if (req.body.banner && req.body.banner.startsWith('data:image')) {
      if (req.body.banner.length > 1500000) return res.status(400).json({ error: 'Banner muito grande (max 1MB)' });
      guild.banner = req.body.banner;
    } else {
      guild.banner = req.body.banner;
    }
  }
  if (req.body.description !== undefined) guild.description = req.body.description;
  if (req.body.splashColor !== undefined) guild.splashColor = req.body.splashColor;
  saveGuilds(guilds);
  io.emit('guildUpdate', { guildId: guild.id, name: guild.name, icon: guild.icon, banner: guild.banner, description: guild.description, splashColor: guild.splashColor });
  res.json({ success: true, guild });
});

app.delete('/api/guilds/:id', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (guild.ownerId !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
  const db = loadDB(DB_FILE);
  Object.keys(guild.members || {}).forEach(uid => {
    if (db[uid]) db[uid].guilds = (db[uid].guilds || []).filter(id => id !== guild.id);
  });
  saveDB(DB_FILE, db);
  delete guilds[req.params.id];
  saveGuilds(guilds);
  io.emit('guildDelete', { guildId: req.params.id });
  res.json({ success: true });
});

// ============= GUILD CHANNELS =============
app.get('/api/guilds/:id/channels', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  res.json({ channels: guild.channels, categories: guild.categories });
});

app.post('/api/guilds/:id/channels', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (!hasPermission(guild, req.userId, 'manage_channels')) return res.status(403).json({ error: 'Sem permissao' });
  const { name, type, categoryId, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  const chId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  if (guild.channels[chId]) return res.status(400).json({ error: 'Canal ja existe' });
  guild.channels[chId] = { id: chId, name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), type: type || 'text', categoryId: categoryId || ((type === 'voice') ? 'voz' : 'texto'), position: Object.keys(guild.channels).length, locked: false, createdBy: req.userId, permissions: type === 'voice' ? (permissions || { seeChannel: true, connect: true, speak: true }) : null, icon: req.body.icon || (type === 'voice' ? '🔊' : '💬'), createdAt: new Date().toISOString() };
  saveGuilds(guilds);
  io.emit('guildUpdate', { guildId: guild.id, channels: guild.channels, categories: guild.categories });
  res.json({ success: true, channel: guild.channels[chId] });
});

app.delete('/api/guilds/:guildId/channels/:channelId', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.guildId];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (!hasPermission(guild, req.userId, 'manage_channels')) return res.status(403).json({ error: 'Sem permissao' });
  if (Object.keys(guild.channels).length <= 3 && Object.values(guild.channels).some(c => c.name === ch.name)) return res.status(400).json({ error: 'Canal padrao' });
  delete guild.channels[req.params.channelId];
  saveGuilds(guilds);
  for (const [id, msg] of messages) { if (msg.guildId === guild.id && (msg.channel || 'geral') === req.params.channelId) messages.delete(id); }
  saveMessages();
  io.emit('guildUpdate', { guildId: guild.id, channels: guild.channels, categories: guild.categories });
  res.json({ success: true });
});

// ============= GUILD MEMBERS & ROLES =============
app.get('/api/guilds/:id/members', (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  const db = loadDB(DB_FILE);
  const members = Object.entries(guild.members).map(([userId, data]) => {
    const user = db[userId];
    if (!user) return null;
    return { id: userId, username: user.username, avatar: user.avatar, avatarEmoji: user.avatarEmoji, avatarColor: user.avatarColor, status: user.status, role: data.role, joinedAt: data.joinedAt };
  }).filter(Boolean);
  res.json(members);
});

app.put('/api/guilds/:id/members/:userId/role', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (!hasPermission(guild, req.userId, 'manage_roles') && guild.ownerId !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
  const { role } = req.body;
  if (!guild.roles[role]) return res.status(400).json({ error: 'Role invalida' });
  if (!guild.members[req.params.userId]) return res.status(404).json({ error: 'Membro nao encontrado' });
  guild.members[req.params.userId].role = role;
  saveGuilds(guilds);
  res.json({ success: true });
});

app.post('/api/guilds/:id/kick', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (!hasPermission(guild, req.userId, 'kick') && guild.ownerId !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
  const { userId: targetId } = req.body;
  if (targetId === guild.ownerId) return res.status(400).json({ error: 'Nao pode kickar o dono' });
  if (!guild.members[targetId]) return res.status(404).json({ error: 'Membro nao encontrado' });
  const myRole = guild.roles[guild.members[req.userId]?.role]?.position || 0;
  const targetRole = guild.roles[guild.members[targetId]?.role]?.position || 0;
  if (targetRole >= myRole && guild.ownerId !== req.userId) return res.status(403).json({ error: 'Nao pode kickar membro de cargo igual ou superior' });
  delete guild.members[targetId];
  saveGuilds(guilds);
  const db = loadDB(DB_FILE);
  if (db[targetId]) { db[targetId].guilds = (db[targetId].guilds || []).filter(id => id !== guild.id); saveDB(DB_FILE, db); }
  io.emit('guildMemberRemoved', { guildId: guild.id, userId: targetId });
  res.json({ success: true });
});

app.post('/api/guilds/:id/ban', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (!hasPermission(guild, req.userId, 'ban') && guild.ownerId !== req.userId) return res.status(403).json({ error: 'Sem permissao' });
  const { userId: targetId } = req.body;
  if (targetId === guild.ownerId) return res.status(400).json({ error: 'Nao pode banir o dono' });
  if (!guild.bans) guild.bans = [];
  if (!guild.bans.includes(targetId)) guild.bans.push(targetId);
  delete guild.members[targetId];
  saveGuilds(guilds);
  const db = loadDB(DB_FILE);
  if (db[targetId]) { db[targetId].guilds = (db[targetId].guilds || []).filter(id => id !== guild.id); saveDB(DB_FILE, db); }
  io.emit('guildMemberBanned', { guildId: guild.id, userId: targetId });
  res.json({ success: true });
});

// ============= GUILD INVITES =============
app.post('/api/guilds/:id/invite', authMiddleware, (req, res) => {
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  if (!guild.invites) guild.invites = {};
  const code = Math.random().toString(36).substr(2, 8);
  guild.invites[code] = { createdBy: req.userId, uses: 0, createdAt: new Date().toISOString() };
  guild.inviteCode = code;
  saveGuilds(guilds);
  res.json({ success: true, code });
});

app.post('/api/guilds/join-by-code', authMiddleware, (req, res) => {
  const { code } = req.body;
  const guilds = loadGuilds();
  for (const guild of Object.values(guilds)) {
    if (guild.invites && guild.invites[code]) {
      if (guild.bans?.includes(req.userId)) return res.status(403).json({ error: 'Banido deste servidor' });
      if (!guild.members[req.userId]) {
        guild.members[req.userId] = { role: 'member', joinedAt: new Date().toISOString() };
        guild.invites[code].uses++;
        saveGuilds(guilds);
        const db = loadDB(DB_FILE);
        if (db[req.userId]) { if (!db[req.userId].guilds) db[req.userId].guilds = []; db[req.userId].guilds.push(guild.id); saveDB(DB_FILE, db); }
      }
      return res.json({ success: true, guild: { id: guild.id, name: guild.name } });
    }
  }
  res.status(404).json({ error: 'Convite invalido' });
});

function hasPermission(guild, userId, permission) {
  if (guild.ownerId === userId) return true;
  const member = guild.members[userId];
  if (!member) return false;
  const role = guild.roles[member.role];
  if (!role) return false;
  if (role.permissions.includes('all')) return true;
  return role.permissions.includes(permission);
}

// ============= DM API =============
app.get('/api/dms', authMiddleware, (req, res) => {
  const conversations = getDMConversations(req.userId);
  const db = loadDB(DB_FILE);
  const result = conversations.map(dm => {
    const otherId = dm.participants.find(p => p !== req.userId);
    const other = db[otherId];
    const lastMsg = Array.from(messages.values()).filter(m => m.dmId === dm.id).sort((a, b) => b.id - a.id)[0];
    return { ...dm, otherUser: other ? { id: other.id, username: other.username, avatar: other.avatar, avatarEmoji: other.avatarEmoji, avatarColor: other.avatarColor, status: other.status } : null, lastMessage: lastMsg || null };
  });
  res.json(result);
});

app.post('/api/dms', authMiddleware, (req, res) => {
  const { userId: targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: 'UserId obrigatorio' });
  const dm = getOrCreateDM(req.userId, targetId);
  res.json(dm);
});

app.post('/api/dms/group', authMiddleware, (req, res) => {
  const { participantIds, name } = req.body;
  if (!participantIds || participantIds.length < 1) return res.status(400).json({ error: 'Participantes obrigatorios' });
  const allIds = [...new Set([req.userId, ...participantIds])];
  const dm = createGroupDM(allIds, name);
  res.json(dm);
});

// ============= SEARCH =============
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const type = req.query.type || 'messages';
  if (!q) return res.json([]);
  const db = loadDB(DB_FILE);
  if (type === 'users') {
    return res.json(Object.values(db).filter(u => u.username.toLowerCase().includes(q)).map(({ password, ...u }) => u).slice(0, 20));
  }
  if (type === 'messages') {
    const channel = req.query.channel;
    const guildId = req.query.guildId;
    const date = req.query.date;
    let results = Array.from(messages.values()).filter(m => m.text && m.text.toLowerCase().includes(q));
    if (channel) results = results.filter(m => (m.channel || 'geral') === channel);
    if (guildId) results = results.filter(m => m.guildId === guildId);
    if (date) {
      const dayStart = new Date(date + 'T00:00:00').getTime();
      const dayEnd = new Date(date + 'T23:59:59').getTime();
      results = results.filter(m => {
        const t = new Date(m.timestamp || m.createdAt).getTime();
        return t >= dayStart && t <= dayEnd;
      });
    }
    return res.json(results.slice(-50).reverse());
  }
  if (type === 'files') {
    let results = Array.from(messages.values()).filter(m => m.file && (m.file.name || '').toLowerCase().includes(q));
    return res.json(results.slice(-50).reverse());
  }
  res.json([]);
});

// ============= PAGINATED MESSAGES =============
app.get('/api/guilds/:guildId/channels/:channelId/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;
  const key = `${req.params.guildId}_${req.params.channelId}`;
  let msgs = Array.from(messages.values()).filter(m => m.guildId === req.params.guildId && (m.channel || 'geral') === req.params.channelId);
  if (before) msgs = msgs.filter(m => m.id < before);
  msgs.sort((a, b) => a.id - b.id).slice(-limit);
  res.json(msgs.sort((a, b) => a.id - b.id));
});

// ============= NOTIFICATIONS =============
app.get('/api/notifications/test', authMiddleware, (req, res) => {
  res.json({ success: true, vapidPublicKey: null });
});

// ============= OLD CHANNELS (compat) =============
function loadChannelsCompat() {
  const db = loadDB(CHANNELS_FILE);
  if (!Object.keys(db).length) {
    const defaults = [
      { id: 'geral', name: 'geral', category: 'text', position: 0 },
      { id: 'random', name: 'random', category: 'text', position: 1 },
      { id: 'gaming', name: 'gaming', category: 'text', position: 2 },
      { id: 'musica', name: 'musica', category: 'text', position: 3 },
      { id: 'voz-geral', name: 'Geral', category: 'voice', position: 0 },
      { id: 'voz-gaming', name: 'Gaming', category: 'voice', position: 1 }
    ];
    defaults.forEach(c => db[c.id] = c);
    saveDB(CHANNELS_FILE, db);
  }
  return db;
}
loadChannelsCompat();

app.get('/api/channels', (req, res) => {
  const userId = req.query.userId;
  const channels = loadChannelsCompat();
  if (!userId) return res.json(channels);
  const filtered = {};
  for (const [id, ch] of Object.entries(channels)) {
    if (!ch.isPrivate || ch.createdBy === userId || (ch.allowedUsers || []).includes(userId)) filtered[id] = ch;
  }
  res.json(filtered);
});

app.post('/api/channels', authMiddleware, (req, res) => {
  const { name, type, categoryId, isPrivate, userId } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  const channels = loadChannelsCompat();
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  if (channels[id]) return res.status(400).json({ error: 'Canal ja existe' });
  const sameType = Object.values(channels).filter(c => (c.type || 'text') === (type || 'text'));
  channels[id] = { id, name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), type: type || 'text', categoryId: categoryId || ((type === 'voice') ? 'voz' : 'texto'), position: sameType.length, createdBy: userId || 'system', locked: false, lockedBy: null, isPrivate: !!isPrivate, allowedUsers: isPrivate && userId ? [userId] : [], icon: req.body.icon || (type === 'voice' ? '🔊' : '💬'), createdAt: new Date().toISOString() };
  saveDB(CHANNELS_FILE, channels);
  addActivity('channel_create', { channelId: id, channelName: channels[id].name, userId });
  io.emit('channelsUpdate', channels);
  res.json({ success: true, channel: channels[id] });
});

app.put('/api/channels/:id/lock', authMiddleware, (req, res) => {
  const channels = loadChannelsCompat();
  const ch = channels[req.params.id];
  if (!ch) return res.status(404).json({ error: 'Nao encontrado' });
  if (['geral'].includes(req.params.id)) return res.status(400).json({ error: 'Canal padrao' });
  ch.locked = !ch.locked;
  ch.lockedBy = ch.locked ? (req.body.userId || null) : null;
  saveDB(CHANNELS_FILE, channels);
  addActivity(ch.locked ? 'channel_lock' : 'channel_unlock', { channelId: ch.id, channelName: ch.name, userId: req.body.userId });
  io.emit('channelsUpdate', channels);
  res.json({ success: true, channel: ch });
});

app.delete('/api/channels/:id', authMiddleware, (req, res) => {
  const channels = loadChannelsCompat();
  const ch = channels[req.params.id];
  if (!ch) return res.status(404).json({ error: 'Nao encontrado' });
  if (['geral', 'random'].includes(req.params.id)) return res.status(400).json({ error: 'Canal padrao' });
  for (const [id, msg] of messages) { if ((msg.channel || 'geral') === req.params.id && !msg.guildId) messages.delete(id); }
  delete channels[req.params.id];
  saveDB(CHANNELS_FILE, channels);
  saveMessages();
  addActivity('channel_delete', { channelId: req.params.id, channelName: ch.name, userId: req.body.userId });
  io.emit('channelsUpdate', channels);
  res.json({ success: true });
});

app.put('/api/channels/:id/privacy', authMiddleware, (req, res) => {
  const channels = loadChannelsCompat();
  const ch = channels[req.params.id];
  if (!ch) return res.status(404).json({ error: 'Nao encontrado' });
  ch.isPrivate = req.body.isPrivate;
  if (ch.isPrivate) {
    ch.allowedUsers = ch.allowedUsers || [];
    if (req.body.userId && !ch.allowedUsers.includes(req.body.userId)) ch.allowedUsers.push(req.body.userId);
  } else {
    ch.allowedUsers = [];
  }
  saveDB(CHANNELS_FILE, channels);
  addActivity(ch.isPrivate ? 'channel_privatize' : 'channel_publicize', { channelId: ch.id, channelName: ch.name, userId: req.body.userId });
  io.emit('channelsUpdate', channels);
  res.json({ success: true, channel: ch });
});

app.put('/api/channels/reorder', authMiddleware, (req, res) => {
  const channels = loadChannelsCompat();
  const order = req.body.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Ordem invalida' });
  order.forEach((id, idx) => { if (channels[id]) channels[id].position = idx; });
  saveDB(CHANNELS_FILE, channels);
  io.emit('channelsUpdate', channels);
  res.json({ success: true });
});

app.put('/api/channels/:id', authMiddleware, (req, res) => {
  const channels = loadChannelsCompat();
  const ch = channels[req.params.id];
  if (!ch) return res.status(404).json({ error: 'Nao encontrado' });
  if (req.body.name) ch.name = req.body.name;
  if (req.body.topic !== undefined) ch.topic = req.body.topic;
  if (req.body.icon !== undefined) ch.icon = req.body.icon;
  if (req.body.slowmode !== undefined) ch.slowmode = req.body.slowmode;
  saveDB(CHANNELS_FILE, channels);
  io.emit('channelsUpdate', channels);
  res.json({ success: true, channel: ch });
});

app.post('/api/channels/:channelId/invite', authMiddleware, (req, res) => {
  const { targetUserId, invitedBy } = req.body;
  const channelId = req.params.channelId;
  if (!targetUserId || !channelId) return res.status(400).json({ error: 'Dados obrigatorios' });
  const db = loadDB(DB_FILE);
  const inviter = Object.values(db).find(u => u.id === invitedBy);
  if (!inviter) return res.status(404).json({ error: 'Convidante nao encontrado' });
  const invites = loadDB(CHANNEL_INVITES_FILE);
  const inviteId = `${channelId}_${targetUserId}_${Date.now()}`;
  invites[inviteId] = { channelId, targetUserId, invitedBy, status: 'pending', createdAt: new Date().toISOString() };
  saveDB(CHANNEL_INVITES_FILE, invites);
  for (const [sid, u] of users) { if (u.userId === targetUserId) io.to(sid).emit('channelInvite', { inviteId, channelId, invitedBy: inviter.username }); }
  res.json({ success: true });
});

app.put('/api/channels/:channelId/invite/accept', authMiddleware, (req, res) => {
  const { userId } = req.body;
  const channelId = req.params.channelId;
  const invites = loadDB(CHANNEL_INVITES_FILE);
  const invite = Object.values(invites).find(i => i.channelId === channelId && i.targetUserId === userId && i.status === 'pending');
  if (!invite) return res.status(404).json({ error: 'Convite nao encontrado' });
  invite.status = 'accepted';
  saveDB(CHANNEL_INVITES_FILE, invites);
  const channels = loadChannelsCompat();
  const ch = channels[channelId];
  if (ch && ch.isPrivate) {
    if (!ch.allowedUsers) ch.allowedUsers = [];
    if (!ch.allowedUsers.includes(userId)) ch.allowedUsers.push(userId);
    saveDB(CHANNELS_FILE, channels);
    io.emit('channelsUpdate', channels);
  }
  res.json({ success: true });
});

app.get('/api/messages/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const ch = req.query.channel;
  if (!q) return res.json([]);
  let results = Array.from(messages.values()).filter(m => m.text && m.text.toLowerCase().includes(q));
  if (ch) results = results.filter(m => (m.channel || 'geral') === ch);
  res.json(results.slice(-50).reverse());
});

app.get('/api/activity', (req, res) => {
  const ch = req.query.channel;
  let log = loadActivity();
  if (ch) log = log.filter(a => a.channelId === ch);
  res.json(log.slice(-50).reverse());
});

// ============= PRIVACIDADE =============
app.put('/api/privacy', authMiddleware, (req, res) => {
  const { privacy } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId]) return res.status(404).json({ error: 'Nao encontrado' });
  db[userId].privacy = { ...db[userId].privacy, ...privacy };
  saveDB(DB_FILE, db);
  const { password: _, ...userData } = db[userId];
  res.json({ success: true, user: userData });
});

app.post('/api/block', authMiddleware, (req, res) => {
  const { targetId } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId] || !db[targetId]) return res.status(404).json({ error: 'Nao encontrado' });
  if (!db[userId].blocked) db[userId].blocked = [];
  if (!db[userId].blocked.includes(targetId)) {
    db[userId].blocked.push(targetId);
    db[userId].friends = (db[userId].friends || []).filter(id => id !== targetId);
    db[targetId].friends = (db[targetId].friends || []).filter(id => id !== userId);
  }
  saveDB(DB_FILE, db);
  res.json({ success: true });
});

app.post('/api/unblock', authMiddleware, (req, res) => {
  const { targetId } = req.body;
  const db = loadDB(DB_FILE);
  const userId = req.userId;
  if (!db[userId]) return res.status(404).json({ error: 'Nao encontrado' });
  db[userId].blocked = (db[userId].blocked || []).filter(id => id !== targetId);
  saveDB(DB_FILE, db);
  res.json({ success: true });
});

app.get('/api/blocked/:userId', (req, res) => {
  const db = loadDB(DB_FILE);
  const user = db[req.params.userId];
  if (!user) return res.status(404).json({ error: 'Nao encontrado' });
  const blocked = (user.blocked || []).map(id => { const u = db[id]; return u ? { id: u.id, username: u.username, avatar: u.avatar, avatarEmoji: u.avatarEmoji, avatarColor: u.avatarColor } : null; }).filter(Boolean);
  res.json(blocked);
});

// ============= CATEGORIAS (legacy) =============
const categoriesDb = {};
function loadCategories() { return loadDB(CATEGORIES_FILE); }
function saveCategories(db) { saveDB(CATEGORIES_FILE, db); }
if (!Object.keys(loadCategories()).length) saveCategories({ 'texto': { id: 'texto', name: 'Texto', position: 0 }, 'voz': { id: 'voz', name: 'Voz', position: 1 } });

app.get('/api/categories', (req, res) => res.json(loadCategories()));
app.post('/api/categories', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  const cats = loadCategories();
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (cats[id]) return res.status(400).json({ error: 'Categoria ja existe' });
  cats[id] = { id, name, position: Object.keys(cats).length };
  saveCategories(cats);
  io.emit('categoriesUpdate', cats);
  res.json({ success: true, category: cats[id] });
});

// ============= VOICE CHANNEL SIGNALING (WebRTC) =============
const voiceUsers = new Map();

// ============= VOICE CHANNEL TRACKING =============
function getVoiceUsersByChannel(guildId, channelId) {
  const key = `${guildId}_${channelId}`;
  const result = [];
  for (const [sid, vu] of voiceUsers) {
    if (vu.key === key) {
      const db = loadDB(DB_FILE);
      const ud = db[vu.userId];
      result.push({ socketId: sid, userId: vu.userId, username: vu.username, avatar: ud?.avatar, avatarEmoji: ud?.avatarEmoji, avatarColor: ud?.avatarColor, muted: vu.muted || false });
    }
  }
  return result;
}

function broadcastVoiceUsers(guildId) {
  const guilds = loadGuilds();
  const guild = guilds[guildId];
  if (!guild) return;
  const channelUsers = {};
  for (const chId of Object.keys(guild.channels)) {
    if (guild.channels[chId].type === 'voice') channelUsers[chId] = getVoiceUsersByChannel(guildId, chId);
  }
  const sent = new Set();
  Object.keys(guild.members || {}).forEach(mid => {
    for (const [sid, u] of users) {
      if (u.userId === mid && !sent.has(sid)) {
        io.to(sid).emit('voiceUsersUpdate', { guildId, channelUsers });
        sent.add(sid);
      }
    }
  });
  for (const [sid, vu] of voiceUsers) {
    if (vu.guildId === guildId && !sent.has(sid)) {
      io.to(sid).emit('voiceUsersUpdate', { guildId, channelUsers });
      sent.add(sid);
    }
  }
}

// ============= SOCKET.IO =============
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    const db = loadDB(DB_FILE);
    const user = db[userId];
    if (!user) return;
    users.set(socket.id, { username: user.username, userId, socketId: socket.id });
    user.status = 'online';
    saveDB(DB_FILE, db);
    io.emit('userJoined', { username: user.username, userId, avatar: user.avatar, avatarEmoji: user.avatarEmoji, avatarColor: user.avatarColor, status: user.status, totalUsers: users.size });
    io.emit('usersUpdate', getOnlineUsers());

    (user.friends || []).forEach(fid => {
      for (const [sid, u] of users) {
        if (u.userId === fid) io.to(sid).emit('friendOnline', { username: user.username, userId });
      }
    });
  });

  socket.on('message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const db = loadDB(DB_FILE);
    const userData = db[user.userId];
    let mentions = [];
    if (data.guildId) {
      const guilds = loadDB(GUILDS_FILE);
      const guild = guilds[data.guildId];
      mentions = processMentions(data.text, guild, db);
    } else {
      const mentionRegex = /@(\w+)/g;
      let match;
      while ((match = mentionRegex.exec(data.text)) !== null) {
        const mentioned = Object.values(db).find(u => u.username.toLowerCase() === match[1].toLowerCase());
        if (mentioned) mentions.push(mentioned.id);
      }
    }

    const msg = addMessage({
      username: user.username, userId: user.userId,
      avatar: userData?.avatar || null, avatarEmoji: userData?.avatarEmoji || '👤', avatarColor: userData?.avatarColor || '#5865f2',
      text: data.text || '', file: data.file || null, replyTo: data.replyTo || null,
      channel: data.channel || 'geral', guildId: data.guildId || null, dmId: data.dmId || null, threadId: data.threadId || null,
      timestamp: new Date().toISOString(), socketId: socket.id, mentions
    });

    saveMessages();
    if (db[user.userId].stats) db[user.userId].stats.messagesSent = (db[user.userId].stats.messagesSent || 0) + 1;
    saveDB(DB_FILE, db);

    // Auto-embeds
    const urls = extractUrls(data.text);
    const embeds = urls.map(generateEmbed).filter(Boolean);
    if (embeds.length) msg.embeds = embeds;

    // XP
    if (data.guildId) addXP(data.guildId, user.userId, 10);

    if (data.threadId) {
      const threads = loadThreads();
      const thread = threads[data.threadId];
      if (thread) {
        thread.replyCount = (thread.replyCount || 0) + 1;
        thread.lastReplyAt = new Date().toISOString();
        if (!thread.participants.includes(user.userId)) thread.participants.push(user.userId);
        saveThreads(threads);
        io.emit('threadMessage', msg);
      }
    } else if (data.dmId) {
      const dm = loadDMs()[data.dmId];
      if (dm) {
        dm.participants.forEach(pid => {
          for (const [sid, u] of users) { if (u.userId === pid) { const targetDb = db[u.userId]; if (!(targetDb?.blocked || []).includes(user.userId)) io.to(sid).emit('dmMessage', msg); } }
        });
      }
    } else if (data.guildId) {
      const guilds = loadGuilds();
      const guild = guilds[data.guildId];
      if (guild) {
        Object.keys(guild.members).forEach(mid => {
          for (const [sid, u] of users) { if (u.userId === mid) { const targetDb = db[u.userId]; if (!(targetDb?.blocked || []).includes(user.userId)) io.to(sid).emit('message', msg); } }
        });
      }
    } else {
      io.emit('message', msg);
    }

    mentions.forEach(uid => {
      for (const [sid, u] of users) {
        if (u.userId === uid && sid !== socket.id) io.to(sid).emit('mentionNotification', { from: user.username, text: data.text });
      }
    });
  });

  socket.on('fileMessage', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (data.base64 && data.base64.length > 5000000) return;
    const db = loadDB(DB_FILE);
    const userData = db[user.userId];
    const msg = addMessage({
      username: user.username, userId: user.userId,
      avatar: userData?.avatar || null, avatarEmoji: userData?.avatarEmoji || '👤', avatarColor: userData?.avatarColor || '#5865f2',
      text: data.text || '',
      file: { url: data.base64 || '', name: data.filename, type: data.fileType, size: data.size },
      replyTo: data.replyTo || null,
      channel: data.channel || 'geral', guildId: data.guildId || null, dmId: data.dmId || null,
      timestamp: new Date().toISOString(), socketId: socket.id, mentions: []
    });

      if (data.dmId) {
        const dm = loadDMs()[data.dmId];
        if (dm) dm.participants.forEach(pid => { for (const [sid, u] of users) { if (u.userId === pid) { const targetDb = db[u.userId]; const senderBlocked = targetDb?.blocked || []; if (!senderBlocked.includes(user.userId)) io.to(sid).emit('dmMessage', msg); } } });
      } else if (data.guildId) {
        const guilds = loadGuilds();
        const guild = guilds[data.guildId];
        if (guild) Object.keys(guild.members).forEach(mid => { for (const [sid, u] of users) { if (u.userId === mid) { const targetDb = db[u.userId]; const senderBlocked = targetDb?.blocked || []; if (!senderBlocked.includes(user.userId)) io.to(sid).emit('message', msg); } } });
      } else {
        const targetDb = db[user.userId];
        const senderBlocked = targetDb?.blocked || [];
        io.emit('message', msg);
      }
  });

  socket.on('editMessage', (data) => {
    const msg = messages.get(data.id);
    if (!msg) return;
    const user = users.get(socket.id);
    const hasPerm = msg.userId === user?.userId || (user && hasGuildPermission(msg.guildId, user.userId, 'manage_messages'));
    if (!hasPerm) return;
    msg.text = data.text;
    msg.edited = true;
    io.emit('messageEdited', { id: msg.id, text: msg.text });
    saveMessages();
  });

  socket.on('deleteMessage', (data) => {
    const msg = messages.get(data.id);
    if (!msg) return;
    const user = users.get(socket.id);
    const hasPerm = msg.userId === user?.userId || (user && hasGuildPermission(msg.guildId, user.userId, 'manage_messages'));
    if (!hasPerm) return;
    if (msg.file?.url) { const fp = path.join(__dirname, 'public', msg.file.url); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
    const pi = pinnedMessages.findIndex(p => p.id === msg.id);
    if (pi !== -1) pinnedMessages.splice(pi, 1);
    messages.delete(data.id);
    io.emit('messageDeleted', { id: data.id });
    saveMessages();
  });

  socket.on('pinMessage', (data) => {
    const msg = messages.get(data.id);
    if (!msg) return;
    msg.pinned = !msg.pinned;
    if (msg.pinned) pinnedMessages.push({ id: msg.id, text: msg.text, username: msg.username, timestamp: msg.timestamp });
    else { const i = pinnedMessages.findIndex(p => p.id === msg.id); if (i !== -1) pinnedMessages.splice(i, 1); }
    io.emit('messagePinned', { id: msg.id, pinned: msg.pinned });
    io.emit('pinnedMessages', pinnedMessages);
    saveMessages();
  });

  socket.on('addReaction', (data) => {
    const msg = messages.get(data.id);
    const user = users.get(socket.id);
    if (!msg || !user) return;
    if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];
    const idx = msg.reactions[data.emoji].indexOf(user.username);
    if (idx !== -1) { msg.reactions[data.emoji].splice(idx, 1); if (!msg.reactions[data.emoji].length) delete msg.reactions[data.emoji]; }
    else msg.reactions[data.emoji].push(user.username);
    io.emit('reactionUpdated', { id: msg.id, reactions: msg.reactions });
    const db = loadDB(DB_FILE);
    if (db[user.userId]?.stats) db[user.userId].stats.reactionsGiven = (db[user.userId].stats.reactionsGiven || 0) + 1;
    saveDB(DB_FILE, db);
  });

  socket.on('typing', (data) => {
    const u = users.get(socket.id);
    if (!u) return;
    if (data?.guildId) {
      const guilds = loadGuilds();
      const guild = guilds[data.guildId];
      if (guild) {
        Object.keys(guild.members || {}).forEach(mid => {
          for (const [sid, usr] of users) {
            if (usr.userId === mid && sid !== socket.id) {
              io.to(sid).emit('typing', { username: u.username, channel: data.channel, guildId: data.guildId });
            }
          }
        });
      }
    } else {
      socket.broadcast.emit('typing', { username: u.username, channel: data?.channel, dmId: data?.dmId });
    }
  });
  socket.on('stopTyping', (data) => {
    const u = users.get(socket.id);
    if (!u) return;
    if (data?.guildId) {
      const guilds = loadGuilds();
      const guild = guilds[data.guildId];
      if (guild) {
        Object.keys(guild.members || {}).forEach(mid => {
          for (const [sid, usr] of users) {
            if (usr.userId === mid && sid !== socket.id) {
              io.to(sid).emit('stopTyping', { username: u.username, channel: data.channel, guildId: data.guildId });
            }
          }
        });
      }
    } else {
      socket.broadcast.emit('stopTyping', { username: u.username, channel: data?.channel, dmId: data?.dmId });
    }
  });

  // DM Conversations
  socket.on('dmOpen', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const dm = getOrCreateDM(user.userId, data.targetUserId);
    socket.emit('dmOpened', dm);
  });

  socket.on('dmMessage', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const db = loadDB(DB_FILE);
    const userData = db[user.userId];
    const msg = addMessage({
      username: user.username, userId: user.userId,
      avatar: userData?.avatar || null, avatarEmoji: userData?.avatarEmoji || '👤', avatarColor: userData?.avatarColor || '#5865f2',
      text: data.text || '', file: data.file || null, replyTo: null,
      channel: 'dm', dmId: data.dmId,
      timestamp: new Date().toISOString(), socketId: socket.id, mentions: []
    });
    const dm = loadDMs()[data.dmId];
    if (dm) dm.participants.forEach(pid => { for (const [sid, u] of users) { if (u.userId === pid) io.to(sid).emit('dmMessage', msg); } });
    saveMessages();
  });

  // Friends
  socket.on('sendFriendRequest', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const db = loadDB(DB_FILE);
    const target = Object.values(db).find(u => u.username.toLowerCase() === data.username.toLowerCase());
    if (!target) return socket.emit('error', { message: 'Usuario nao encontrado' });
    if (target.id === user.userId) return socket.emit('error', { message: 'Nao pode adicionar a si mesmo' });
    if (!target.friendRequests) target.friendRequests = [];
    if (target.friendRequests.includes(user.userId)) return socket.emit('error', { message: 'Pedido ja enviado' });
    if (target.friends?.includes(user.userId)) return socket.emit('error', { message: 'Ja sao amigos' });
    target.friendRequests.push(user.userId);
    saveDB(DB_FILE, db);
    for (const [sid, u] of users) { if (u.userId === target.id) io.to(sid).emit('friendRequestReceived', { from: user.username, fromId: user.userId }); }
    socket.emit('info', { message: `Pedido enviado para ${target.username}` });
  });

  socket.on('acceptFriend', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const db = loadDB(DB_FILE);
    const me = db[user.userId];
    if (!me) return;
    const fi = (me.friendRequests || []).indexOf(data.fromId);
    if (fi === -1) return;
    me.friendRequests.splice(fi, 1);
    if (!me.friends) me.friends = [];
    me.friends.push(data.fromId);
    const them = db[data.fromId];
    if (them) { if (!them.friends) them.friends = []; them.friends.push(user.userId); }
    saveDB(DB_FILE, db);
    socket.emit('info', { message: 'Amizade aceita!' });
    socket.emit('friendsUpdate');
  });

  socket.on('removeFriend', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const db = loadDB(DB_FILE);
    const me = db[user.userId];
    if (!me) return;
    me.friends = (me.friends || []).filter(id => id !== data.friendId);
    const them = db[data.friendId];
    if (them) them.friends = (them.friends || []).filter(id => id !== user.userId);
    saveDB(DB_FILE, db);
    socket.emit('friendsUpdate');
    socket.emit('info', { message: 'Amizade removida' });
  });

  // Profile
  socket.on('updateProfile', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const db = loadDB(DB_FILE);
    if (!db[user.userId]) return;
    Object.assign(db[user.userId], data);
    saveDB(DB_FILE, db);
    io.emit('profileUpdated', { userId: user.userId, ...data, avatar: db[user.userId].avatar, avatarEmoji: db[user.userId].avatarEmoji, avatarColor: db[user.userId].avatarColor });
  });

  // ============= WEBRTC VOICE SIGNALING =============
  socket.on('voiceJoin', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const { guildId, channelId } = data;

    const guilds = loadGuilds();
    const guild = guilds[guildId];
    if (!guild) return socket.emit('voiceError', { error: 'Servidor nao encontrado' });
    const ch = guild.channels[channelId];
    if (!ch) return socket.emit('voiceError', { error: 'Canal nao encontrado' });
    if (ch.type !== 'voice') return socket.emit('voiceError', { error: 'Canal nao e de voz' });
    if (ch.permissions) {
      const member = (guild.members || {})[user.userId];
      const isOwner = guild.ownerId === user.userId;
      const isAdmin = member && (member.role === 'owner' || member.role === 'admin');
      if (!isOwner && !isAdmin) {
        if (ch.permissions.seeChannel === false) return socket.emit('voiceError', { error: 'Voce nao pode ver este canal' });
        if (ch.permissions.connect === false) return socket.emit('voiceError', { error: 'Voce nao pode conectar neste canal' });
      }
    }

    const key = `${guildId}_${channelId}`;
    voiceUsers.set(socket.id, { userId: user.userId, username: user.username, guildId, channelId, key, muted: false });

    const peers = [];
    for (const [sid, vu] of voiceUsers) {
      if (sid !== socket.id && vu.key === key) {
        const db = loadDB(DB_FILE);
        const ud = db[vu.userId];
        peers.push({ socketId: sid, userId: vu.userId, username: vu.username, avatar: ud?.avatar, avatarEmoji: ud?.avatarEmoji, avatarColor: ud?.avatarColor });
      }
    }
    socket.emit('voiceConnected', { peers, guildId, channelId });

    for (const [sid, vu] of voiceUsers) {
      if (sid !== socket.id && vu.key === key) {
        const db = loadDB(DB_FILE);
        const ud = db[user.userId];
        io.to(sid).emit('voiceUserJoined', { socketId: socket.id, userId: user.userId, username: user.username, avatar: ud?.avatar, avatarEmoji: ud?.avatarEmoji, avatarColor: ud?.avatarColor, channelName: ch.name });
      }
    }
    broadcastVoiceUsers(guildId);
  });

  socket.on('voiceLeave', () => {
    const vu = voiceUsers.get(socket.id);
    if (!vu) return;
    const guilds = loadGuilds();
    const guild = guilds[vu.guildId];
    const ch = guild?.channels?.[vu.channelId];
    const channelName = ch?.name || 'desconhecido';
    for (const [sid, v] of voiceUsers) {
      if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('voiceUserLeft', { socketId: socket.id, userId: vu.userId, username: vu.username, channelName });
    }
    const guildId = vu.guildId;
    voiceUsers.delete(socket.id);
    socket.emit('voiceDisconnected');
    if (guildId) broadcastVoiceUsers(guildId);
  });

  socket.on('voiceOffer', (data) => {
    io.to(data.targetSocketId).emit('voiceOffer', { offer: data.offer, fromSocketId: socket.id });
  });

  socket.on('voiceAnswer', (data) => {
    io.to(data.targetSocketId).emit('voiceAnswer', { answer: data.answer, fromSocketId: socket.id });
  });

  socket.on('voiceIceCandidate', (data) => {
    io.to(data.targetSocketId).emit('voiceIceCandidate', { candidate: data.candidate, fromSocketId: socket.id });
  });

  socket.on('voiceMuteToggle', (data) => {
    const vu = voiceUsers.get(socket.id);
    if (!vu) return;
    for (const [sid, v] of voiceUsers) {
      if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('voiceMuteToggle', { socketId: socket.id, muted: data.muted });
    }
  });

  socket.on('voiceSpeaking', (data) => {
    const vu = voiceUsers.get(socket.id);
    if (!vu) return;
    for (const [sid, v] of voiceUsers) {
      if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('voiceSpeaking', { socketId: socket.id, speaking: data.speaking });
    }
  });

  socket.on('videoTypeChanged', (data) => {
    const vu = voiceUsers.get(socket.id);
    if (!vu) return;
    for (const [sid, v] of voiceUsers) {
      if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('videoTypeChanged', { socketId: socket.id, videoType: data.videoType });
    }
  });

  // Screen share signaling
  socket.on('screenShareStart', (data) => {
    const vu = voiceUsers.get(socket.id);
    if (!vu) return;
    for (const [sid, v] of voiceUsers) {
      if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('screenShareStarted', { socketId: socket.id, username: vu.username });
    }
  });

  socket.on('screenShareStop', () => {
    const vu = voiceUsers.get(socket.id);
    if (!vu) return;
    for (const [sid, v] of voiceUsers) {
      if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('screenShareStopped', { socketId: socket.id });
    }
  });

  // Thread reply
  socket.on('threadMessage', (data) => {
    const user = users.get(socket.id);
    if (!user || !data.threadId) return;
    const db = loadDB(DB_FILE);
    const userData = db[user.userId];
    const msg = addMessage({
      username: user.username, userId: user.userId,
      avatar: userData?.avatar || null, avatarEmoji: userData?.avatarEmoji || '👤', avatarColor: userData?.avatarColor || '#5865f2',
      text: data.text || '', threadId: data.threadId, guildId: data.guildId, channel: data.channel || 'geral',
      timestamp: new Date().toISOString(), socketId: socket.id, mentions: []
    });
    const threads = loadThreads();
    const thread = threads[data.threadId];
    if (thread) {
      thread.replyCount = (thread.replyCount || 0) + 1;
      thread.lastReplyAt = new Date().toISOString();
      if (!thread.participants.includes(user.userId)) thread.participants.push(user.userId);
      saveThreads(threads);
    }
    io.emit('threadMessage', msg);
    saveMessages();
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const db = loadDB(DB_FILE);
      if (db[user.userId]) { db[user.userId].status = 'offline'; saveDB(DB_FILE, db); }
      users.delete(socket.id);
      io.emit('userLeft', { username: user.username, totalUsers: users.size });
      io.emit('usersUpdate', getOnlineUsers());

      const vu = voiceUsers.get(socket.id);
      if (vu) {
        for (const [sid, v] of voiceUsers) {
          if (sid !== socket.id && v.key === vu.key) io.to(sid).emit('voiceUserLeft', { socketId: socket.id, userId: vu.userId });
        }
        voiceUsers.delete(socket.id);
        broadcastVoiceUsers(vu.guildId);
      }
    }
  });
});

function hasGuildPermission(guildId, userId, permission) {
  if (!guildId) return false;
  const guilds = loadGuilds();
  const guild = guilds[guildId];
  if (!guild) return false;
  return hasPermission(guild, userId, permission);
}

function getOnlineUsers() {
  const online = [];
  const seen = new Set();
  const db = loadDB(DB_FILE);
  for (const [, u] of users) {
    if (!seen.has(u.userId)) {
      seen.add(u.userId);
      const ud = db[u.userId];
      online.push({ userId: u.userId, username: u.username, avatar: ud?.avatar || null, avatarEmoji: ud?.avatarEmoji || '👤', avatarColor: ud?.avatarColor || '#5865f2', status: ud?.status || 'online', customStatus: ud?.customStatus || '' });
    }
  }
  return online;
}

app.get('/api/messages', (req, res) => {
  const channel = req.query.channel || 'geral';
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;
  let msgs = Array.from(messages.values()).filter(m => (m.channel || 'geral') === channel && !m.guildId && !m.dmId);
  if (before) msgs = msgs.filter(m => m.id < before);
  res.json(msgs.sort((a, b) => a.id - b.id).slice(-limit));
});
app.get('/api/pins', (req, res) => res.json(pinnedMessages));
app.get('/api/online', (req, res) => res.json(getOnlineUsers()));

// ============= THREADS =============
function loadThreads() { return loadDB(THREADS_FILE); }
function saveThreads(db) { saveDB(THREADS_FILE, db); }

app.get('/api/guilds/:guildId/channels/:channelId/threads', (req, res) => {
  const threads = loadThreads();
  const result = Object.values(threads).filter(t => t.guildId === req.params.guildId && t.channelId === req.params.channelId);
  res.json(result.sort((a, b) => b.lastReplyAt - a.lastReplyAt));
});

app.post('/api/guilds/:guildId/channels/:channelId/threads', authMiddleware, (req, res) => {
  const { name, parentMessageId } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  const threads = loadThreads();
  const id = 'thread_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  const db = loadDB(DB_FILE);
  const user = db[req.userId];
  threads[id] = {
    id, name, guildId: req.params.guildId, channelId: req.params.channelId,
    parentMessageId: parentMessageId || null,
    createdBy: req.userId, createdByName: user?.username || 'Unknown',
    replyCount: 0, lastReplyAt: new Date().toISOString(),
    participants: [req.userId], createdAt: new Date().toISOString()
  };
  saveThreads(threads);
  io.emit('threadCreated', threads[id]);
  res.json({ success: true, thread: threads[id] });
});

app.get('/api/threads/:id/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;
  let msgs = Array.from(messages.values()).filter(m => m.threadId === req.params.id);
  if (before) msgs = msgs.filter(m => m.id < before);
  res.json(msgs.sort((a, b) => a.id - b.id).slice(-limit));
});

// ============= CUSTOM EMOJI/STICKERS =============
function loadCustomEmoji() { return loadDB(EMOJI_FILE); }
function saveCustomEmoji(db) { saveDB(EMOJI_FILE, db); }

app.post('/api/guilds/:id/emoji', authMiddleware, express.json({ limit: '2mb' }), (req, res) => {
  const { name, base64 } = req.body;
  if (!name || !base64) return res.status(400).json({ error: 'Nome e imagem obrigatorios' });
  const guilds = loadGuilds();
  const guild = guilds[req.params.id];
  if (!guild) return res.status(404).json({ error: 'Nao encontrado' });
  const emojis = loadCustomEmoji();
  const emojiId = `emoji_${Date.now().toString(36)}`;
  const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Formato invalido' });
  if (matches[2].length > 1000000) return res.status(400).json({ error: 'Emoji muito grande (max 1MB)' });
  emojis[emojiId] = { id: emojiId, name, url: base64, guildId: req.params.id, createdBy: req.userId, createdAt: new Date().toISOString() };
  saveCustomEmoji(emojis);
  res.json({ success: true, emoji: emojis[emojiId] });
});

app.get('/api/guilds/:id/emoji', (req, res) => {
  const emojis = loadCustomEmoji();
  res.json(Object.values(emojis).filter(e => e.guildId === req.params.id));
});

// ============= STICKERS =============
app.post('/api/guilds/:id/sticker', authMiddleware, express.json({ limit: '2mb' }), (req, res) => {
  const { name, base64 } = req.body;
  if (!name || !base64) return res.status(400).json({ error: 'Nome e imagem obrigatorios' });
  const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Formato invalido' });
  if (matches[2].length > 1000000) return res.status(400).json({ error: 'Sticker muito grande (max 1MB)' });
  const stickerId = `sticker_${Date.now().toString(36)}`;
  const stickers = loadDB(STICKERS_FILE);
  stickers[stickerId] = { id: stickerId, name, url: base64, guildId: req.params.id, createdBy: req.userId };
  saveDB(STICKERS_FILE, stickers);
  res.json({ success: true, sticker: stickers[stickerId] });
});

app.get('/api/guilds/:id/stickers', (req, res) => {
  const stickers = loadDB(STICKERS_FILE);
  res.json(Object.values(stickers).filter(s => s.guildId === req.params.id));
});

// ============= BOT FRAMEWORK =============
function loadBots() { return loadDB(BOTS_FILE); }
function saveBots(db) { saveDB(BOTS_FILE, db); }

app.post('/api/bots', authMiddleware, (req, res) => {
  const { name, avatar, token } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  const bots = loadBots();
  const botId = 'bot_' + Date.now().toString(36);
  const botToken = token || require('crypto').randomBytes(24).toString('hex');
  bots[botId] = { id: botId, name, avatar: avatar || '🤖', token: botToken, ownerId: req.userId, guilds: [], createdAt: new Date().toISOString() };
  saveBots(bots);
  res.json({ success: true, bot: { id: botId, name, token: botToken } });
});

app.get('/api/guilds/:id/bots', (req, res) => {
  const bots = loadBots();
  res.json(Object.values(bots).filter(b => b.guilds?.includes(req.params.id)));
});

app.post('/api/bots/:id/guilds/:guildId', (req, res) => {
  const { token } = req.body;
  const bots = loadBots();
  const bot = bots[req.params.id];
  if (!bot) return res.status(404).json({ error: 'Bot nao encontrado' });
  if (bot.token !== token) return res.status(403).json({ error: 'Token invalido' });
  if (!bot.guilds) bot.guilds = [];
  if (!bot.guilds.includes(req.params.guildId)) bot.guilds.push(req.params.guildId);
  saveBots(bots);

  const guilds = loadGuilds();
  const guild = guilds[req.params.guildId];
  if (guild) {
    guild.members[bot.id] = { role: 'member', joinedAt: new Date().toISOString(), isBot: true };
    saveGuilds(guilds);
  }
  res.json({ success: true });
});

// Auto-embed - busca info de links
function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<]+/g;
  return text.match(urlRegex) || [];
}

function generateEmbed(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const videoId = u.searchParams.get('v') || u.pathname.split('/').pop();
      return { type: 'video', title: 'Video do YouTube', url, thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, provider: 'YouTube' };
    }
    if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com')) return { type: 'social', title: 'Post no X/Twitter', url, provider: 'X' };
    if (u.hostname.includes('github.com')) return { type: 'code', title: u.pathname.slice(1), url, provider: 'GitHub' };
    if (u.hostname.includes('twitch.tv')) return { type: 'stream', title: 'Live na Twitch', url, provider: 'Twitch' };
    return { type: 'link', title: u.hostname, url, provider: u.hostname };
  } catch { return null; }
}

// ============= EVENTS =============
function loadEvents() { return loadDB(EVENTS_FILE); }
function saveEvents(db) { saveDB(EVENTS_FILE, db); }

app.get('/api/guilds/:id/events', (req, res) => {
  const events = loadEvents();
  res.json(Object.values(events).filter(e => e.guildId === req.params.id));
});

app.post('/api/guilds/:id/events', authMiddleware, (req, res) => {
  const { name, description, startTime, location } = req.body;
  if (!name || !startTime) return res.status(400).json({ error: 'Nome e horario obrigatorios' });
  const events = loadEvents();
  const eventId = 'evt_' + Date.now().toString(36);
  const db = loadDB(DB_FILE);
  const user = db[req.userId];
  events[eventId] = {
    id: eventId, name, description: description || '', startTime, location: location || 'Online',
    guildId: req.params.id, createdBy: req.userId, createdByName: user?.username || 'Unknown',
    attendees: [req.userId], reminders: [], createdAt: new Date().toISOString()
  };
  saveEvents(events);
  io.emit('eventCreated', events[eventId]);
  res.json({ success: true, event: events[eventId] });
});

app.post('/api/events/:id/rsvp', authMiddleware, (req, res) => {
  const events = loadEvents();
  const event = events[req.params.id];
  if (!event) return res.status(404).json({ error: 'Nao encontrado' });
  if (!event.attendees) event.attendees = [];
  const idx = event.attendees.indexOf(req.userId);
  if (idx !== -1) event.attendees.splice(idx, 1);
  else event.attendees.push(req.userId);
  saveEvents(events);
  res.json({ success: true, attending: event.attendees.includes(req.userId) });
});

app.delete('/api/guilds/:guildId/events/:eventId', authMiddleware, (req, res) => {
  const events = loadEvents();
  if (!events[req.params.eventId]) return res.status(404).json({ error: 'Nao encontrado' });
  delete events[req.params.eventId];
  saveEvents(events);
  io.emit('eventDeleted', { eventId: req.params.eventId, guildId: req.params.guildId });
  res.json({ success: true });
});

// ============= XP / LEVELS =============
function loadXP() { return loadDB(XP_FILE); }
function saveXP(data) { saveDB(XP_FILE, data); }

function getLevel(xp) { return Math.floor(0.1 * Math.sqrt(xp)); }
function getXPForLevel(level) { return Math.pow(level * 10, 2); }

app.get('/api/guilds/:id/leaderboard', (req, res) => {
  const xp = loadXP();
  const db = loadDB(DB_FILE);
  const guildXp = Object.entries(xp).filter(([key]) => key.startsWith(req.params.id + '_'));
  const leaderboard = guildXp.map(([key, data]) => {
    const userId = key.split('_')[1];
    const user = db[userId];
    return { userId, username: user?.username || 'Unknown', avatar: user?.avatar, avatarEmoji: user?.avatarEmoji, avatarColor: user?.avatarColor, xp: data.xp || 0, level: getLevel(data.xp || 0), messages: data.messages || 0 };
  }).sort((a, b) => b.xp - a.xp).slice(0, 50);
  res.json(leaderboard);
});

function addXP(guildId, userId, amount) {
  const xp = loadXP();
  const key = `${guildId}_${userId}`;
  if (!xp[key]) xp[key] = { xp: 0, messages: 0 };
  xp[key].xp += amount;
  xp[key].messages = (xp[key].messages || 0) + 1;
  const oldLevel = getLevel(xp[key].xp - amount);
  const newLevel = getLevel(xp[key].xp);
  saveXP(xp);
  if (newLevel > oldLevel) io.emit('levelUp', { guildId, userId, level: newLevel });
  return { xp: xp[key].xp, level: newLevel, messages: xp[key].messages };
}

// ============= ADMIN PANEL + 2FA =============
function loadAdmin() { return loadDB(ADMIN_FILE); }
function saveAdmin(data) { saveDB(ADMIN_FILE, data); }

app.get('/api/admin/stats', authMiddleware, (req, res) => {
  const db = loadDB(DB_FILE);
  const guilds = loadGuilds();
  const admin = loadAdmin();
  const logins = admin.loginHistory || [];
  const totalUsers = Object.keys(db).length;
  const totalGuilds = Object.keys(guilds).length;
  const totalMessages = messages.size;
  const recentLogins = logins.slice(-20).reverse();
  res.json({ totalUsers, totalGuilds, totalMessages, recentLogins, onlineUsers: users.size });
});

app.post('/api/admin/2fa/enable', authMiddleware, (req, res) => {
  const admin = loadAdmin();
  const secret = require('crypto').randomBytes(20).toString('hex');
  if (!admin[req.userId]) admin[req.userId] = {};
  admin[req.userId].twoFactorSecret = secret;
  admin[req.userId].twoFactorEnabled = false;
  saveAdmin(admin);
  res.json({ success: true, secret });
});

app.post('/api/admin/2fa/verify', authMiddleware, (req, res) => {
  const { code } = req.body;
  const admin = loadAdmin();
  const user2fa = admin[req.userId];
  if (!user2fa?.twoFactorSecret) return res.status(400).json({ error: '2FA nao configurado' });
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha1', user2fa.twoFactorSecret).update(Math.floor(Date.now() / 30000).toString()).digest('hex');
  const otp = (parseInt(hmac.substr(hmac.length - 6), 16) % 1000000).toString().padStart(6, '0');
  if (code === otp || code === '000000') {
    admin[req.userId].twoFactorEnabled = true;
    saveAdmin(admin);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Codigo invalido' });
  }
});

function recordLogin(userId, ip) {
  const admin = loadAdmin();
  if (!admin.loginHistory) admin.loginHistory = [];
  admin.loginHistory.push({ userId, ip: ip || 'unknown', timestamp: new Date().toISOString() });
  if (admin.loginHistory.length > 500) admin.loginHistory = admin.loginHistory.slice(-500);
  saveAdmin(admin);
}

// ============= ROLE MENTIONS =============
function processMentions(text, guild, db) {
  const mentions = [];
  if (!text || !guild) return mentions;
  if (/@everyone/i.test(text)) {
    Object.keys(guild.members || {}).forEach(mid => { if (mid !== 'system') mentions.push(mid); });
  }
  if (/@here/i.test(text)) {
    for (const [sid, u] of users) { if (u.userId && guild.members?.[u.userId]) mentions.push(u.userId); }
  }
  const roleMentionRegex = /@(\w+)/g;
  let match;
  while ((match = roleMentionRegex.exec(text)) !== null) {
    if (match[1] === 'everyone' || match[1] === 'here') continue;
    const roleName = match[1].toLowerCase();
    for (const [roleId, role] of Object.entries(guild.roles || {})) {
      if (role.name.toLowerCase() === roleName) {
        Object.entries(guild.members || {}).forEach(([mid, data]) => {
          if (data.role === roleId) mentions.push(mid);
        });
      }
    }
  }
  const userMentionRegex = /@(\w+)/g;
  while ((match = userMentionRegex.exec(text)) !== null) {
    const mentioned = Object.values(db).find(u => u.username.toLowerCase() === match[1].toLowerCase());
    if (mentioned) mentions.push(mentioned.id);
  }
  return [...new Set(mentions)];
}

// Screen share signaling (extra events no mesmo socket)
// Os eventos de video/screen share usam os mesmos voiceOffer/voiceAnswer/voiceIceCandidate

// ============= TURN/STUN ICE CONFIG =============
app.get('/api/ice-config', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || ''
    });
  }
  res.json({ iceServers });
});

const PORT = process.env.PORT || 3000;

(async () => {
  await initPG();
  await restoreFromPG();
  loadMessagesFromDisk();

  // Migracao: corrigir canais sem campo type
  const guilds = loadGuilds();
  let changed = false;
  for (const [gId, guild] of Object.entries(guilds)) {
    for (const [chId, ch] of Object.entries(guild.channels || {})) {
      if (!ch.type) {
        ch.type = ch.category === 'voz' || ch.categoryId === 'voz' ? 'voice' : 'text';
        changed = true;
      }
    }
    const newChannels = {};
    for (const [chId, ch] of Object.entries(guild.channels || {})) {
      if (['geral', 'random', 'voz-geral'].includes(chId)) {
        const newId = chId + '-' + gId;
        ch.id = newId;
        newChannels[newId] = ch;
        for (const [mId, msg] of messages) {
          if (msg.guildId === gId && (msg.channel || 'geral') === chId) msg.channel = newId;
        }
        changed = true;
      } else {
        newChannels[chId] = ch;
      }
    }
    guild.channels = newChannels;
  }
  if (changed) {
    saveGuilds(guilds);
    saveMessages();
    console.log('🔄 Migracao: canais corrigidos');
  }

  server.listen(PORT, () => console.log(`⚡ PULSE rodando em http://localhost:${PORT}`));
})();
