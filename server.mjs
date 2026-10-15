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
  'channel_id', 'ticket_type_id', 'is_gamas', 'age_ticket',
  'assigned_date', 'in_progress_date', 'solved_date', 'closed_date',
  'ticket_duration', 'solved_duration', 'progress_duration', 'pop_location_id'];
const TICKET_DETAIL_FIELDS = [...TICKET_LIST_FIELDS, 'description', 'phone_customer', 'pic_customer',
  'contact_info', 'ca_id', 'assigned_date', 'in_progress_date', 'solved_date', 'solved_by', 'solved_team',
  'closed_date', 'sla_type_id', 'is_sla_impact', 'downtime_start', 'downtime_end', 'downtime_duration_hours',
  'ticket_category_id', 'ticket_sub_category_id', 'category_id', 'tag_ids', 'kanban_state',
  'parent_ticket_id', 'action_description', 'message_attachment_count'];

function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

// Field `number` di Odoo ini computed & tidak searchable → cocokkan nomor secara lokal.
let numCache = { at: 0, rows: [] };
async function ticketIdsByNumber(q) {
  if (Date.now() - numCache.at > 60000) {
    numCache = { at: Date.now(), rows: await kw('helpdesk.ticket', 'search_read', [[], ['id', 'number']], { limit: 5000 }) };
  }
  const ql = q.toLowerCase();
  return numCache.rows.filter((t) => (t.number || '').toLowerCase().includes(ql)).map((t) => t.id);
}
async function ticketQDomain(q) {
  const ids = await ticketIdsByNumber(q);
  return ['|', ['id', 'in', ids.length ? ids : [0]],
    '|', '|', '|', ['name', 'ilike', q], ['number', 'ilike', q], ['customer_id', 'ilike', q], ['ca_name', 'ilike', q]];
}

// Cache 1500 log L2 terbaru (60 dtk) — buat search lokal yang tembus
// tiket di luar hak baca akun ini.
let l2Cache = { at: 0, rows: [] };
async function recentL2() {
  if (Date.now() - l2Cache.at > 60000) {
    l2Cache = { at: Date.now(), rows: await kw('helpdesk.ticket.l2', 'search_read', [[],
      ['id', 'ticket_id', 'team_id', 'user_id', 'start_time', 'end_time', 'activity_id', 'reason', 'create_date']],
      { order: 'create_date desc', limit: 1500 }) };
  }
  return l2Cache.rows;
}

// Filter rentang tanggal ?from=YYYY-MM-DD&to=YYYY-MM-DD.
function dateRange(field, from, to) {
  const f = field || 'create_date';
  const d = [];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) d.push([f, '>=', from]);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const t = new Date(to + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 1);
    d.push([f, '<', t.toISOString().slice(0, 10)]);
  }
  return d;
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
    if (p === '/api/search') {
      const q = (u.searchParams.get('q') || '').trim();
      const team = u.searchParams.get('team');
      const stage = u.searchParams.get('stage');
      const ch = u.searchParams.get('channel');
      const domain = dateRange('', u.searchParams.get('from'), u.searchParams.get('to'));
      if (team) domain.push(['team_id', '=', parseInt(team, 10)]);
      if (stage) domain.push(['stage_id', '=', parseInt(stage, 10)]);
      if (ch) domain.push(['channel_id', '=', parseInt(ch, 10)]);
      if (q) domain.push(...(await ticketQDomain(q)));
      const tickets = await kw('helpdesk.ticket', 'search_read', [domain, TICKET_LIST_FIELDS], { order: 'write_date desc', limit: 30 });
      return send(res, 200, JSON.stringify({ tickets, live: true }));
    }
    const mId = p.match(/^\/api\/tickets\/(\d+)$/);    if (mId) {
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
    if (p === '/api/solve-actions') {
      const acts = await kw('ticket.action', 'search_read', [[], ['id', 'name']], { order: 'name' });
      return send(res, 200, JSON.stringify({ actions: acts }));
    }
    if (p === '/api/stats') {
      // Analitik: tiket per hari (14 hari) + penanganan L2 per hari.
      const days = Math.min(parseInt(u.searchParams.get('days') || '14', 10) || 14, 60);
      const team = u.searchParams.get('team');
      const keys = [];
      const today = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        keys.push(d.toISOString().slice(0, 10));
      }
      const tickets = await kw('helpdesk.ticket', 'search_read', [[], ['id', 'create_date', 'stage_id']], { limit: 5000 });
      const byDay = keys.map((k) => ({ date: k, total: 0, open: 0 }));
      const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
      for (const t of tickets) {
        const k = String(t.create_date || '').slice(0, 10);
        if (k in idx) {
          byDay[idx[k]].total++;
          const st = t.stage_id?.[1] || '';
          if (!['Closed', 'Solved', 'Cancelled'].includes(st)) byDay[idx[k]].open++;
        }
      }
      const l2dom = team ? [['team_id', '=', parseInt(team, 10)]] : [];
      const logs = await kw('helpdesk.ticket.l2', 'search_read', [l2dom, ['id', 'create_date', 'end_time']], { order: 'create_date desc', limit: 3000 });
      const l2ByDay = keys.map((k) => ({ date: k, total: 0, done: 0 }));
      for (const l of logs) {
        const k = String(l.create_date || '').slice(0, 10);
        if (k in idx) { l2ByDay[idx[k]].total++; if (l.end_time) l2ByDay[idx[k]].done++; }
      }
      return send(res, 200, JSON.stringify({ byDay, l2ByDay, l2Sampled: logs.length }));
    }
    const mAct = p.match(/^\/api\/tickets\/(\d+)\/action$/);
    if (mAct && req.method === 'POST') {
      // AKSI TULIS ke Odoo — hanya jalan kalau user pencet tombol + konfirmasi di UI.
      const id = parseInt(mAct[1], 10);
      const body = await new Promise((resolve) => {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
      });
      const op = body.op;
      const vis = await kw('helpdesk.ticket', 'search_read', [[['id', '=', id]], ['id', 'number', 'stage_id']], {});
      if (!vis?.length) return send(res, 404, JSON.stringify({ error: 'tiket tidak kelihatan akun ini' }));
      const uid = await getUid();
      const redo = async () => (await kw('helpdesk.ticket', 'search_read', [[['id', '=', id]], ['stage_id']], {}))?.[0]?.stage_id?.[1] || null;
      if (op === 'accept') {
        await kw('helpdesk.ticket', 'write', [[id], { user_id: uid }], {});
      } else if (op === 'hold') {
        if (!body.reason?.trim()) return send(res, 400, JSON.stringify({ error: 'alasan hold wajib diisi' }));
        const w = await kw('helpdesk.hold.wizard', 'create', [{ ticket_id: id, reason: body.reason.trim() }], {});
        await kw('helpdesk.hold.wizard', 'action_confirm', [w], {});
      } else if (op === 'resume') {
        await kw('helpdesk.ticket', 'action_resume', [id], {});
      } else if (op === 'solve') {
        if (!body.actionId) return send(res, 400, JSON.stringify({ error: 'pilih action penyelesaian dulu' }));
        const w = await kw('helpdesk.solve.wizard', 'create', [{ ticket_id: id, ticket_action_id: parseInt(body.actionId, 10), action_description: body.reason || '' }], {});
        await kw('helpdesk.solve.wizard', 'action_confirm', [w], {});
      } else if (op === 'close') {
        const w = await kw('helpdesk.close.ticket.wizard', 'create', [{ ticket_id: id, action_description: body.reason || '' }], {});
        await kw('helpdesk.close.ticket.wizard', 'action_confirm_close', [w], {});
      } else {
        return send(res, 400, JSON.stringify({ error: 'aksi tidak dikenal' }));
      }
      console.log(`[AKSI] ${op} tiket ${vis[0].number} oleh ${ODOO_LOGIN}`);
      cache.at = 0; // paksa refresh biar langsung kelihatan
      return send(res, 200, JSON.stringify({ ok: true, op, stage: await redo() }));
    }
    if (p === '/api/l2') {
      try {
      // Log penanganan L2: start_time (diambil) vs end_time (selesai) per team.
      const team = u.searchParams.get('team');
      const q = (u.searchParams.get('q') || '').trim();
      const month = u.searchParams.get('month');
      const LF = ['id', 'ticket_id', 'team_id', 'user_id', 'start_time', 'end_time', 'activity_id', 'reason', 'create_date'];
      if (q) {
        // 1) cocokkan lokal di cache 1500 log terbaru (by display tiket/user/alasan) —
        //    ini tembus tiket yang akun ini tidak boleh baca langsung.
        const recent = await recentL2();
        const ql = q.toLowerCase();
        const from = u.searchParams.get('from'), to = u.searchParams.get('to');
        const byLocal = recent.filter((r) =>
          (!team || r.team_id?.[0] === parseInt(team, 10)) &&
          (!from || String(r.create_date || '') >= from) &&
          (!to || String(r.create_date || '') <= to) &&
          `${r.ticket_id?.[1] || ''} ${r.user_id?.[1] || ''} ${r.reason || ''} ${r.activity_id?.[1] || ''}`.toLowerCase().includes(ql));
        // 2) plus tiket yang kebaca akun ini
        const qd = await ticketQDomain(q);
        const tids = await kw('helpdesk.ticket', 'search', [qd], {});
        let byTicket = [];
        if (tids.length) {
          const d2 = dateRange('', from, to);
          if (team) d2.push(['team_id', '=', parseInt(team, 10)]);
          d2.push(['ticket_id', 'in', tids]);
          byTicket = await kw('helpdesk.ticket.l2', 'search_read', [d2, LF], { order: 'create_date desc', limit: 30 });
        }
        const seenIds = new Set();
        const logs = [...byLocal, ...byTicket].filter((r) => !seenIds.has(r.id) && seenIds.add(r.id)).slice(0, 30);
        const etids = [...new Set(logs.map((r) => r.ticket_id?.[0]).filter(Boolean))];
        let tinfo = {};
        if (etids.length) {
          try {
            const rows = await kw('helpdesk.ticket', 'search_read', [[['id', 'in', etids]],
              ['id', 'number', 'stage_id', 'create_date', 'create_uid', 'write_date', 'write_uid',
               'assigned_date', 'user_id', 'solved_date', 'solved_by', 'solved_team', 'closed_date', 'closed_by_l1']], {});
            tinfo = Object.fromEntries(rows.map((t) => [t.id, t]));
          } catch {
            tinfo = {};
          }
        }
        return send(res, 200, JSON.stringify({ logs, tinfo, live: true }));
      }
      const domain = dateRange('', u.searchParams.get('from'), u.searchParams.get('to'));
      if (team) domain.push(['team_id', '=', parseInt(team, 10)]);
      const logs = await kw('helpdesk.ticket.l2', 'search_read', [domain, LF],
        { order: 'create_date desc', limit: 30 });
      const tids2 = [...new Set(logs.map((r) => r.ticket_id?.[0]).filter(Boolean))];
      let tinfo2 = {};
      if (tids2.length) {
        try {
          const rows2 = await kw('helpdesk.ticket', 'search_read', [[['id', 'in', tids2]],
            ['id', 'number', 'stage_id', 'create_date', 'create_uid', 'write_date', 'write_uid',
             'assigned_date', 'user_id', 'solved_date', 'solved_by', 'solved_team', 'closed_date', 'closed_by_l1']], {});
          tinfo2 = Object.fromEntries(rows2.map((t) => [t.id, t]));
        } catch {
          tinfo2 = {};
        }
      }
      return send(res, 200, JSON.stringify({ logs, tinfo: tinfo2, live: true }));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: e.message }));
    }
    }
    if (p === '/api/kpi-l2') {
      const team = u.searchParams.get('team');
      const domain = dateRange('', u.searchParams.get('from'), u.searchParams.get('to'));
      if (team) domain.push(['team_id', '=', parseInt(team, 10)]);
      const rows = await kw('helpdesk.ticket.l2', 'search_read', [domain,
        ['id', 'user_id', 'start_time', 'end_time', 'activity_id']], { order: 'create_date desc', limit: 2000 });
      const mins = (a, b) => {
        if (!a || !b) return null;
        const d = (new Date(b.replace(' ', 'T') + 'Z') - new Date(a.replace(' ', 'T') + 'Z')) / 60000;
        return d >= 0 && d < 43200 ? Math.round(d) : null; // buang anomali >30 hari
      };
      const avg = (xs) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
      const now = Date.now();
      const durs = [], byUser = {}, byAct = {}, noEnd = [];
      for (const r of rows) {
        const d = mins(r.start_time, r.end_time);
        let effMenit = null; // durasi efektif untuk rata-rata (selesai → full, masih jalan → sampai sekarang)
        if (d !== null) { effMenit = d; durs.push(d); }
        else {
          noEnd.push(r.id);
          if (r.start_time) {
            const m = Math.round((now - new Date(r.start_time.replace(' ', 'T') + 'Z').getTime()) / 60000);
            if (m >= 0 && m < 43200) effMenit = m;
          }
        }
        const un = r.user_id?.[1] || 'Tanpa nama';
        byUser[un] = byUser[un] || { n: 0, done: 0, durs: [] };
        byUser[un].n++;
        if (d !== null) byUser[un].done++;
        if (effMenit !== null) byUser[un].durs.push(effMenit);
        const an = r.activity_id?.[1] || 'Lainnya';
        byAct[an] = byAct[an] || { n: 0, done: 0, durs: [] };
        byAct[an].n++;
        if (d !== null) byAct[an].done++;
        if (effMenit !== null) byAct[an].durs.push(effMenit);
      }
      const users = Object.entries(byUser).map(([name, v]) => ({
        name, total: v.n, selesai: v.done, jalan: v.n - v.done, avgMenit: avg(v.durs),
      })).sort((a, b) => b.total - a.total);
      const acts = Object.entries(byAct).map(([name, v]) => ({
        name, total: v.n, selesai: v.done, jalan: v.n - v.done, avgMenit: avg(v.durs),
      })).sort((a, b) => b.total - a.total);
      return send(res, 200, JSON.stringify({
        total: rows.length, selesai: durs.length, jalan: noEnd.length,
        avgMenit: avg(durs), users, acts,
      }));
    }
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
