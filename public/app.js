// Dashboard lokal CMS: polling /api/*, diff buat notifikasi desktop + bunyi.
const $ = (id) => document.getElementById(id);
const seenKey = 'hdl_seen_v1';
const seen = JSON.parse(localStorage.getItem(seenKey) || '{}');
const saveSeen = () => localStorage.setItem(seenKey, JSON.stringify(seen));
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
  $('openCount').textContent = meta.openCount ?? '–';
  $('navOpen').textContent = meta.openCount ?? '';
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
    const k = await api('/api/kpi-l2?team=' + teamId);
    $('l2Count').textContent = k.total ?? '–';
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
    const recent = await api('/api/l2?team=' + teamId + '&q=' + encodeURIComponent(q));
    box.innerHTML = ((recent.logs || []).map((lg) => {
      const dur = diffMenit(lg.start_time, lg.end_time);
      return `<tr><td class="t">${esc(lg.ticket_id?.[1] || ('#' + lg.id))}</td>
        <td>${esc(lg.user_id?.[1] || '-')}</td><td>${esc(lg.activity_id?.[1] || '-')}</td>
        <td>${esc(lg.start_time || '-')}</td><td>${esc(lg.end_time || 'jalan…')}</td>
        <td>${dur === null ? '…' : fmtDur(dur)}</td><td>${esc(lg.reason || '-')}</td></tr>`;
    }).join('')) || '<tr><td colspan="7" class="muted">Tidak ketemu.</td></tr>';
  } catch (e) {
    box.innerHTML = '<tr><td colspan="7" class="muted">Gagal: ' + esc(e.message) + '</td></tr>';
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
}

async function refreshAll(manual) {
  $('syncbar').classList.remove('hidden');
  try {
    if (manual) await api('/api/refresh');
    await loadMeta();
    await Promise.all([loadOpen(), loadTickets(), loadKpi()]);
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
  $('btnNotif').textContent = r === 'granted' ? '🔔 Aktif' : '🔕 Ditolak';
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
  document.querySelector('#page-tiket .tblwrap').scrollIntoView({ behavior: 'smooth' });
};
let qT = null;
$('fQ').oninput = () => { clearTimeout(qT); qT = setTimeout(loadTickets, 300); };
let l2T = null;
$('fL2Q').oninput = () => { clearTimeout(l2T); l2T = setTimeout(loadL2Recent, 300); };

(async () => {
  if (Notification.permission === 'granted') $('btnNotif').textContent = '🔔 Aktif';
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
