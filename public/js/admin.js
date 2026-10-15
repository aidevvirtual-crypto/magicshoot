(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = ms => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  const STATE_LABEL = { ready: 'Menunggu START', countdown: 'Hitung mundur', playing: 'Bermain', done: 'Selesai', queued: 'Antre' };

  let token = sessionStorage.getItem('ms_admin');
  let tab = 'dash';
  let liveTimer = null;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { logout(); throw new Error('Sesi habis'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.style.background = bad ? 'var(--bad)' : 'var(--good)';
    t.style.color = bad ? '#fff' : '#10200a';
    t.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ---------------------------------------------------------------- auth
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('#login-err').textContent = '';
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $('#login-err').textContent = data.error || 'Gagal'; return; }
    token = data.token;
    sessionStorage.setItem('ms_admin', token);
    enter();
  });
  function logout() {
    token = null;
    sessionStorage.removeItem('ms_admin');
    clearInterval(liveTimer);
    $('#main').hidden = true;
    $('#login').hidden = false;
  }
  $('#logout').addEventListener('click', logout);

  function enter() {
    $('#login').hidden = true;
    $('#main').hidden = false;
    switchTab(tab);
  }

  // ---------------------------------------------------------------- tabs
  document.querySelectorAll('nav [data-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  function switchTab(t) {
    tab = t;
    document.querySelectorAll('nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t; });
    clearInterval(liveTimer);
    if (t === 'dash') { loadDash(); liveTimer = setInterval(loadLive, 1000); }
    if (t === 'scores') loadScores();
    if (t === 'players') loadPlayers();
    if (t === 'settings') loadSettings();
  }

  // ---------------------------------------------------------------- dashboard
  async function loadDash() {
    const s = await api('GET', '/api/admin/stats');
    $('#stats').innerHTML = [
      ['Pemain terdaftar', s.players], ['Total permainan', s.games], ['Skor tertinggi', s.topScore], ['Total bat ditembak', s.totalHits],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><small>${k}</small></div>`).join('');
    loadLive();
  }
  async function loadLive() {
    try {
      const L = await api('GET', '/api/admin/live');
      $('#live-meta').textContent = `· ${L.displays} layar terhubung`;
      $('#join-link').href = L.joinUrl;
      $('#join-link').textContent = L.joinUrl;
      $('#lan').textContent = L.lan.length ? `IP LAN: ${L.lan.join(', ')}` : '';
      $('#live-active').innerHTML = L.active.length ? L.active.map(p => `<tr>
        <td>${p.slot + 1}</td>
        <td><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)} ${p.connected ? '' : '<span class="pill">offline</span>'}</td>
        <td>${STATE_LABEL[p.state] || p.state}</td>
        <td class="num">${p.score}</td>
        <td class="num">${p.hits}/${p.shots}</td>
        <td class="num">${p.remaining ? Math.ceil(p.remaining / 1000) + 's' : '-'}</td>
        <td><div class="acts"><button class="btn danger sm" data-kick="${esc(p.pid)}">Keluarkan</button></div></td>
      </tr>`).join('') : '<tr><td colspan="7" class="muted">Tidak ada yang bermain.</td></tr>';
      $('#live-queue').innerHTML = L.queue.length ? L.queue.map((p, i) => `<tr>
        <td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.connected ? 'online' : '<span class="pill">offline</span>'}</td>
        <td><div class="acts"><button class="btn danger sm" data-kick="${esc(p.pid)}">Hapus</button></div></td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted">Antrean kosong.</td></tr>';
    } catch (e) { /* ignore transient errors */ }
  }
  document.addEventListener('click', async e => {
    const k = e.target.closest('[data-kick]');
    if (!k) return;
    await api('POST', `/api/admin/live/kick/${k.dataset.kick}`);
    toast('Pemain dikeluarkan');
    loadLive();
  });

  // ---------------------------------------------------------------- scores
  let scoreSearchT;
  $('#score-search').addEventListener('input', () => { clearTimeout(scoreSearchT); scoreSearchT = setTimeout(loadScores, 250); });
  async function loadScores() {
    const { rows, total } = await api('GET', `/api/admin/scores?limit=500&search=${encodeURIComponent($('#score-search').value)}`);
    $('#score-rows').innerHTML = rows.length ? rows.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${esc(r.name)}</td>
      <td class="num"><b>${r.score}</b></td><td class="num">${r.hits}</td><td class="num">${r.shots}</td>
      <td class="num">${r.shots ? Math.round(r.hits / r.shots * 100) : 0}%</td>
      <td>${fmtTime(r.playedAt)}</td>
      <td><div class="acts">
        <button class="btn sm" data-edit-score="${r.id}" data-val="${r.score}">Ubah</button>
        <button class="btn danger sm" data-del-score="${r.id}">Hapus</button>
      </div></td></tr>`).join('') : '<tr><td colspan="8" class="muted">Belum ada skor.</td></tr>';
    $('#score-total').textContent = `${total} permainan`;
  }
  $('#score-rows').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-score]');
    const del = e.target.closest('[data-del-score]');
    if (ed) {
      const v = prompt('Skor baru:', ed.dataset.val);
      if (v === null) return;
      await api('PUT', `/api/admin/scores/${ed.dataset.editScore}`, { score: Number(v) });
      toast('Skor diubah'); loadScores();
    }
    if (del && confirm('Hapus skor ini?')) {
      await api('DELETE', `/api/admin/scores/${del.dataset.delScore}`);
      toast('Skor dihapus'); loadScores();
    }
  });
  $('#reset-scores').addEventListener('click', async () => {
    if (!confirm('Reset SEMUA skor? Leaderboard akan kosong. Tindakan ini tidak bisa dibatalkan.')) return;
    await api('DELETE', '/api/admin/scores');
    toast('Semua skor direset'); loadScores();
  });

  // ---------------------------------------------------------------- players
  let playerSearchT;
  $('#player-search').addEventListener('input', () => { clearTimeout(playerSearchT); playerSearchT = setTimeout(loadPlayers, 250); });
  async function loadPlayers() {
    const { rows, total } = await api('GET', `/api/admin/players?limit=500&search=${encodeURIComponent($('#player-search').value)}`);
    $('#player-rows').innerHTML = rows.length ? rows.map(r => `<tr>
      <td>${r.id}</td><td>${esc(r.name)}</td><td class="num">${r.games}</td><td class="num"><b>${r.best}</b></td>
      <td>${fmtTime(r.createdAt)}</td><td>${fmtTime(r.lastPlayed)}</td>
      <td><div class="acts">
        <button class="btn sm" data-rename="${r.id}" data-name="${esc(r.name)}">Ganti nama</button>
        <button class="btn danger sm" data-del-player="${r.id}">Hapus</button>
      </div></td></tr>`).join('') : '<tr><td colspan="7" class="muted">Belum ada pemain.</td></tr>';
    $('#player-total').textContent = `${total} pemain`;
  }
  $('#player-rows').addEventListener('click', async e => {
    const rn = e.target.closest('[data-rename]');
    const del = e.target.closest('[data-del-player]');
    try {
      if (rn) {
        const v = prompt('Nama baru:', rn.dataset.name);
        if (!v) return;
        await api('PUT', `/api/admin/players/${rn.dataset.rename}`, { name: v });
        toast('Nama diubah'); loadPlayers();
      }
      if (del && confirm('Hapus pemain ini beserta semua skornya?')) {
        await api('DELETE', `/api/admin/players/${del.dataset.delPlayer}`);
        toast('Pemain dihapus'); loadPlayers();
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#reset-all').addEventListener('click', async () => {
    if (!confirm('Hapus SEMUA pemain dan skor? Tindakan ini tidak bisa dibatalkan.')) return;
    await api('DELETE', '/api/admin/all');
    toast('Semua data dihapus'); loadPlayers();
  });

  // ---------------------------------------------------------------- settings
  const forms = () => document.querySelectorAll('#settings-form, #settings-form-2, #settings-form-3');
  async function loadSettings() {
    const s = await api('GET', '/api/admin/settings');
    forms().forEach(f => {
      for (const el of f.elements) {
        if (!el.name || el.name === 'adminPassword') continue;
        if (el.type === 'checkbox') el.checked = !!s[el.name];
        else el.value = s[el.name] ?? '';
      }
    });
  }
  forms().forEach(f => f.addEventListener('submit', e => { e.preventDefault(); $('#save-settings').click(); }));
  $('#save-settings').addEventListener('click', async () => {
    const body = {};
    forms().forEach(f => {
      for (const el of f.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') body[el.name] = el.checked;
        else if (el.name === 'adminPassword') { if (el.value) body[el.name] = el.value; }
        else body[el.name] = el.value;
      }
    });
    try {
      await api('PUT', '/api/admin/settings', body);
      document.querySelector('[name=adminPassword]').value = '';
      toast('Pengaturan disimpan & diterapkan');
      loadSettings();
    } catch (err) { toast(err.message, true); }
  });

  if (token) enter();
})();
