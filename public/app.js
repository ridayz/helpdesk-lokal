// Dashboard lokal: polling /api/*, diff buat notifikasi desktop + bunyi.
const $ = (id) => document.getElementById(id);
const seenKey = 'hdl_seen_v1';
const seen = JSON.parse(localStorage.getItem(seenKey) || '{}');
const saveSeen = () => localStorage.setItem(seenKey, JSON.stringify(seen));
let meta = null;
let pollTimer = null;

function badgeClass(stage) {
  return 'badge ' + String(stage || '').replace(/\s/g, '');
}
function rowHtml(t) {
  const stage = t.stage_id?.[1] || '-';
  const team = t.team_id?.[1] || '-';
  const s = startOf(t), e = endOf(t);
  const waktu = e ? `⏱ ${fmtDur(diffMenit(t.create_date, e))}` : (s ? '🔧 dikerjakan' : '🆕 nunggu diambil');
  return `<div class="t">${esc(t.number || '')} — ${esc(t.name || '')}</div>
    <div class="m"><span class="${badgeClass(stage)}">${esc(stage)}</span>
    <span>👥 ${esc(team)}</span><span>👤 ${esc(t.user_id?.[1] || 'belum assigned')}</span>
    <span>🏢 ${esc(t.ca_name || t.partner_id?.[1] || '')}</span>
    <span>${waktu}</span>
    <span>🕒 ${esc(t.write_date || '')}</span></div>`;
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
  $('openCount').textContent = meta.openCount ?? '–';
  $('totalCount').textContent = meta.total ?? '–';
  $('stageCards').innerHTML = (meta.byStage || []).map((g) =>
    `<span class="stage"><b>${g.__count}</b> ${esc(g.stage_id?.[1] || '?')}</span>`).join('');
  const closed = (meta.byStage || []).find((g) => g.stage_id?.[1] === 'Closed')?.__count || 0;
  const pct = meta.total ? Math.round((closed / meta.total) * 100) : 0;
  $('solveBar').style.width = pct + '%';
  $('solvePct').textContent = pct + '% selesai (' + closed + '/' + (meta.total ?? '?') + ')';
  const fill = (el, items, label) => {
    const cur = $(el).value;
    $(el).innerHTML = `<option value="">${label}</option>` + items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    $(el).value = cur;
  };
  fill('fStage', meta.stages || [], 'Semua stage');
  fill('fTeam', meta.teams || [], 'Semua team');
  fill('fChannel', meta.channels || [], 'Semua channel');
}

async function loadTickets() {
  const hasFilter = $('fStage').value || $('fTeam').value || $('fChannel').value || $('fQ').value.trim();
  const box = $('ticketList');
  if (hasFilter) {
    // cari live ke Odoo biar tembus semua tiket, bukan cuma cache
    box.innerHTML = '<div class="skel">mencari…</div>';
    const q = new URLSearchParams({ stage: $('fStage').value, team: $('fTeam').value, channel: $('fChannel').value, q: $('fQ').value.trim() });
    const j = await api('/api/search?' + q);
    box.innerHTML = j.tickets.length ? '' : '<div class="muted">Tidak ada tiket cocok di seluruh database.</div>';
    for (const t of j.tickets) {
      const d = document.createElement('div');
      d.className = 'row'; d.innerHTML = rowHtml(t);
      d.onclick = () => openDetail(t.id);
      box.appendChild(d);
    }
    return;
  }
  const q = new URLSearchParams({ scope: 'latest' });
  const j = await api('/api/tickets?' + q);
  box.innerHTML = j.tickets.length ? '' : '<div class="muted">Tidak ada tiket cocok.</div>';
  for (const t of j.tickets) {
    const d = document.createElement('div');
    d.className = 'row'; d.innerHTML = rowHtml(t);
    d.onclick = () => openDetail(t.id);
    box.appendChild(d);
  }
  checkNotif(j.tickets);
}

async function loadKpi() {
  const teamId = $('fTeam').value || '17';
  const teamName = $('fTeam').value
    ? ($('fTeam').selectedOptions[0]?.text || '')
    : 'L2 Field Ops Access - Cibitung';
  $('kpiTeam').textContent = teamName;
  try {
    const [k, recent] = await Promise.all([
      api('/api/kpi-l2?team=' + teamId),
      api('/api/l2?team=' + teamId),
    ]);
    $('kpiCards').innerHTML = `
      <div class="card"><div class="num" style="font-size:30px">${fmtDur(k.avgMenit)}</div><div class="lbl">Rata-rata penanganan (ambil→selesai)</div></div>
      <div class="card"><div class="num">${k.selesai}/${k.total}</div><div class="lbl">Penanganan selesai</div></div>
      <div class="card"><div class="num">${k.jalan}</div><div class="lbl">Masih jalan (belum end)</div></div>`;
    $('kpiUsers').innerHTML = k.users.length ? '' : '<div class="muted">Belum ada data.</div>';
    for (const usr of k.users) {
      const d = document.createElement('div');
      d.className = 'row';
      d.innerHTML = `<div class="t">${esc(usr.name)}</div>
        <div class="m"><span>🛠️ ${usr.total} penanganan</span><span>⏱ rata-rata ${fmtDur(usr.avgMenit)}</span></div>`;
      $('kpiUsers').appendChild(d);
    }
    $('kpiActs').innerHTML = (k.acts || []).map((a) =>
      `<div class="row"><div class="t" style="font-size:16px">${esc(a.name)}</div>
      <div class="m"><span>🛠️ ${a.total}x</span><span>⏱ rata-rata ${fmtDur(a.avgMenit)}</span></div></div>`).join('')
      || '<div class="muted">Belum ada data.</div>';
    $('kpiRecent').innerHTML = (recent.logs || []).length ? '' : '<div class="muted">Belum ada data.</div>';
    for (const lg of (recent.logs || [])) {
      const d = document.createElement('div');
      d.className = 'row';
      const dur = diffMenit(lg.start_time, lg.end_time);
      d.innerHTML = `<div class="t" style="font-size:16px">${esc(lg.ticket_id?.[1] || ('#' + lg.id))}</div>
        <div class="m"><span>👤 ${esc(lg.user_id?.[1] || '-')}</span><span>🧰 ${esc(lg.activity_id?.[1] || '-')}</span>
        <span>▶ ${esc(lg.start_time || '-')}</span><span>⏹ ${esc(lg.end_time || 'jalan…')}</span>
        <span>⏱ ${dur === null ? '…' : fmtDur(dur)}</span></div>
        ${lg.reason ? `<div class="m">📝 ${esc(lg.reason)}</div>` : ''}`;
      $('kpiRecent').appendChild(d);
    }
  } catch (e) {
    $('kpiCards').innerHTML = '<div class="muted">KPI gagal dimuat: ' + esc(e.message) + '</div>';
  }
}
async function loadOpen() {
  const j = await api('/api/tickets?scope=open');
  $('openListCount').textContent = j.tickets.length + ' tiket';
  const box = $('openList');
  box.innerHTML = j.tickets.length ? '' : '<div class="muted">🎉 Tidak ada tiket terbuka. Aman.</div>';
  for (const t of j.tickets) {
    const d = document.createElement('div');
    d.className = 'row'; d.innerHTML = rowHtml(t);
    d.onclick = () => openDetail(t.id);
    box.appendChild(d);
  }
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

function notify(title, body) {
  if (Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch { /* abaikan */ }
  beep();
}

function checkNotif(tickets) {
  let changed = false;
  for (const t of tickets) {
    const prev = seen[t.id];
    const cur = (t.write_date || '') + '|' + (t.stage_id?.[1] || '');
    if (!prev) {
      notify('🎫 Tiket baru: ' + (t.number || ''), (t.name || '') + ' — ' + (t.stage_id?.[1] || ''));
      changed = true;
    } else if (prev !== cur) {
      notify('🔄 Update: ' + (t.number || ''), (t.name || '') + ' → ' + (t.stage_id?.[1] || ''));
      changed = true;
    }
    seen[t.id] = cur;
  }
  if (changed) saveSeen();
  // buang cache lama biar localStorage ga bengkak
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
    <div class="stepper">${steps}</div>
    ${cur === 'Hold' ? '<div class="muted">⏸️ Tiket ini sedang di-Hold.</div>' : ''}
    <h3>⏱️ Waktu (KPI)</h3>
    <dl class="kv">
      <dt>Mulai dikerjakan</dt><dd>${esc(startOf(t) || 'belum diambil')}</dd>
      <dt>Selesai / close</dt><dd>${esc(endOf(t) || 'belum selesai')}</dd>
      <dt>Respon</dt><dd>${fmtDur(diffMenit(t.create_date, startOf(t)))} (dibuat → diambil)</dd>
      <dt>Pengerjaan</dt><dd>${fmtDur(diffMenit(startOf(t), endOf(t)))} (diambil → close)</dd>
      <dt>Total</dt><dd>${fmtDur(diffMenit(t.create_date, endOf(t)))} (dibuat → close)</dd>
      <dt>Lokasi</dt><dd>${esc(t.pop_location_id?.[1] || '-')}</dd>
    </dl>
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
}

async function refreshAll(manual) {
  $('syncbar').classList.remove('hidden');
  try {
    if (manual) await api('/api/refresh');
    await loadMeta();
    await Promise.all([loadOpen(), loadTickets(), loadKpi()]);
    // notifikasi jalan terus walau filter tim aktif: cek dari cache terbaru
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
  const r = await Notification.requestPermission();
  $('btnNotif').textContent = r === 'granted' ? '🔔 Notifikasi aktif' : '🔕 Izin ditolak';
  if (r === 'granted') beep();
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
  document.querySelector('.toolbar').scrollIntoView({ behavior: 'smooth' });
};
let qT = null;
$('fQ').oninput = () => { clearTimeout(qT); qT = setTimeout(loadTickets, 300); };

(async () => {
  if (Notification.permission === 'granted') $('btnNotif').textContent = '🔔 Notifikasi aktif';
  $('openList').innerHTML = '<div class="skel">memuat…</div><div class="skel">memuat…</div>';
  $('ticketList').innerHTML = '<div class="skel">memuat…</div><div class="skel">memuat…</div><div class="skel">memuat…</div>';
  // ingat team terakhir; default tim Cibitung (17) buat Ridwan
  const savedTeam = localStorage.getItem('hdl_team') || '17';
  await refreshAll(false);
  if (!$('fTeam').value && [...$('fTeam').options].some((o) => o.value === savedTeam)) {
    $('fTeam').value = savedTeam;
    loadTickets();
    loadKpi();
  }
  pollTimer = setInterval(() => refreshAll(false), 60000);
})();
