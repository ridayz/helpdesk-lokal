// Dashboard lokal CMS: polling /api/*, diff buat notifikasi desktop + bunyi.
const $ = (id) => document.getElementById(id);
const seenKey = 'hdl_seen_v1';
const seen = JSON.parse(localStorage.getItem(seenKey) || '{}');
const saveSeen = () => localStorage.setItem(seenKey, JSON.stringify(seen));
const submitted = new Set(JSON.parse(localStorage.getItem('hdl_submitted') || '[]'));
const saveSubmitted = () => localStorage.setItem('hdl_submitted', JSON.stringify([...submitted]));
function monthList() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
    out.push({ v: `${y}-${m}`, label: `${y}-${m}` });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
function fillMonths() {
  for (const id of ['fMonthL2', 'fMonthKpi']) {
    $(id).innerHTML = monthList().map((m) => `<option value="${m.v}">${m.label}</option>`).join('');
  }
}
function curMonth() { return ($('fMonthL2') && $('fMonthL2').value) || monthList()[0].v; }
let meta = null;
let pollTimer = null;

const TITLES = { dashboard: 'Dashboard', tiket: 'Tiket', penanganan: 'Penanganan L2', kpi: 'KPI' };
document.querySelectorAll('.nav').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.nav').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
    $('page-' + b.dataset.page).classList.remove('hidden');
    $('pageTitle').textContent = TITLES[b.dataset.page];
  };
});

function badgeClass(stage) {
  return 'badge ' + String(stage || '').replace(/\s/g, '');
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function diffMenit(a, b) {
  if (!a || !b) return null;
  const d = (new Date(String(b).replace(' ', 'T') + 'Z') - new Date(String(a).replace(' ', 'T') + 'Z')) / 60000;
  return d >= 0 ? Math.round(d) : null;
}
function fmtDur(m) {
  if (m === null || m === undefined) return '–';
  if (m < 60) return m + ' mnt';
  if (m < 1440) return Math.floor(m / 60) + 'j ' + (m % 60) + 'mnt';
  return Math.floor(m / 1440) + 'h ' + Math.floor((m % 1440) / 60) + 'j';
}
const startOf = (t) => t.in_progress_date || t.assigned_date || null;
const endOf = (t) => t.solved_date || t.closed_date || null;
function waktuChip(t) {
  const s = startOf(t), e = endOf(t);
  if (e) return `⏱ ${fmtDur(diffMenit(t.create_date, e))}`;
  if (s) return '🔧 dikerjakan';
  return '🆕 nunggu diambil';
}
// baris tabel tiket (withCust: tampilkan kolom customer di halaman Tiket)
function trHtml(t, withCust) {
  const stage = t.stage_id?.[1] || '-';
  return `<tr data-id="${t.id}">
    <td class="t">${esc(t.number || '')}</td>
    <td>${esc(t.name || '')}</td>
    <td><span class="${badgeClass(stage)}">${esc(stage)}</span></td>
    <td>${esc(t.team_id?.[1] || '-')}</td>
    <td>${esc(t.user_id?.[1] || '-')}</td>
    ${withCust ? `<td>${esc(t.ca_name || t.partner_id?.[1] || '-')}</td>` : ''}
    <td>${waktuChip(t)}</td>
    <td>${esc(t.write_date || '')}</td></tr>`;
}
function bindRows(tbody) {
  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = () => openDetail(parseInt(tr.dataset.id, 10));
  });
}

async function api(path, tries = 3) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(path);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

async function loadMeta() {
  meta = await api('/api/meta');
  window._meta = meta;
  $('navOpen').textContent = meta.openCount ?? '';
  const fill = (el, items, label) => {
    const cur = $(el).value;
    $(el).innerHTML = `<option value="">${label}</option>` + items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    $(el).value = cur;
  };
  fill('fStage', meta.stages || [], 'Semua stage');
  fill('fTeam', meta.teams || [], 'Semua team');
  fill('fChannel', meta.channels || [], 'Semua channel');
  renderStats();
}

function renderStats() {
  const m = window._meta, k = window._kpi, s = window._stats;
  if (!m) return;
  const closed = (m.byStage || []).find((g) => g.stage_id?.[1] === 'Closed')?.__count || 0;
  const pct = m.total ? Math.round((closed / m.total) * 100) : 0;
  const new7 = s ? s.byDay.slice(-7).reduce((a, d) => a + d.total, 0) : null;
  $('statCards').innerHTML = `
    <div class="stat"><span class="ic pink">🎫</span><div><div class="lb">Tiket terbuka</div>
      <div><span class="vl">${m.openCount ?? '–'}</span><span class="delta flat">● live</span></div></div></div>
    <div class="stat"><span class="ic cyan">🗂️</span><div><div class="lb">Total tiket</div>
      <div><span class="vl">${m.total ?? '–'}</span>${new7 === null ? '' : `<span class="delta ${new7 ? 'up' : 'flat'}">+${new7}/7hr</span>`}</div></div></div>
    <div class="stat"><span class="ic green">📈</span><div><div class="lb">Progress selesai</div>
      <div><span class="vl">${pct}%</span><span class="delta ${pct >= 90 ? 'up' : 'flat'}">${closed}/${m.total ?? '?'}</span></div></div></div>
    <div class="stat"><span class="ic amber">🛠️</span><div><div class="lb">Penanganan Cibitung</div>
      <div><span class="vl">${k ? k.total : '–'}</span>${k ? `<span class="delta flat">⌀ ${fmtDur(k.avgMenit)}</span>` : ''}</div></div></div>`;
  // gauge selesai
  const R = 70, C = 2 * Math.PI * R, frac = pct / 100;
  $('gauge').innerHTML = `
    <svg viewBox="0 0 200 120"><circle cx="100" cy="105" r="${R}" fill="none" stroke="#232c5e" stroke-width="16"/>
    <circle cx="100" cy="105" r="${R}" fill="none" stroke="url(#gg)" stroke-width="16" stroke-linecap="round"
      stroke-dasharray="${(C * frac * 0.52).toFixed(1)} ${C.toFixed(1)}" transform="rotate(207 100 105)"/>
    <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#e349c5"/></linearGradient></defs>
    <text x="100" y="95" text-anchor="middle" fill="#fff" font-size="26" font-weight="800">${pct}%</text></svg>`;
  $('gaugeLegend').innerHTML =
    `<span><i style="background:#e349c5"></i>Selesai ${closed}</span>
     <span><i style="background:#232c5e"></i>Terbuka ${m.openCount ?? 0}</span>`;
  if (s) {
    // bar tiket/hari
    const max = Math.max(1, ...s.byDay.map((d) => d.total));
    const W = 560, H = 150, bw = W / s.byDay.length;
    $('bars').innerHTML = `<svg viewBox="0 0 ${W} ${H + 22}">` + s.byDay.map((d, i) => {
      const h = Math.max(3, (d.total / max) * H);
      const x = (i * bw + 2).toFixed(1);
      return `<rect x="${x}" y="${(H - h).toFixed(1)}" width="${(bw - 5).toFixed(1)}" height="${h.toFixed(1)}" rx="4"
        fill="url(#bg)" opacity="${d.total ? 1 : 0.25}"><title>${d.date}: ${d.total} tiket (${d.open} terbuka)</title></rect>` +
        (i % 2 ? '' : `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H + 16}" text-anchor="middle" fill="#8f97c4" font-size="11">${d.date.slice(5)}</text>`);
    }).join('') + `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e349c5"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs></svg>`;
  }
}

async function loadStats() {
  try {
    const teamId = $('fTeam').value || '17';
    window._stats = await api('/api/stats?days=14&team=' + teamId);
  } catch { window._stats = null; }
  renderStats();
}

async function loadTickets() {
  const hasFilter = $('fStage').value || $('fTeam').value || $('fChannel').value || $('fQ').value.trim();
  const box = $('ticketList');
  if (hasFilter) {
    box.innerHTML = '<tr><td colspan="8"><div class="skel">mencari…</div></td></tr>';
    const q = new URLSearchParams({ stage: $('fStage').value, team: $('fTeam').value, channel: $('fChannel').value, q: $('fQ').value.trim() });
    const j = await api('/api/search?' + q);
    box.innerHTML = j.tickets.length ? '' : '<tr><td colspan="8" class="muted">Tidak ada tiket cocok di seluruh database.</td></tr>';
    box.innerHTML = j.tickets.map((t) => trHtml(t, true)).join('') || box.innerHTML;
    bindRows(box);
    return;
  }
  const j = await api('/api/tickets?scope=latest');
  box.innerHTML = j.tickets.length ? '' : '<tr><td colspan="8" class="muted">Tidak ada tiket.</td></tr>';
  box.innerHTML = j.tickets.map((t) => trHtml(t, true)).join('') || box.innerHTML;
  bindRows(box);
  checkNotif(j.tickets);
}

async function loadOpen() {
  const j = await api('/api/tickets?scope=open');
  $('openListCount').textContent = j.tickets.length + ' tiket';
  const box = $('openList');
  box.innerHTML = j.tickets.length ? '' : '<tr><td colspan="7" class="muted">🎉 Tidak ada tiket terbuka. Aman.</td></tr>';
  box.innerHTML = j.tickets.map((t) => trHtml(t, false)).join('') || box.innerHTML;
  bindRows(box);
}

async function loadKpi() {
  const teamId = $('fTeam').value || '17';
  const teamName = $('fTeam').value
    ? ($('fTeam').selectedOptions[0]?.text || '')
    : 'L2 Field Ops Access - Cibitung';
  $('kpiTeam').textContent = teamName;
  try {
    const k = await api('/api/kpi-l2?team=' + teamId + '&month=' + curMonth());
    window._kpi = k;
    renderStats();
    $('kpiCards').innerHTML = `
      <div class="card"><div class="num" style="font-size:30px">${fmtDur(k.avgMenit)}</div><div class="lbl">Rata-rata penanganan (ambil→selesai)</div></div>
      <div class="card"><div class="num">${k.selesai}/${k.total}</div><div class="lbl">Penanganan selesai</div></div>
      <div class="card"><div class="num">${k.jalan}</div><div class="lbl">Masih jalan (belum end)</div></div>`;
    $('kpiUsers').innerHTML = (k.users || []).map((u) =>
      `<tr><td class="t">${esc(u.name)}</td><td>🛠️ ${u.total}</td><td>⏱ ${fmtDur(u.avgMenit)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Belum ada data.</td></tr>';
    $('kpiActs').innerHTML = (k.acts || []).map((a) =>
      `<tr><td class="t">${esc(a.name)}</td><td>🛠️ ${a.total}x</td><td>⏱ ${fmtDur(a.avgMenit)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Belum ada data.</td></tr>';
    loadL2Recent();
  } catch (e) {
    $('kpiCards').innerHTML = '<div class="muted">KPI gagal dimuat: ' + esc(e.message) + '</div>';
  }
}

async function loadL2Recent() {
  const teamId = $('fTeam').value || '17';
  const q = ($('fL2Q')?.value || '').trim();
  const box = $('kpiRecent');
  try {
    const recent = await api('/api/l2?team=' + teamId + '&month=' + curMonth() + '&q=' + encodeURIComponent(q));
    let logs = recent.logs || [];
    if ($('fUnsub')?.checked) logs = logs.filter((lg) => !submitted.has(lg.id));
    box.innerHTML = (logs.map((lg) => {
      const dur = diffMenit(lg.start_time, lg.end_time);
      const done = submitted.has(lg.id);
      return `<tr class="${done ? 'submitted' : ''}"><td class="t">${esc(lg.ticket_id?.[1] || ('#' + lg.id))}</td>
        <td>${esc(lg.user_id?.[1] || '-')}</td><td>${esc(lg.activity_id?.[1] || '-')}</td>
        <td>${esc(lg.start_time || '-')}</td><td>${esc(lg.end_time || 'jalan…')}</td>
        <td>${dur === null ? '…' : fmtDur(dur)}</td><td>${esc(lg.reason || '-')}</td>
        <td><button class="cp" data-cp="${lg.id}" title="Copy siap-paste ke Dynamics">📋</button></td>
        <td><button class="sub${done ? ' done' : ''}" data-sub="${lg.id}" title="Tandai sudah submit ke Dynamics">${done ? '✅' : '⬜'}</button></td></tr>`;
    }).join('')) || '<tr><td colspan="9" class="muted">Tidak ketemu.</td></tr>';
    box.querySelectorAll('button.cp').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const lg = (recent.logs || []).find((x) => String(x.id) === b.dataset.cp);
        if (lg) copyText(l2CopyText(lg), b);
      };
    });
    box.querySelectorAll('button.sub').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const id = parseInt(b.dataset.sub, 10);
        if (submitted.has(id)) submitted.delete(id); else submitted.add(id);
        saveSubmitted();
        loadL2Recent();
      };
    });
  } catch (e) {
    box.innerHTML = '<tr><td colspan="9" class="muted">Gagal: ' + esc(e.message) + '</td></tr>';
  }
}

function fmtID(dt) {
  if (!dt) return '-';
  const d = new Date(String(dt).replace(' ', 'T') + 'Z');
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ap}`;
}
async function copyText(txt, btn) {
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
}
// format siap-paste ke form Dynamics Service Ticket
function l2CopyText(lg) {
  const num = (lg.ticket_id?.[1] || '').split(' - ')[0];
  return [
    'Ticket Number: ' + num,
    'Start: ' + fmtID(lg.start_time),
    'End: ' + fmtID(lg.end_time || ''),
    'Location: -',
    'Teknisi: ' + (lg.user_id?.[1] || '-'),
    'Aktivitas: ' + (lg.activity_id?.[1] || '-'),
    'Notes: ' + (lg.reason || '-'),
  ].join('\n');
}
function ticketCopyText(t) {
  return [
    'Ticket Number: ' + (t.number || '-'),
    'Diambil: ' + fmtID(startOf(t)),
    'Close: ' + fmtID(endOf(t)),
    'Respon: ' + fmtDur(diffMenit(t.create_date, startOf(t))),
    'Pengerjaan: ' + fmtDur(diffMenit(startOf(t), endOf(t))),
    'Total: ' + fmtDur(diffMenit(t.create_date, endOf(t))),
    'Lokasi: ' + (t.pop_location_id?.[1] || '-'),
    'Teknisi: ' + (t.user_id?.[1] || '-'),
    'Notes: ' + ((t.description_text || '').slice(0, 500) || '-'),
  ].join('\n');
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.35);
  } catch { /* audio opsional */ }
}

function notify(title, body, ticketId) {
  if (localStorage.getItem('hdl_notif') === 'off') return;
  beep();
  // toast dalam aplikasi — selalu jalan, sekali klik, tanpa izin browser
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<b>${esc(title)}</b><br><span>${esc(body)}</span>`;
  if (ticketId) el.onclick = () => { openDetail(ticketId); el.remove(); };
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), 9000);
  // bonus: notifikasi bawaan browser kalau diizinkan
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch { /* abaikan */ }
  }
}
function paintNotifBtn() {
  $('btnNotif').textContent = localStorage.getItem('hdl_notif') === 'off' ? '🔕 Mati' : '🔔 Aktif';
}

function checkNotif(tickets) {
  let changed = false;
  for (const t of tickets) {
    const prev = seen[t.id];
    const cur = (t.write_date || '') + '|' + (t.stage_id?.[1] || '');
    if (!prev) {
      notify('🎫 Tiket baru: ' + (t.number || ''), (t.name || '') + ' — ' + (t.stage_id?.[1] || ''), t.id);
      changed = true;
    } else if (prev !== cur) {
      notify('🔄 Update: ' + (t.number || ''), (t.name || '') + ' → ' + (t.stage_id?.[1] || ''), t.id);
      changed = true;
    }
    seen[t.id] = cur;
  }
  if (changed) saveSeen();
  const ids = new Set(tickets.map((t) => String(t.id)));
  for (const k of Object.keys(seen)) if (!ids.has(k) && Math.random() < 0.05) delete seen[k];
}

async function openDetail(id) {
  const j = await api('/api/tickets/' + id);
  const t = j.ticket;
  const FLOW = ['New', 'Open', 'In Progress', 'Solved', 'Closed'];
  const cur = t.stage_id?.[1] || '';
  const curIdx = FLOW.indexOf(cur);
  const steps = FLOW.map((s, i) => {
    const cls = cur === 'Hold' ? (i < 2 ? 'done' : '') : (i < curIdx ? 'done' : (i === curIdx ? 'now' : ''));
    return `${i ? '<span class="link"></span>' : ''}<span class="step ${cls}"><span class="dotn">${i < curIdx || (cur === 'Hold' && i < 2) ? '✓' : (i + 1)}</span>${esc(s)}</span>`;
  }).join('');
  $('detail').innerHTML = `
    <h2>${esc(t.number || '')}</h2>
    <div class="${badgeClass(cur)}">${esc(cur)}</div>
    <div class="actionbar">
      <button data-act="accept" title="Assign tiket ini ke kamu">✅ Accept</button>
      <button data-act="hold" title="Hold + wajib alasan">⏸️ Hold</button>
      <button data-act="resume" title="Balikin dari Hold">▶️ Resume</button>
      <select id="solveAct"><option value="">— action solve —</option></select>
      <button data-act="solve" title="Tandai Solved">✔️ Solve</button>
      <button data-act="close" title="Tutup tiket">🔒 Close</button>
    </div>
    <div id="actMsg" class="muted"></div>
    <div class="stepper">${steps}</div>
    ${cur === 'Hold' ? '<div class="muted">⏸️ Tiket ini sedang di-Hold.</div>' : ''}
    <h3>⏱️ Waktu (KPI) <button id="btnCopyDyn" title="Copy siap-paste ke Dynamics">📋 Copy</button></h3>
    <dl class="kv">
      <dt>Mulai dikerjakan</dt><dd>${esc(startOf(t) || 'belum diambil')}</dd>
      <dt>Selesai / close</dt><dd>${esc(endOf(t) || 'belum selesai')}</dd>
      <dt>Respon</dt><dd>${fmtDur(diffMenit(t.create_date, startOf(t)))} (dibuat → diambil)</dd>
      <dt>Pengerjaan</dt><dd>${fmtDur(diffMenit(startOf(t), endOf(t)))} (diambil → close)</dd>
      <dt>Total</dt><dd>${fmtDur(diffMenit(t.create_date, endOf(t)))} (dibuat → close)</dd>
      <dt>Lokasi</dt><dd>${esc(t.pop_location_id?.[1] || '-')}</dd>
    </dl>
    <h3>Detail</h3>
    <p><b>${esc(t.name || '')}</b></p>
    <dl class="kv">
      <dt>Customer</dt><dd>${esc(t.ca_name || t.partner_id?.[1] || '-')} (${esc(t.customer_id || '-')})</dd>
      <dt>Team / Teknisi</dt><dd>${esc(t.team_id?.[1] || '-')} / ${esc(t.user_id?.[1] || '-')}</dd>
      <dt>Prioritas / Severity</dt><dd>${esc(t.priority || '-')} / ${esc(t.severity || '-')}</dd>
      <dt>Tipe / Channel</dt><dd>${esc(t.ticket_type_id?.[1] || '-')} / ${esc(t.channel_id?.[1] || '-')}</dd>
      <dt>Dibuat / Update</dt><dd>${esc(t.create_date || '')} / ${esc(t.write_date || '')}</dd>
      <dt>Solved / Closed</dt><dd>${esc(t.solved_date || '-')} / ${esc(t.closed_date || '-')}</dd>
      <dt>SLA</dt><dd>${esc(t.sla_type_id?.[1] || '-')} ${t.is_sla_impact ? '⚠️ berdampak' : ''}</dd>
      <dt>Downtime</dt><dd>${esc(t.downtime_start || '-')} → ${esc(t.downtime_end || '-')} (${esc(t.downtime_duration_hours ?? 0)} jam)</dd>
      <dt>Umur tiket</dt><dd>${esc(t.age_ticket ?? '-')} hari ${t.is_gamas ? '• GAMAS' : ''}</dd>
      <dt>Kontak</dt><dd>${esc(t.pic_customer || '-')} ${esc(t.phone_customer || '')} ${esc(t.contact_info || '')}</dd>
    </dl>
    <h3>Deskripsi</h3><pre class="desc">${esc(t.description_text || '-')}</pre>
    ${t.action_description ? `<h3>Action</h3><pre class="desc">${esc(t.action_description)}</pre>` : ''}
    <h3>Update terakhir (${j.messages.length})</h3>
    ${j.messages.map((m) => `<div class="msg"><b>${esc(m.author)}</b> <span class="muted">${esc(m.date)}</span><br>${esc(m.text).slice(0, 600)}</div>`).join('') || '<div class="muted">Belum ada log.</div>'}`;
  $('drawer').classList.remove('hidden');
  const bcd = $('btnCopyDyn');
  if (bcd) bcd.onclick = (e) => { e.stopPropagation(); copyText(ticketCopyText(t), bcd); };
  // --- tombol aksi (nulis ke Odoo, selalu konfirmasi dulu) ---
  let solveActs = null;
  const msg = (s) => { $('actMsg').textContent = s; };
  const post = async (op, extra = {}) => {
    const r = await fetch('/api/tickets/' + t.id + '/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...extra }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  };
  $('detail').querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => {
      const op = b.dataset.act;
      try {
        b.disabled = true;
        if (op === 'accept') {
          if (!confirm('Ambil tiket ' + (t.number || '') + ' (assign ke kamu)?')) return;
          const j = await post('accept');
          msg('✅ Diambil. Stage: ' + (j.stage || '-'));
        } else if (op === 'hold') {
          const reason = prompt('Alasan Hold (wajib):');
          if (!reason?.trim()) return;
          if (!confirm('Hold tiket ' + (t.number || '') + '?')) return;
          const j = await post('hold', { reason: reason.trim() });
          msg('⏸️ Di-hold. Stage: ' + (j.stage || '-'));
        } else if (op === 'resume') {
          if (!confirm('Resume tiket ' + (t.number || '') + ' dari Hold?')) return;
          const j = await post('resume');
          msg('▶️ Di-resume. Stage: ' + (j.stage || '-'));
        } else if (op === 'solve') {
          if (!solveActs) {
            solveActs = (await api('/api/solve-actions')).actions || [];
            $('solveAct').innerHTML = '<option value="">— action solve —</option>' +
              solveActs.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
          }
          const aid = $('solveAct').value;
          if (!aid) { msg('Pilih action solve dulu di dropdown.'); return; }
          const reason = prompt('Catatan penyelesaian (boleh kosong):') ?? '';
          if (!confirm('Solve tiket ' + (t.number || '') + '?')) return;
          const j = await post('solve', { actionId: aid, reason });
          msg('✔️ Solved. Stage: ' + (j.stage || '-'));
        } else if (op === 'close') {
          const reason = prompt('Catatan penutupan (boleh kosong):') ?? '';
          if (!confirm('CLOSE tiket ' + (t.number || '') + '? Tiket hilang dari list terbuka.')) return;
          const j = await post('close', { reason });
          msg('🔒 Closed. Stage: ' + (j.stage || '-'));
        }
        refreshAll(false);
        openDetail(t.id);
      } catch (e) {
        msg('⚠️ Gagal: ' + e.message);
      } finally {
        b.disabled = false;
      }
    };
  });
}

async function refreshAll(manual) {
  $('syncbar').classList.remove('hidden');
  try {
    if (manual) await api('/api/refresh');
    await loadMeta();
    await Promise.all([loadOpen(), loadTickets(), loadKpi(), loadStats()]);
    if ($('fTeam').value || $('fStage').value || $('fChannel').value || $('fQ').value.trim()) {
      try { checkNotif((await api('/api/tickets?scope=latest')).tickets); } catch { /* abaikan */ }
    }
    const h = await api('/api/health');
    $('dot').className = 'dot ' + (h.ok ? 'on' : 'off');
    $('statusText').textContent = h.ok ? 'live — tersambung ke Odoo' : ('putus: ' + (h.err || ''));
    $('syncText').textContent = 'sinkron ' + new Date(h.cachedAt || Date.now()).toLocaleTimeString('id-ID');
    $('err').classList.add('hidden');
  } catch (e) {
    $('dot').className = 'dot off';
    $('statusText').textContent = 'putus — coba lagi otomatis…';
    const box = $('err');
    box.textContent = '⚠️ ' + e.message + ' (data lama tetap ditampilkan)';
    box.classList.remove('hidden');
  } finally {
    $('syncbar').classList.add('hidden');
  }
}

$('btnRefresh').onclick = () => refreshAll(true);
$('drawerClose').onclick = () => $('drawer').classList.add('hidden');
$('drawer').onclick = (e) => { if (e.target.id === 'drawer') $('drawer').classList.add('hidden'); };
$('btnNotif').onclick = async () => {
  // toggle sekali klik — tanpa popup izin, tanpa petunjuk
  const off = localStorage.getItem('hdl_notif') === 'off';
  localStorage.setItem('hdl_notif', off ? 'on' : 'off');
  paintNotifBtn();
  if (off) {
    notify('🔔 Notifikasi aktif', 'Tiket baru / update bakal muncul di sini + bunyi');
    // coba sekalian aktifin bawaan browser kalau belum pernah ditanya
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* abaikan */ }
    }
  }
};
for (const id of ['fStage', 'fTeam', 'fChannel']) $(id).onchange = () => {
  localStorage.setItem('hdl_team', $('fTeam').value);
  loadTickets();
  loadKpi();
};
$('btnCibitung').onclick = () => {
  $('fStage').value = ''; $('fChannel').value = ''; $('fQ').value = '';
  $('fTeam').value = '17';
  localStorage.setItem('hdl_team', '17');
  loadTickets();
  loadKpi();
  document.querySelector('#page-tiket .tblwrap').scrollIntoView({ behavior: 'smooth' });
};
let qT = null;
$('fQ').oninput = () => { clearTimeout(qT); qT = setTimeout(loadTickets, 300); };
let l2T = null;
$('fL2Q').oninput = () => { clearTimeout(l2T); l2T = setTimeout(loadL2Recent, 300); };
$('fMonthL2').onchange = () => { $('fMonthKpi').value = $('fMonthL2').value; loadL2Recent(); loadKpi(); };
$('fMonthKpi').onchange = () => { $('fMonthL2').value = $('fMonthKpi').value; loadL2Recent(); loadKpi(); };
$('fUnsub').onchange = loadL2Recent;
$('sideQ').oninput = () => {
  document.querySelector('.nav[data-page="tiket"]').click();
  $('fQ').value = $('sideQ').value;
  loadTickets();
};

(async () => {
  paintNotifBtn();
  fillMonths();
  const savedTeam = localStorage.getItem('hdl_team') || '17';
  $('openList').innerHTML = '<tr><td colspan="7"><div class="skel">memuat…</div></td></tr>';
  $('ticketList').innerHTML = '<tr><td colspan="8"><div class="skel">memuat…</div></td></tr>';
  await refreshAll(false);
  if (!$('fTeam').value && [...$('fTeam').options].some((o) => o.value === savedTeam)) {
    $('fTeam').value = savedTeam;
    loadTickets();
    loadKpi();
  }
  pollTimer = setInterval(() => refreshAll(false), 60000);
})();
