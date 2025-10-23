// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const pg = require('pg');
const PgSession = require('connect-pg-simple')(session);

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  BASE_URL,
  SESSION_SECRET,
  DATABASE_URL,
  MODERATOR_IDS
} = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !BASE_URL || !SESSION_SECRET || !DATABASE_URL) {
  console.error('Faltan variables de entorno. Revisa .env');
  process.exit(1);
}

const moderatorIds = (MODERATOR_IDS||'').split(',').map(s => s.trim()).filter(Boolean);

// DB client (pg)
const pgPool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Express
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Session store en Postgres
app.use(session({
  store: new PgSession({
    pool: pgPool,
    tableName: 'session'
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
  }
}));

// Passport + Discord strategy
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
  clientID: DISCORD_CLIENT_ID,
  clientSecret: DISCORD_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/discord/callback`,
  scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
  // Guarda/actualiza usuario en BD (opcional)
  try {
    const { id, username, discriminator, avatar } = profile;
    await pgPool.query(
      `INSERT INTO users(discord_id, username, discriminator, avatar)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (discord_id) DO UPDATE SET username = EXCLUDED.username, discriminator = EXCLUDED.discriminator, avatar = EXCLUDED.avatar`,
      [id, username, discriminator, avatar || null]
    );
  } catch (err) {
    console.error('Error guardando usuario:', err);
  }
  return done(null, profile);
}));

app.use(passport.initialize());
app.use(passport.session());

// Rutas de autenticación
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => {
    // Logueado -> redirigir al dashboard
    res.redirect('/dashboard.html');
  }
);

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => {});
  res.redirect('/');
});

// Middleware helpers
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ ok:false, error:'No autorizado' });
}

function ensureModerator(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ ok:false, error:'No autorizado' });
  const id = req.user.id;
  if (moderatorIds.includes(id)) return next();
  return res.status(403).json({ ok:false, error:'No es moderador' });
}

// API
app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.json({ ok:true, logged:false });
  const u = req.user;
  return res.json({
    ok:true,
    logged:true,
    user: {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      avatar: u.avatar
    },
    isModerator: moderatorIds.includes(u.id)
  });
});

// Obtener vehículos del usuario logueado
app.get('/api/vehicles', ensureAuth, async (req, res) => {
  const discordId = req.user.id;
  try {
    const r = await pgPool.query('SELECT * FROM vehicles WHERE discord_id=$1 ORDER BY created_at DESC', [discordId]);
    res.json({ ok:true, vehicles: r.rows });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, error:'DB error' });
  }
});

// Moderador: listar todos los vehículos (opcional)
app.get('/api/admin/vehicles', ensureModerator, async (req, res) => {
  try {
    const r = await pgPool.query('SELECT * FROM vehicles ORDER BY created_at DESC');
    res.json({ ok:true, vehicles: r.rows });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});

// Moderador: crear vehículo para un discord_id (o por username)
app.post('/api/admin/vehicles', ensureModerator, async (req, res) => {
  const { discord_id, plate, model, color, notes } = req.body;
  if (!discord_id || !plate) return res.status(400).json({ ok:false, error:'Faltan discord_id o plate' });
  try {
    await pgPool.query(
      `INSERT INTO vehicles(discord_id, plate, model, color, notes, created_by)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [discord_id, plate, model || null, color || null, notes || null, req.user.id]
    );
    res.json({ ok:true });
  } catch (e) { console.error(e); res.status(500).json({ ok:false, error:'DB error' }); }
});

// Moderador: eliminar vehículo por id
app.delete('/api/admin/vehicles/:id', ensureModerator, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok:false, error:'ID inválido' });
  try {
    await pgPool.query('DELETE FROM vehicles WHERE id=$1', [id]);
    res.json({ ok:true });
  } catch (e) { console.error(e); res.status(500).json({ ok:false, error:'DB error' }); }
});

// Endpoint para buscar usuario por username#discriminator o por id (simple)
app.get('/api/user/search', ensureModerator, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ ok:false, error:'q requerido' });
  try {
    const r = await pgPool.query(
      `SELECT discord_id, username, discriminator FROM users
       WHERE (username || '#' || discriminator) ILIKE $1 OR discord_id = $2 LIMIT 50`,
      [`%${q}%`, q]
    );
    res.json({ ok:true, results: r.rows });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});

// Servir frontend
app.use(express.static(path.join(__dirname, 'public')));

// Liveness
app.get('/health', (req, res) => res.send('ok'));

// Iniciar servidor
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Servidor escuchando en puerto ${port}`));