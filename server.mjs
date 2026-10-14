// helpdesk-lokal — server proxy lokal Odoo Helpdesk (tanpa buka port).
// Node 18+, tanpa dependency. Kredensial hanya dibaca dari .env (server-side).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..');
const PUB = join(ROOT, 'public');

// --- .env ---
const env = {};
try {
  const raw = await readFile(join(ROOT, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch { /* .env belum ada */ }
const ODOO_URL = (env.ODOO_URL || '').replace(/\/+$/, '');
const ODOO_DB = env.ODOO_DB || '';
const ODOO_LOGIN = env.ODOO_LOGIN || '';
const ODOO_APIKEY = env.ODOO_APIKEY || '';
const PORT = parseInt(env.PORT || '8951', 10);
const POLL_MS = parseInt(env.POLL_MS || '60000', 10);

let odooOk = false;
let odooErr = 'belum dicek';
let uidCache = 0;

// --- Odoo JSON-RPC ---
async function odoo(service, method, args) {
  const r = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error?.data?.message || j.error.message || 'Odoo error');
  return j.result;
}

async function getUid() {
  if (uidCache) return uidCache;
  uidCache = await odoo('common', 'authenticate', [ODOO_DB, ODOO_LOGIN, ODOO_APIKEY, {}]);
  if (!uidCache) throw new Error('auth gagal (cek DB/login/apikey di .env)');
  return uidCache;
}

async function kw(model, method, args = [], kwargs = {}) {
  const uid = await getUid();
  return odoo('object', 'execute_kw', [ODOO_DB, uid, ODOO_APIKEY, model, method, args, kwargs]);
}

const TICKET_LIST_FIELDS = ['id', 'number', 'name', 'priority', 'severity', 'stage_id', 'team_id',
  'user_id', 'partner_id', 'customer_id', 'ca_name', 'create_date', 'write_date', 'last_stage_update',
  'channel_id', 'ticket_type_id', 'is_gamas', 'age_ticket'];
const TICKET_DETAIL_FIELDS = [...TICKET_LIST_FIELDS, 'description', 'phone_customer', 'pic_customer',
  'contact_info', 'ca_id', 'assigned_date', 'in_progress_date', 'solved_date', 'solved_by', 'solved_team',
  'closed_date', 'sla_type_id', 'is_sla_impact', 'downtime_start', 'downtime_end', 'downtime_duration_hours',
  'ticket_category_id', 'ticket_sub_category_id', 'category_id', 'tag_ids', 'kanban_state',
  'parent_ticket_id', 'action_description', 'message_attachment_count'];

function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

// --- cache ringan: ringkasan buat dashboard ---
let cache = { at: 0, meta: null, latest: [], open: [] };
async function refreshCache() {
  const [stages, teams, channels, total, openCount, byStage, open, latest] = await Promise.all([
    kw('helpdesk.ticket.stage', 'search_read', [[], ['id', 'name', 'sequence']], { order: 'sequence' }),
    kw('helpdesk.ticket.team', 'search_read', [[], ['id', 'name']], {}),
    kw('helpdesk.ticket.channel', 'search_read', [[], ['id', 'name']], {}),
    kw('helpdesk.ticket', 'search_count', [[],]),
    kw('helpdesk.ticket', 'search_count', [[['stage_id.name', 'not in', ['Closed', 'Solved', 'Cancelled']]]]),
    kw('helpdesk.ticket', 'read_group', [[], ['stage_id']], { groupby: ['stage_id'], lazy: false }),
    kw('helpdesk.ticket', 'search_read', [[['stage_id.name', 'not in', ['Closed', 'Solved', 'Cancelled']]], TICKET_LIST_FIELDS], { order: 'write_date desc', limit: 50 }),
    kw('helpdesk.ticket', 'search_read', [[], TICKET_LIST_FIELDS], { order: 'write_date desc', limit: 30 }),
  ]);
  cache = { at: Date.now(), meta: { stages, teams, channels, total, openCount, byStage }, latest, open };
  odooOk = true; odooErr = '';
}
async function ensureCache() {
  if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_APIKEY) throw new Error('isi .env dulu (ODOO_URL/DB/LOGIN/APIKEY)');
  if (!cache.at || Date.now() - cache.at > POLL_MS) await refreshCache();
  return cache;
}
setInterval(() => refreshCache().catch((e) => { odooOk = false; odooErr = e.message; uidCache = 0; }), POLL_MS);

// --- HTTP ---
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/api/health') return send(res, 200, JSON.stringify({ ok: odooOk, err: odooErr, cachedAt: cache.at, pollMs: POLL_MS }));
    if (p === '/api/meta') { const c = await ensureCache(); return send(res, 200, JSON.stringify({ ...c.meta, cachedAt: c.at })); }
    if (p === '/api/tickets') {
      const c = await ensureCache();
      let list = u.searchParams.get('scope') === 'open' ? c.open : c.latest;
      const stage = u.searchParams.get('stage');
      const team = u.searchParams.get('team');
      const ch = u.searchParams.get('channel');
      const q = (u.searchParams.get('q') || '').toLowerCase();
      if (stage) list = list.filter((t) => String(t.stage_id?.[0]) === stage);
      if (team) list = list.filter((t) => String(t.team_id?.[0]) === team);
      if (ch) list = list.filter((t) => String(t.channel_id?.[0]) === ch);
      if (q) list = list.filter((t) => `${t.number} ${t.name} ${t.customer_id || ''} ${t.ca_name || ''}`.toLowerCase().includes(q));
      return send(res, 200, JSON.stringify({ tickets: list, cachedAt: c.at }));
    }
    const mId = p.match(/^\/api\/tickets\/(\d+)$/);
    if (mId) {
      const det = await kw('helpdesk.ticket', 'search_read', [[['id', '=', parseInt(mId[1], 10)]], TICKET_DETAIL_FIELDS], {});
      if (!det?.length) return send(res, 404, JSON.stringify({ error: 'tiket tidak ditemukan' }));
      const t = det[0];
      t.description_text = stripHtml(t.description);
      let messages = [];
      try {
        const msgs = await kw('mail.message', 'search_read', [[['model', '=', 'helpdesk.ticket'], ['res_id', '=', t.id]], ['id', 'author_id', 'date', 'body', 'message_type']], { order: 'date desc', limit: 10 });
        messages = (msgs || []).map((mm) => ({ id: mm.id, author: mm.author_id?.[1] || '', date: mm.date, type: mm.message_type, text: stripHtml(mm.body).slice(0, 2000) }));
      } catch { /* chatter opsional */ }
      return send(res, 200, JSON.stringify({ ticket: t, messages }));
    }
    if (p === '/api/refresh') { await refreshCache(); return send(res, 200, JSON.stringify({ ok: true, at: cache.at })); }
    // static
    let file = normalize(join(PUB, p === '/' ? 'index.html' : p.slice(1)));
    if (!file.startsWith(PUB)) return send(res, 403, 'forbidden', 'text/plain');
    const body = await readFile(file);
    return send(res, 200, body, MIME[extname(file)] || 'application/octet-stream');
  } catch (e) {
    odooOk = false; odooErr = e.message; uidCache = 0;
    return send(res, 500, JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`helpdesk-lokal jalan di http://127.0.0.1:${PORT} (lokal saja, tanpa buka port)`);
  refreshCache().then(() => console.log('cache awal OK')).catch((e) => console.log('cache awal gagal:', e.message));
});
