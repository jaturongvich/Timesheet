require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const root = __dirname;
const publicDir = path.join(root, 'public');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const tokenSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const tableNames = { projects: 'projects', engineers: 'engineers', holidays: 'holidays', entries: 'timesheet_entries' };
const fieldMap = {
  projects: { endUser: 'end_user', pmHours: 'pm_hours', seniorHours: 'senior_hours', engineerHours: 'engineer_hours' },
  engineers: { employeeId: 'employee_id', subSystem: 'sub_system' },
  holidays: {},
  entries: { owner_id: 'created_by_user_id', engineerId: 'engineer_id', projectId: 'project_id', date: 'work_date', start: 'start_time', end: 'end_time', stayHotel: 'stay_hotel', dayType: 'day_type' }
};
function fromDb(table, row) {
  const result = { ...row };
  Object.entries(fieldMap[table] || {}).forEach(([api, column]) => {
    if (Object.prototype.hasOwnProperty.call(result, column)) { result[api] = result[column]; delete result[column]; }
  });
  return result;
}
function toDb(table, input) {
  const result = { ...input };
  Object.entries(fieldMap[table] || {}).forEach(([api, column]) => {
    if (Object.prototype.hasOwnProperty.call(result, api)) { result[column] = result[api]; delete result[api]; }
  });
  return result;
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? (code === 204 ? '' : JSON.stringify(body)) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function id() { return crypto.randomUUID(); }
function hash(value) { return crypto.createHash('sha256').update(`${tokenSecret}:${value}`).digest('hex'); }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (e, key) => e ? reject(e) : resolve(`${salt}:${key.toString('hex')}`)));
}
function passwordMatches(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return Promise.resolve(false);
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (e, key) => {
    if (e) return reject(e);
    resolve(crypto.timingSafeEqual(Buffer.from(expected, 'hex'), key));
  }));
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => {
    const i = x.indexOf('='); return [x.slice(0, i).trim(), decodeURIComponent(x.slice(i + 1))];
  }));
}
function requestUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}
async function currentUser(req) {
  const token = cookies(req).timesheet_session;
  if (!token) return null;
  const { data, error } = await db.from('sessions').select('user_id, expires_at, users(id, username, role)').eq('token_hash', hash(token)).maybeSingle();
  if (error) throw error;
  if (!data || new Date(data.expires_at) <= new Date()) return null;
  return data.users;
}
async function requireUser(req, res, admin = false) {
  const user = await currentUser(req);
  if (!user) { send(res, 401, { error: 'Authentication required.' }); return null; }
  if (admin && user.role !== 'admin') { send(res, 403, { error: 'Administrator access required.' }); return null; }
  return user;
}
function projectOf(projects, key) { return projects.find(p => p.id === key)?.code || 'project'; }
function dateKind(holidays, date) {
  if (holidays.some(h => h.date === date)) return 'holiday';
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6 ? 'weekend' : 'normal';
}
function calculated(input, holidays) {
  const start = input.start || '08:00', end = input.end || '18:00';
  const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number);
  const worked = Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60 - Number(input.lunch || 0));
  const expected = Number(input.expected || 8), kind = dateKind(holidays, input.date);
  return { worked: Number(worked.toFixed(2)), normal: kind === 'normal' ? Number(Math.min(worked, expected).toFixed(2)) : 0,
    ot: kind === 'normal' ? Number(Math.max(worked - expected, 0).toFixed(2)) : Number(Math.min(worked, expected).toFixed(2)),
    premium: kind === 'normal' ? 0 : Number(Math.max(worked - expected, 0).toFixed(2)), dayType: kind };
}
async function rows(table, query = q => q) {
  const { data, error } = await query(db.from(tableNames[table] || table).select('*'));
  if (error) throw error;
  return (data || []).map(row => fromDb(table, row));
}
async function stateFor(user) {
  const [projects, engineers, holidays] = await Promise.all([rows('projects'), rows('engineers'), rows('holidays')]);
  let entriesQuery = db.from(tableNames.entries).select('*');
  if (user.role !== 'admin') entriesQuery = entriesQuery.eq('created_by_user_id', user.id);
  const { data: entries, error } = await entriesQuery;
  if (error) throw error;
  return { projects, engineers, entries: (entries || []).map(row => fromDb('entries', row)), holidays };
}
async function api(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const p = await readBody(req);
    if (!p.username || !p.password || p.password.length < 8) return send(res, 400, { error: 'Username and a password of at least 8 characters are required.' });
    const { data: existing } = await db.from('users').select('id').eq('username', p.username).maybeSingle();
    if (existing) return send(res, 409, { error: 'Username is already registered.' });
    const password_hash = await passwordHash(p.password);
    const { data, error } = await db.from('users').insert({ id: id(), username: p.username, password_hash, role: 'user' }).select('id, username, role').single();
    if (error) throw error;
    return send(res, 201, data);
  }
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const p = await readBody(req);
    const { data: user, error } = await db.from('users').select('*').eq('username', p.username || '').maybeSingle();
    if (error) throw error;
    if (!user || !(await passwordMatches(p.password || '', user.password_hash))) return send(res, 401, { error: 'Invalid username or password.' });
    const token = crypto.randomBytes(32).toString('hex');
    const { error: sessionError } = await db.from('sessions').insert({ id: id(), user_id: user.id, token_hash: hash(token), expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
    if (sessionError) throw sessionError;
    res.setHeader('Set-Cookie', `timesheet_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    return send(res, 200, { id: user.id, username: user.username, role: user.role });
  }
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = cookies(req).timesheet_session;
    if (token) await db.from('sessions').delete().eq('token_hash', hash(token));
    res.setHeader('Set-Cookie', 'timesheet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 204, {});
  }
  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const user = await currentUser(req); return send(res, user ? 200 : 401, user || { error: 'Authentication required.' });
  }
  const user = await requireUser(req, res); if (!user) return;
  if (req.method === 'GET' && pathname === '/api/state') return send(res, 200, await stateFor(user));
  if (req.method === 'POST' && pathname === '/api/refresh') {
    const state = await stateFor(user);
    for (const entry of state.entries) await db.from(tableNames.entries).update(toDb('entries', calculated(entry, state.holidays))).eq('id', entry.id);
    return send(res, 200, await stateFor(user));
  }
  if (pathname === '/api/projects' || pathname.startsWith('/api/projects/')) return resource(req, res, 'projects', user);
  if (pathname === '/api/engineers' || pathname.startsWith('/api/engineers/')) return resource(req, res, 'engineers', user);
  if (pathname === '/api/holidays' || pathname.startsWith('/api/holidays/')) return resource(req, res, 'holidays', user);
  if (pathname === '/api/entries' || pathname.startsWith('/api/entries/')) return entries(req, res, user);
  return send(res, 404, { error: 'Not found' });
}
async function resource(req, res, table, user) {
  if (user.role !== 'admin') return send(res, 403, { error: 'Administrator access required.' });
  const key = requestUrl(req).pathname.split('/').pop();
  if (req.method === 'GET') return send(res, 200, await rows(table));
  if (req.method === 'DELETE') {
    const { error } = await db.from(tableNames[table]).delete().eq('id', key); if (error) throw error;
    if (table === 'holidays') {
      const holidays = await rows('holidays');
      const entries = await rows('entries');
      for (const entry of entries) await db.from(tableNames.entries).update(toDb('entries', calculated(entry, holidays))).eq('id', entry.id);
    }
    return send(res, 204, {});
  }
  const payload = await readBody(req);
  if (req.method === 'POST') {
    if (table === 'projects' && (!payload.code || !payload.name || !payload.customer)) return send(res, 400, { error: 'Project code, name and customer are required.' });
    if (table === 'engineers' && (!payload.name || !payload.surname)) return send(res, 400, { error: 'Name and surname are required.' });
    if (table === 'holidays' && (!payload.date || !payload.description)) return send(res, 400, { error: 'Date and description are required.' });
    const { data, error } = await db.from(tableNames[table]).insert(toDb(table, { id: id(), ...payload })).select().single(); if (error) throw error;
    if (table === 'holidays') {
      const holidays = await rows('holidays'), entries = await rows('entries');
      for (const entry of entries) await db.from(tableNames.entries).update(toDb('entries', calculated(entry, holidays))).eq('id', entry.id);
    }
    return send(res, 201, fromDb(table, data));
  }
  if (req.method === 'PUT') { const { data, error } = await db.from(tableNames[table]).update(toDb(table, payload)).eq('id', key).select().single(); if (error) throw error; return send(res, 200, fromDb(table, data)); }
  return send(res, 404, { error: 'Not found' });
}
async function entries(req, res, user) {
  const key = requestUrl(req).pathname.split('/').pop(), state = await stateFor(user);
  if (req.method === 'DELETE') { const q = db.from(tableNames.entries).delete().eq('id', key); if (user.role !== 'admin') q.eq('created_by_user_id', user.id); const { error } = await q; if (error) throw error; return send(res, 204, {}); }
  if (req.method === 'POST') {
    const e = await readBody(req); if (!e.engineerId || !e.projectId || !e.date) return send(res, 400, { error: 'Engineer, project and date are required.' });
    const item = { id: id(), owner_id: user.id, ...e, ...calculated(e, state.holidays), stayHotel: e.stayHotel === 'Y' };
    delete item.ownerId; const { data, error } = await db.from(tableNames.entries).insert(toDb('entries', item)).select().single(); if (error) throw error; return send(res, 201, fromDb('entries', data));
  }
  if (req.method === 'PUT') {
    const e = await readBody(req), current = state.entries.find(x => x.id === key);
    if (!current) return send(res, 404, { error: 'Timesheet entry not found.' });
    const merged = { ...current, ...e, ...calculated({ ...current, ...e }, state.holidays), stayHotel: e.stayHotel === true || e.stayHotel === 'Y' };
    delete merged.owner_id; delete merged.id; const q = db.from(tableNames.entries).update(toDb('entries', merged)).eq('id', key); if (user.role !== 'admin') q.eq('created_by_user_id', user.id);
    const { data, error } = await q.select().single(); if (error) throw error; return send(res, 200, fromDb('entries', data));
  }
  return send(res, 404, { error: 'Not found' });
}
async function bootstrap() {
  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Initial admin bootstrap is not configured: set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD.');
  }
  let lookup;
  try {
    lookup = await db.from('users').select('id').eq('username', username).maybeSingle();
  } catch (error) {
    throw new Error('Initial admin bootstrap could not query the Supabase users table.', { cause: error });
  }
  if (lookup.error) throw new Error('Initial admin bootstrap could not query the Supabase users table.', { cause: lookup.error });
  if (lookup.data) return;
  let passwordHashValue;
  try {
    passwordHashValue = await passwordHash(password);
  } catch (error) {
    throw new Error('Initial admin bootstrap could not prepare the admin credential.', { cause: error });
  }
  const inserted = await db.from('users').insert({ id: id(), username, password_hash: passwordHashValue, role: 'admin' });
  if (!inserted.error) return;
  // Another instance may have created the same user between lookup and insert.
  let confirmed;
  try {
    confirmed = await db.from('users').select('id').eq('username', username).maybeSingle();
  } catch (error) {
    throw new Error('Initial admin bootstrap failed while confirming the admin user.', { cause: error });
  }
  if (confirmed.error || !confirmed.data) {
    throw new Error('Initial admin bootstrap could not create the admin user.', { cause: inserted.error });
  }
}
async function handleHttp(req, res) {
  const pathname = requestUrl(req).pathname;
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    const file = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
    if (!file.startsWith(publicDir)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => { if (err) return send(res, 404, 'Not found', 'text/plain'); const ext = path.extname(file); send(res, 200, data, ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html'); });
  } catch (e) { console.error(e); send(res, 500, { error: 'Server error.' }); }
}
module.exports = { api, handleHttp, bootstrap };

function reportStartupError(e) {
  const message = String(e && e.message || e);
  const certificateError = (() => {
    let current = e;
    while (current) {
      if (current.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || String(current.message || '').includes('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')) return true;
      current = current.cause;
    }
    return message.includes('UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
  })();
  if (certificateError) {
    console.error('Supabase startup failed: Node.js could not verify the Supabase TLS certificate (UNABLE_TO_GET_ISSUER_CERT_LOCALLY).');
    console.error('Check the machine CA certificate store, HTTPS proxy inspection certificate, or corporate network configuration.');
    console.error('Install the trusted corporate/root CA through your organization-approved method, then restart the server.');
    console.error('TLS verification was not disabled.');
  } else {
    console.error('Supabase bootstrap failed:', message);
  }
  process.exit(1);
}

if (require.main === module) {
  const server = http.createServer(handleHttp);
  bootstrap().then(() => server.listen(3000, () => console.log('Timesheet app running at http://localhost:3000'))).catch(reportStartupError);
}
