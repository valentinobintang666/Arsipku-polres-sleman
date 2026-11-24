let currentUser = null,
  currentPage = 'dashboard',
  query = '',
  userQuery = '';
const APPROVAL_REMINDER_INTERVAL = 6 * 60 * 60 * 1000,
  APPROVAL_OVERDUE_AFTER = 24 * 60 * 60 * 1000;
let letters = [],
  users = [],
  activityLogs = [];
let activityQuery = '';

async function apiRequest(action, data = null, method = 'POST') {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    }
  };
  if (data instanceof FormData) {
    options.body = data;
  } else if (data !== null) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  const response = await fetch(`api.php?action=${encodeURIComponent(action)}`, options);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Respons backend tidak dapat dibaca. Pastikan PHP berjalan dan konfigurasi database benar.');
  }
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal diproses.');
  return result;
}

function applyState(state) {
  currentUser = state.user;
  letters = state.letters || [];
  users = state.users || [];
  activityLogs = state.activityLogs || [];
}

async function refreshState() {
  const state = await apiRequest('state', null, 'GET');
  if (!state.authenticated) {
    currentUser = null;
    letters = [];
    users = [];
    activityLogs = [];
    document.getElementById('appView').classList.add('hidden');
    document.getElementById('loginView').classList.remove('hidden');
    throw new Error('Sesi login telah berakhir. Silakan masuk kembali.');
  }
  applyState(state);
}

async function postMutation(action, data) {
  await apiRequest(action, data);
  await refreshState();
}

function showApiError(error) {
  toast(error instanceof Error ? error.message : 'Permintaan gagal diproses.');
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
}

function dateFmt(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function updateClock() {
  const clock = document.getElementById('clockLabel');
  if (clock) clock.textContent = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
}
setInterval(updateClock, 1000);
updateClock();

function pendingApprovals() {
  return letters.filter(x => x.status === 'Menunggu Persetujuan');
}

function letterCreatedAt(letter) {
  const saved = letter.createdAt ? new Date(letter.createdAt).getTime() : NaN;
  return Number.isFinite(saved) ? saved : new Date((letter.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00').getTime();
}

function overdueApprovals(now = Date.now()) {
  return pendingApprovals().filter(x => now - letterCreatedAt(x) >= APPROVAL_OVERDUE_AFTER);
}

function updateApprovalBadge() {
  const badge = document.getElementById('approvalBadge'),
    nav = document.getElementById('approvalNav');
  if (!badge) return;
  const pending = pendingApprovals().length,
    overdue = overdueApprovals().length;
  badge.textContent = pending;
  badge.classList.toggle('urgent', overdue > 0);
  if (nav) nav.title = overdue ? `${overdue} surat menunggu lebih dari 24 jam` : pending ? `${pending} surat menunggu persetujuan` : 'Tidak ada surat menunggu';
}

function checkApprovalReminders() {
  updateApprovalBadge();
  if (currentUser?.role !== 'atasan') return;
  const pending = pendingApprovals();
  if (!pending.length) return;
  const overdue = overdueApprovals(),
    signature = pending.map(x => x.id).sort().join(','),
    now = Date.now(),
    lastAt = Number(localStorage.getItem('arsipku_lastSupervisorNotice') || 0),
    lastSignature = localStorage.getItem('arsipku_lastSupervisorSignature') || '',
    newPending = signature !== lastSignature;
  if (!newPending && now - lastAt < APPROVAL_REMINDER_INTERVAL) return;
  const title = overdue.length ? 'Persetujuan surat terlambat' : 'Surat menunggu persetujuan',
    message = overdue.length ? `${overdue.length} surat menunggu lebih dari 24 jam. Mohon segera ditinjau.` : `Ada ${pending.length} surat masuk/keluar yang menunggu persetujuan.`;
  toast(message);
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, {
    body: message,
    tag: 'arsipku-approval-reminder'
  });
  localStorage.setItem('arsipku_lastSupervisorNotice', String(now));
  localStorage.setItem('arsipku_lastSupervisorSignature', signature);
}

function enableSupervisorNotifications() {
  if (!('Notification' in window)) {
    toast('Browser ini tidak mendukung notifikasi desktop.');
    return;
  }
  if (Notification.permission === 'denied') {
    toast('Izin notifikasi diblokir. Ubah izin situs melalui pengaturan browser.');
    return;
  }
  Notification.requestPermission().then(permission => {
    toast(permission === 'granted' ? 'Notifikasi atasan berhasil diaktifkan.' : 'Izin notifikasi belum diberikan.');
    if (permission === 'granted') checkApprovalReminders();
  });
}

function generateLetterNumber(type, date) {
  const parsed = new Date((date || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const year = parsed.getFullYear(),
    month = parsed.getMonth() + 1,
    roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][month - 1],
    code = type === 'Masuk' ? 'SM' : 'SK',
    prefix = `/ARSIP/${code}/`,
    sequence = letters.reduce((max, letter) => {
      if (letter.type !== type) return max;
      const match = String(letter.number || '').match(new RegExp(`^(\\d+)\\/ARSIP\\/${code}\\/[IVX]+\\/${year}$`));
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return `${String(sequence).padStart(3,'0')}${prefix}${roman}/${year}`;
}

function roleName(r) {
  return ({
    admin: 'Administrator',
    pegawai: 'Pegawai',
    atasan: 'Atasan'
  })[r] || r;
}

function isProfileImage(photo) {
  return typeof photo === 'string' && ['data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,'].some(prefix => photo.startsWith(prefix));
}

function renderProfileHeader() {
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userRole').textContent = roleName(currentUser.role);
  const avatar = document.getElementById('userAvatar');
  avatar.replaceChildren();
  if (isProfileImage(currentUser.photo)) {
    const image = document.createElement('img');
    image.src = currentUser.photo;
    image.alt = 'Foto profil ' + currentUser.name;
    avatar.appendChild(image);
  } else avatar.textContent = (currentUser.name || '?').charAt(0).toUpperCase();
}

function visibleLetters() {
  return currentUser.role === 'pegawai' ? letters.filter(x => x.creatorUsername === currentUser.username || (!x.creatorUsername && x.creator === currentUser.name)) : letters;
}

function canDeleteLetters() {
  return currentUser?.role === 'admin' || currentUser?.role === 'atasan';
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const error = document.getElementById('loginError');
  error.textContent = '';
  try {
    await apiRequest('login', {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
      role: document.getElementById('loginRole').value
    });
    await refreshState();
    startApp();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
});
document.getElementById('passwordToggle').addEventListener('click', () => {
  const input = document.getElementById('password'),
    button = document.getElementById('passwordToggle'),
    visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  button.querySelector('.password-eye-open').hidden = !visible;
  button.querySelector('.password-eye-closed').hidden = visible;
});

function startApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('appView').classList.toggle('role-tech-theme', currentUser.role === 'atasan' || currentUser.role === 'pegawai');
  document.getElementById('appView').classList.toggle('admin-cyber-theme', currentUser.role === 'admin');
  renderProfileHeader();
  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  updateClock();
  document.getElementById('usersNav').classList.toggle('hidden', currentUser.role !== 'admin');
  document.getElementById('activityNav').classList.toggle('hidden', currentUser.role !== 'admin');
  document.getElementById('approvalNav').classList.toggle('hidden', currentUser.role !== 'atasan' && currentUser.role !== 'admin');
  render();
  checkApprovalReminders();
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="alertdialog" aria-modal="true" aria-labelledby="logoutConfirmTitle" aria-describedby="logoutConfirmMessage"><div class="modal-head"><h3 id="logoutConfirmTitle">Konfirmasi keluar</h3></div><div class="modal-body"><p id="logoutConfirmMessage">Apakah Anda yakin ingin keluar dari akun?</p></div><div class="modal-foot"><button id="cancelLogoutBtn" class="btn secondary" type="button">Batal</button><button id="confirmLogoutBtn" class="btn primary" type="button">Ya, keluar</button></div></section></div>`;

  const closeConfirmation = () => {
    root.innerHTML = '';
    document.getElementById('logoutBtn').focus();
    document.removeEventListener('keydown', handleEscape);
  };
  const handleEscape = e => {
    if (e.key === 'Escape') closeConfirmation();
  };

  document.getElementById('cancelLogoutBtn').addEventListener('click', closeConfirmation);
  document.getElementById('confirmLogoutBtn').addEventListener('click', async () => {
    try {
      await apiRequest('logout');
    } catch (error) {
      showApiError(error);
      return;
    }
    root.innerHTML = '';
    document.removeEventListener('keydown', handleEscape);
    currentUser = null;
    letters = [];
    users = [];
    activityLogs = [];
    currentPage = 'dashboard';
    query = '';
    activityQuery = '';
    document.getElementById('appView').classList.add('hidden');
    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('loginForm').reset();
  });
  document.addEventListener('keydown', handleEscape);
  document.getElementById('cancelLogoutBtn').focus();
});
setInterval(() => {
  if (currentUser?.role === 'atasan') checkApprovalReminders();
}, 60000);
document.getElementById('navigation').addEventListener('click', e => {
  const b = e.target.closest('[data-page]');
  if (!b) return;
  currentPage = b.dataset.page;
  query = '';
  render();
});

function setActive() {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === currentPage));
}

function render() {
  setActive();
  const titles = {
    dashboard: 'Dashboard',
    incoming: 'Surat Masuk',
    outgoing: 'Surat Keluar',
    archive: 'Dokumen',
    approval: 'Persetujuan Surat',
    users: 'Manajemen Pengguna',
    activity: 'Riwayat Aktivitas'
  };
  document.getElementById('breadcrumb').textContent = titles[currentPage] || 'Dashboard';
  updateApprovalBadge();
  const root = document.getElementById('pageContent');
  if (currentPage === 'dashboard') root.innerHTML = dashboard();
  else if (currentPage === 'incoming' || currentPage === 'outgoing') root.innerHTML = letterPage(currentPage);
  else if (currentPage === 'archive') root.innerHTML = archivePage();
  else if (currentPage === 'approval') root.innerHTML = approvalPage();
  else if (currentPage === 'users') root.innerHTML = usersPage();
  else if (currentPage === 'activity') root.innerHTML = activityPage();
  else root.innerHTML = dashboard();
  root.classList.remove('page-switching');
  void root.offsetWidth;
  root.classList.add('page-switching');
}

function pageHead(title, desc, action = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div><div class="head-actions">${action}</div></div>`;
}

function activityPage() {
  if (currentUser?.role !== 'admin') return '<div class="notice">Anda tidak memiliki akses ke halaman ini.</div>';
  return `${pageHead('Riwayat Aktivitas','Catatan siapa yang menambahkan, mengedit, menyetujui, menolak, atau menghapus surat.')}<div class="panel"><div class="table-tools"><div class="search"><input id="activitySearch" placeholder="Cari nama, aktivitas, nomor, atau perihal surat..." value="${esc(activityQuery)}" oninput="activityQuery=this.value;refreshActivity()"></div><span class="muted">${activityLogs.length} aktivitas</span></div><div id="activityTable">${activityTableMarkup()}</div></div>`;
}

function activityTableMarkup() {
  const term = activityQuery.trim().toLowerCase();
  const rows = activityLogs.filter(item => [item.actor, item.actorUsername, item.action, item.letterNumber, item.letterSubject, item.letterType, item.details].join(' ').toLowerCase().includes(term)).slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if (!rows.length) return `<div class="empty">${term?'Belum ada riwayat aktivitas yang cocok.':'Belum ada riwayat aktivitas. Aktivitas surat berikutnya akan tercatat di sini.'}</div>`;
  return `<div class="table-wrap activity-table-wrap"><table><thead><tr><th>WAKTU</th><th>AKTIVITAS</th><th>SURAT</th><th>DILAKUKAN OLEH</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${esc(new Date(item.at).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}))}</td><td><b>${esc(item.action)}</b>${item.details?`<span class="subtext">${esc(item.details)}</span>`:''}</td><td><span class="doc-title">${esc(item.letterNumber)}</span><span class="subtext">${esc(item.letterType)} · ${esc(item.letterSubject)}</span></td><td>${esc(item.actor)}<span class="subtext">${esc(roleName(item.actorRole))}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function refreshActivity() {
  const target = document.getElementById('activityTable');
  if (target) target.innerHTML = activityTableMarkup();
}

function dashboard() {
  const data = visibleLetters(),
    incoming = data.filter(x => x.type === 'Masuk'),
    outgoing = data.filter(x => x.type === 'Keluar'),
    pending = letters.filter(x => x.status === 'Menunggu Persetujuan');
  return `${pageHead('Selamat datang, '+esc(currentUser.name),'Berikut ringkasan aktivitas persuratan instansi Anda.')}<div class="stats">
<div class="stat-card"><div class="stat-top">Total surat <span class="stat-icon" style="background:#edf3ff;color:#3469dc">▤</span></div><div class="stat-value">${data.length}</div><div class="stat-note">Data surat yang dapat Anda akses</div></div>
<div class="stat-card"><div class="stat-top">Surat masuk <span class="stat-icon" style="background:#e8f7f1;color:#168765">↓</span></div><div class="stat-value">${incoming.length}</div><div class="stat-note">Dokumen diterima instansi</div></div>
<div class="stat-card"><div class="stat-top">Surat keluar <span class="stat-icon" style="background:#fff5df;color:#b7791f">↑</span></div><div class="stat-value">${outgoing.length}</div><div class="stat-note">Dokumen diterbitkan instansi</div></div>
<div class="stat-card"><div class="stat-top">Perlu persetujuan <span class="stat-icon" style="background:#fff0ef;color:#c44949">◷</span></div><div class="stat-value">${currentUser.role==='pegawai'?'—':pending.length}</div><div class="stat-note">${currentUser.role==='pegawai'?'Dikelola oleh atasan':'Menunggu keputusan atasan'}</div></div></div>
<div class="split"><div class="panel"><div class="panel-head"><div><h3>Surat terbaru</h3><p>Daftar surat yang terakhir dicatat</p></div><button class="btn secondary" onclick="goPage('incoming')">Lihat semua</button></div>${tableMarkup(data.slice().sort((a,b)=>b.id-a.id).slice(0,5),false)}</div>
<div><div class="panel"><div class="panel-head"><div><h3>Akses cepat</h3><p>Pilih aktivitas yang ingin dilakukan</p></div></div><div class="quick-grid"><button class="quick" onclick="openLetterForm('Masuk')"><span>↓</span><b>Catat surat masuk</b><small>Input surat yang diterima</small></button><button class="quick" onclick="openLetterForm('Keluar')"><span>↑</span><b>Buat surat keluar</b><small>Ajukan surat untuk dikirim</small></button></div></div>
<div class="panel"><div class="panel-head"><div><h3>Informasi sistem</h3><p>Hak akses akun Anda</p></div></div><div class="activity"><div class="activity-dot"></div><div><b>Login sebagai ${roleName(currentUser.role)}</b><p>${currentUser.role==='admin'?'Dapat mengelola seluruh data dan pengguna.':currentUser.role==='atasan'?'Dapat meninjau dan menyetujui surat masuk maupun keluar.':'Dapat mencatat surat dan memantau surat milik sendiri.'}</p></div></div></div></div></div>`;
}

function goPage(p) {
  currentPage = p;
  render();
}

function letterPage(kind) {
  const type = kind === 'incoming' ? 'Masuk' : 'Keluar',
    data = visibleLetters().filter(x => x.type === type);
  const canAdd = currentUser.role !== 'atasan';
  return `${pageHead('Surat '+(type==='Masuk'?'Masuk':'Keluar'),type==='Masuk'?'Catat surat yang sudah diterima dari instansi luar, gunakan nomor pada dokumen aslinya.':'Pembuatan, pengajuan, dan pemantauan surat yang diterbitkan.',canAdd?`<button class="btn primary" onclick="openLetterForm('${type}')">＋ ${type==='Masuk'?'Catat surat dari luar':'Buat surat keluar'}</button>`:'')}<div class="panel"><div class="table-tools"><div class="search"><input id="tableSearch" placeholder="Cari nomor, perihal, pengirim..." value="${esc(query)}" oninput="query=this.value;refreshTable('${kind}')"></div><span class="muted">${data.length} data surat</span></div><div id="letterTable">${tableMarkup(data)}</div></div>`;
}

function statusBadge(s) {
  let c = s === 'Disetujui' ? 'approved' : s === 'Menunggu Persetujuan' ? 'pending' : s === 'Ditolak' ? 'rejected' : s === 'Perlu Revisi' ? 'revision' : 'info';
  return `<span class="status ${c}">${esc(s)}</span>`;
}

function tableMarkup(rows, showActions = true) {
  rows = filterLetters(rows);
  if (!rows.length) return '<div class="empty">Belum ada data surat yang cocok.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>NOMOR / PERIHAL</th><th>TANGGAL</th><th>${rows[0].type==='Masuk'?'PENGIRIM':'TUJUAN'}</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${rows.map(x=>`<tr><td><span class="doc-title">${esc(x.number)}</span><span class="subtext">${esc(x.subject)}</span></td><td>${dateFmt(x.date)}</td><td>${esc(x.type==='Masuk'?x.sender:x.recipient)}</td><td>${statusBadge(x.status)}${x.status==='Perlu Revisi'?'<span class="subtext late-label">Periksa catatan atasan</span>':''}</td><td><div class="actions"><button class="icon-btn" title="Detail" onclick="showDetail(${x.id})">Detail</button>${currentUser.role==='pegawai'&&x.status==='Perlu Revisi'&&(x.creatorUsername===currentUser.username||(!x.creatorUsername&&x.creator===currentUser.name))?`<button class="btn primary" onclick="openRevisionEditForm(${x.id})">Perbaiki & kirim ulang</button>`:''}${canDeleteLetters()?`<button class="icon-btn" title="Hapus surat" onclick="deleteLetter(${x.id})">Hapus</button>`:''}${currentUser.role==='atasan'&&x.status==='Menunggu Persetujuan'?`<button class="btn secondary" onclick="openRevisionRequestForm(${x.id})">Minta revisi</button><button class="btn danger" onclick="decideLetter(${x.id},'Ditolak')">Tolak</button><button class="btn primary" onclick="decideLetter(${x.id},'Disetujui')">Setujui</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`;
}

function filterLetters(rows, term = query) {
  const searchTerm = term.trim().toLocaleLowerCase('id-ID');
  if (!searchTerm) return rows;
  return rows.filter(letter =>
    [letter.number, letter.subject, letter.sender, letter.recipient]
      .some(value => String(value || '').toLocaleLowerCase('id-ID').includes(searchTerm))
  );
}

function refreshTable(kind) {
  const type = kind === 'incoming' ? 'Masuk' : 'Keluar';
  document.getElementById('letterTable').innerHTML = tableMarkup(visibleLetters().filter(x => x.type === type));
}

function openLetterForm(type) {
  if (currentUser.role === 'atasan') {
    toast('Akun atasan tidak dapat menambahkan surat.');
    return;
  }
  const incoming = type === 'Masuk',
    root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>${incoming?'Catat surat dari luar':'Buat surat keluar'}</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="letterForm"><div class="modal-body"><div class="form-grid">
<div class="field"><label>${incoming?'Nomor surat dari instansi *':'Nomor surat otomatis'}</label><input id="generatedLetterNumber" name="number" ${incoming?'required placeholder="Masukkan nomor yang tertera pada surat"':'readonly'}></div>
<div class="field"><label>Tanggal surat *</label><input id="letterDate" name="date" type="date" required value="${new Date().toISOString().slice(0,10)}" ${incoming?'':'oninput="document.getElementById(\'generatedLetterNumber\').value=generateLetterNumber(\'Keluar\',this.value)"'}></div>
<div class="field full-field"><label>Perihal *</label><input name="subject" required placeholder="Judul atau perihal surat"></div>
<div class="field"><label>${type==='Masuk'?'Asal / Pengirim':'Pengirim / Bagian'}</label><input name="sender" required placeholder="Nama instansi atau bagian"></div>
<div class="field"><label>${type==='Masuk'?'Penerima':'Tujuan surat'}</label><input name="recipient" required placeholder="Nama penerima atau instansi"></div>
<div class="field full-field"><label>Keterangan</label><textarea name="notes" placeholder="Catatan tambahan (opsional)"></textarea></div>
${incoming?'<div class="field full-field"><label>Lampiran surat (opsional)</label><input name="attachment" type="file" accept=".pdf,image/png,image/jpeg,image/webp"><small>Format PDF, JPG, PNG, atau WebP. Maksimum 1,5 MB.</small></div>':''}</div><p class="muted">${incoming?'Catat surat yang sudah diterima dari instansi luar. Nomor surat mengikuti dokumen asli dan data akan dikirim ke atasan untuk persetujuan.':'Surat keluar akan langsung dikirim ke atasan untuk dimintakan persetujuan.'}</p></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Batal</button><button class="btn primary">${incoming?'Catat & kirim untuk persetujuan':'Kirim untuk persetujuan'}</button></div></form></div></div>`;
  if (!incoming) document.getElementById('generatedLetterNumber').value = generateLetterNumber(type, document.getElementById('letterDate').value);
  document.getElementById('letterForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target),
      file = f.get('attachment');
    if (file instanceof File && file.size) {
      if (file.size > 1.5 * 1024 * 1024) {
        toast('Ukuran lampiran maksimal 1,5 MB.');
        return;
      }
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast('Lampiran harus PDF, JPG, PNG, atau WebP.');
        return;
      }
    }
    const number = incoming ? f.get('number').trim() : generateLetterNumber(type, f.get('date'));
    f.set('type', type);
    f.set('number', number);
    try {
      await apiRequest('letter-create', f);
      await refreshState();
      closeModal();
      render();
      checkApprovalReminders();
      toast(incoming ? 'Surat dari luar berhasil dicatat dan dikirim ke atasan.' : 'Surat berhasil dikirim ke atasan untuk persetujuan.');
    } catch (error) {
      showApiError(error);
    }
  });
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}
async function compressProfileImage(file) {
  const image = await createImageBitmap(file),
    scale = Math.min(1, 512 / Math.max(image.width, image.height)),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Tidak dapat memproses gambar.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas.toDataURL('image/jpeg', .84);
}

function openProfileForm() {
  const preview = isProfileImage(currentUser.photo) ? `<img src="${esc(currentUser.photo)}" alt="Foto profil">` : esc((currentUser.name || '?').charAt(0).toUpperCase());
  let selectedPhoto = currentUser.photo || '';
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal profile-modal"><div class="modal-head"><h3>Edit profil</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="profileForm"><div class="modal-body"><div class="profile-photo-row"><div id="profilePhotoPreview" class="profile-avatar-preview">${preview}</div><div class="profile-photo-field"><label for="profilePhotoInput">Foto profil</label><input id="profilePhotoInput" type="file" accept="image/png,image/jpeg,image/webp"><small>Format JPG, PNG, atau WebP. Maksimum 3 MB.</small></div></div><div class="field"><label for="profileName">Nama tampilan *</label><input id="profileName" name="name" required maxlength="80" value="${esc(currentUser.name)}"></div><p class="muted">Foto dan nama profil ini akan digunakan pada semua halaman akun Anda.</p></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Batal</button><button class="btn primary">Simpan profil</button></div></form></div></div>`;
  document.getElementById('profilePhotoInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Pilih gambar JPG, PNG, atau WebP.');
      e.target.value = '';
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast('Ukuran foto maksimal 3 MB.');
      e.target.value = '';
      return;
    }
    try {
      selectedPhoto = await compressProfileImage(file);
      document.getElementById('profilePhotoPreview').innerHTML = `<img src="${selectedPhoto}" alt="Pratinjau foto profil">`;
    } catch {
      toast('Foto gagal diproses. Coba pilih gambar lain.');
    }
  });
  document.getElementById('profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await postMutation('profile-update', {
        name: new FormData(e.target).get('name').trim(),
        photo: selectedPhoto
      });
      renderProfileHeader();
      closeModal();
      render();
      toast('Profil berhasil diperbarui.');
    } catch (error) {
      showApiError(error);
    }
  });
}

function downloadLetter(id) {
  const x = letters.find(a => a.id === id);
  if (!x) return;
  const typeLabel = x.type === 'Masuk' ? 'Surat Masuk' : 'Surat Keluar';
  const content = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(x.number)} - ${esc(x.subject)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #edf2f7;
      color: #1d2b3d;
      font: 14px/1.6 Arial, Helvetica, sans-serif;
    }
    .sheet {
      width: min(840px, calc(100% - 32px));
      margin: 32px auto;
      padding: 48px 56px;
      background: #fff;
      border: 1px solid #e1e8f0;
      box-shadow: 0 16px 48px #23364d18;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      padding-bottom: 22px;
      border-bottom: 2px solid #23466c;
    }
    .brand-mark {
      display: grid;
      width: 46px;
      height: 46px;
      place-items: center;
      border-radius: 12px;
      background: #23466c;
      color: #fff;
      font-size: 24px;
      font-weight: 700;
    }
    .brand-name { margin: 0; color: #183653; font-size: 17px; letter-spacing: 1.4px; }
    .brand-caption { margin: 2px 0 0; color: #6b7b8e; font-size: 11px; letter-spacing: 1px; }
    .document-heading { margin: 32px 0 22px; }
    .eyebrow { margin: 0 0 5px; color: #3974ac; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
    h1 { margin: 0; color: #1d2b3d; font-size: 25px; line-height: 1.25; }
    .subject {
      margin: 20px 0 24px;
      padding: 17px 20px;
      border-left: 4px solid #3974ac;
      border-radius: 0 8px 8px 0;
      background: #f3f7fb;
    }
    .subject-label { display: block; margin-bottom: 4px; color: #718198; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    .subject strong { color: #1d3855; font-size: 17px; }
    .type-pill {
      display: inline-block;
      margin-top: 12px;
      padding: 4px 10px;
      border: 1px solid #d5e4f2;
      border-radius: 20px;
      background: #fff;
      color: #35658f;
      font-size: 11px;
      font-weight: 700;
    }
    h2 { margin: 28px 0 10px; color: #294663; font-size: 13px; letter-spacing: .4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #e8edf2; text-align: left; vertical-align: top; }
    th { width: 32%; color: #6b7b8e; font-size: 12px; font-weight: 600; }
    td { color: #24364a; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
    .notes {
      min-height: 70px;
      padding: 14px 16px;
      border: 1px solid #e5ebf1;
      border-radius: 8px;
      color: #40536a;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .footer {
      margin-top: 34px;
      padding-top: 14px;
      border-top: 1px solid #e5ebf1;
      color: #8290a0;
      font-size: 10px;
    }
    .actions { margin-top: 24px; text-align: right; }
    button {
      padding: 10px 16px;
      border: 0;
      border-radius: 7px;
      background: #23466c;
      color: white;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    @media (max-width: 600px) {
      .sheet { width: 100%; margin: 0; padding: 28px 22px; border: 0; box-shadow: none; }
      th { width: 38%; }
    }
    @media print {
      body { background: #fff; font-size: 12px; }
      .sheet { width: auto; margin: 0; padding: 0; border: 0; box-shadow: none; }
      .actions { display: none; }
      .subject, .brand-mark, .type-pill { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="brand">
      <div class="brand-mark" aria-hidden="true">A</div>
      <div>
        <p class="brand-name"><strong>ARSIPKU</strong></p>
        <p class="brand-caption">SISTEM PENGELOLAAN SURAT</p>
      </div>
    </header>
    <section class="document-heading">
      <p class="eyebrow">Dokumen administrasi</p>
      <h1>Lembar Informasi Surat</h1>
      <div class="subject">
        <span class="subject-label">Perihal</span>
        <strong>${esc(x.subject)}</strong>
        <br><span class="type-pill">${typeLabel}</span>
      </div>
    </section>
    <h2>Informasi surat</h2>
    <table>
      <tbody>
        <tr><th scope="row">Nomor surat</th><td>${esc(x.number)}</td></tr>
        <tr><th scope="row">Tanggal surat</th><td>${esc(dateFmt(x.date))}</td></tr>
        <tr><th scope="row">Pengirim</th><td>${esc(x.sender || '-')}</td></tr>
        <tr><th scope="row">Penerima / tujuan</th><td>${esc(x.recipient || '-')}</td></tr>
        <tr><th scope="row">Dicatat oleh</th><td>${esc(x.creator || '-')}</td></tr>
        <tr><th scope="row">Status</th><td>${esc(x.status)}</td></tr>
      </tbody>
    </table>
    <h2>Keterangan</h2>
    <div class="notes">${esc(x.notes || 'Tidak ada keterangan.')}</div>
    <footer class="footer">Dokumen informasi arsip yang dihasilkan oleh ArsipKu. Bukan naskah surat resmi.</footer>
    <div class="actions"><button onclick="window.print()">Cetak / Simpan sebagai PDF</button></div>
  </main>
</body>
</html>`;
  const blob = new Blob([content], {
      type: 'text/html;charset=utf-8'
    }),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = `${String(x.number).replace(/[^a-z0-9-]/gi,'_')}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('File surat berhasil diunduh.');
}

function showDetail(id) {
  const x = letters.find(a => a.id === id);
  if (!x) return;
  let buttons = '';
  if (currentUser.role === 'atasan' && x.status === 'Menunggu Persetujuan') buttons = `<button class="btn secondary" onclick="openRevisionRequestForm(${id})">Kembalikan untuk revisi</button><button class="btn danger" onclick="decideLetter(${id},'Ditolak')">Tolak</button><button class="btn primary" onclick="decideLetter(${id},'Disetujui')">Setujui surat</button>`;
  const deleteButton = canDeleteLetters() ? `<button class="btn danger" onclick="deleteLetter(${id})">Hapus surat</button>` : '',
    revisionInfo = x.revisionNote ? `<div class="revision-note"><b>Catatan revisi dari atasan</b><p>${esc(x.revisionNote)}</p></div>` : '',
    history = x.revisionHistory?.length ? `<div class="revision-history"><b>Riwayat revisi</b>${x.revisionHistory.map(item=>`<p><span>${esc(item.action)} · ${dateFmt(item.date.slice(0,10))}</span>${item.note?`<br>${esc(item.note)}`:''}</p>`).join('')}</div>` : '',
    attachment = x.attachment ? `<div class="detail-row"><span>Lampiran</span><b>${esc(x.attachment.name)}</b></div>` : '';
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>Detail surat</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><div class="modal-body">${[['Jenis surat',x.type],['Nomor surat',x.number],['Perihal',x.subject],['Tanggal',dateFmt(x.date)],['Pengirim',x.sender],['Penerima / Tujuan',x.recipient],['Dibuat oleh',x.creator],['Status',x.status],['Keterangan',x.notes||'-']].map(([k,v])=>`<div class="detail-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}${attachment}${revisionInfo}${history}</div><div class="modal-foot"><button class="btn secondary" onclick="closeModal()">Tutup</button>${x.attachment?`<button class="btn secondary" onclick="downloadAttachment(${id})">Unduh lampiran</button>`:''}<button class="btn secondary" onclick="downloadLetter(${id})">Unduh data surat</button>${currentUser.role==='pegawai'&&x.status==='Perlu Revisi'&&(x.creatorUsername===currentUser.username||(!x.creatorUsername&&x.creator===currentUser.name))?`<button class="btn primary" onclick="openRevisionEditForm(${id})">Perbaiki surat</button>`:''}${deleteButton}${buttons}</div></div></div>`;
}

function openRevisionRequestForm(id) {
  if (currentUser?.role !== 'atasan') {
    toast('Hanya atasan yang dapat meminta revisi.');
    return;
  }
  const letter = letters.find(item => item.id === id);
  if (!letter || letter.status !== 'Menunggu Persetujuan') return;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>Kembalikan surat untuk revisi</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="revisionRequestForm"><div class="modal-body"><p class="muted">Surat <b>${esc(letter.number)}</b> akan dikembalikan kepada ${esc(letter.creator)} untuk diperbaiki.</p><div class="field"><label>Catatan revisi untuk pegawai *</label><textarea name="revisionNote" required minlength="5" maxlength="1000" placeholder="Jelaskan bagian yang harus diperbaiki"></textarea></div></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="showDetail(${id})">Batal</button><button class="btn primary">Kirim kembali ke pegawai</button></div></form></div></div>`;
  document.getElementById('revisionRequestForm').addEventListener('submit', async e => {
    e.preventDefault();
    const note = new FormData(e.target).get('revisionNote').trim();
    if (note.length < 5) {
      toast('Catatan revisi minimal 5 karakter.');
      return;
    }
    try {
      await postMutation('letter-revision', { id, revisionNote: note });
      closeModal();
      render();
      toast('Surat dikembalikan ke pegawai untuk diperbaiki.');
    } catch (error) {
      showApiError(error);
    }
  });
}

function openRevisionEditForm(id) {
  if (currentUser?.role !== 'pegawai') {
    toast('Hanya pegawai pemilik surat yang dapat memperbaiki surat.');
    return;
  }
  const letter = letters.find(item => item.id === id);
  if (!letter || letter.status !== 'Perlu Revisi' || (letter.creatorUsername !== currentUser.username && letter.creator !== currentUser.name)) {
    toast('Surat ini tidak tersedia untuk revisi.');
    return;
  }
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>Perbaiki surat dan kirim ulang</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="revisionEditForm"><div class="modal-body"><div class="revision-note"><b>Catatan atasan</b><p>${esc(letter.revisionNote||'Mohon periksa kembali surat.')}</p></div><div class="field"><label>Nomor surat</label><input value="${esc(letter.number)}" disabled></div><div class="field"><label>Perihal *</label><input name="subject" value="${esc(letter.subject)}" required></div><div class="form-grid"><div class="field"><label>Tanggal surat *</label><input name="date" type="date" value="${esc(letter.date)}" required></div><div class="field"><label>Pengirim *</label><input name="sender" value="${esc(letter.sender)}" required></div><div class="field"><label>Penerima / Tujuan *</label><input name="recipient" value="${esc(letter.recipient)}" required></div></div><div class="field"><label>Keterangan</label><textarea name="notes">${esc(letter.notes||'')}</textarea></div></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Batal</button><button class="btn primary">Simpan dan kirim ulang</button></div></form></div></div>`;
  document.getElementById('revisionEditForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await postMutation('letter-resubmit', {
        id,
        subject: form.get('subject').trim(),
        date: form.get('date'),
        sender: form.get('sender').trim(),
        recipient: form.get('recipient').trim(),
        notes: form.get('notes').trim()
      });
      closeModal();
      render();
      toast('Surat hasil revisi dikirim kembali ke atasan.');
    } catch (error) {
      showApiError(error);
    }
  });
}

function downloadAttachment(id) {
  const letter = letters.find(item => item.id === id);
  if (!letter?.attachment?.url) return;
  const link = document.createElement('a');
  link.href = letter.attachment.url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function decideLetter(id, status) {
  if (currentUser?.role !== 'atasan') {
    toast('Hanya atasan yang dapat memutuskan persetujuan surat.');
    return;
  }
  if (!['Disetujui', 'Ditolak'].includes(status)) {
    toast('Keputusan tidak valid.');
    return;
  }
  try {
    await postMutation('letter-decision', { id, status });
    closeModal();
    render();
    toast('Surat berhasil ' + (status === 'Disetujui' ? 'disetujui.' : 'ditolak.'));
  } catch (error) {
    showApiError(error);
  }
}

async function deleteLetter(id) {
  if (!canDeleteLetters()) {
    toast('Hanya admin atau atasan yang dapat menghapus surat.');
    return;
  }
  const letter = letters.find(item => item.id === id);
  if (!letter) return;
  if (!confirm(`Hapus surat "${letter.subject}"? Tindakan ini tidak dapat dibatalkan.`)) return;
  try {
    await postMutation('letter-delete', { id });
    closeModal();
    render();
    toast('Surat berhasil dihapus.');
  } catch (error) {
    showApiError(error);
  }
}

function approvalPage() {
  if (currentUser.role !== 'admin' && currentUser.role !== 'atasan') return '<div class="notice">Anda tidak memiliki akses ke halaman ini.</div>';
  const rows = letters.filter(x => x.type === 'Keluar'),
    pending = pendingApprovals(),
    overdue = overdueApprovals();
  const action = currentUser.role === 'atasan' ? `<button class="btn secondary" onclick="enableSupervisorNotifications()">🔔 Aktifkan notifikasi</button>` : '';
  const notice = overdue.length ? `<div class="notice overdue-notice">Perhatian: ${overdue.length} surat telah menunggu lebih dari 24 jam. Mohon segera ditinjau agar proses tidak terlambat.</div>` : '<div class="notice">Pengingat otomatis akan mengecek surat tertunda setiap menit dan mengingatkan kembali setiap 6 jam. Surat yang menunggu lebih dari 24 jam ditandai terlambat.</div>';
  return `${pageHead('Persetujuan surat','Tinjau surat keluar dan berikan keputusan persetujuan.',action)}${notice}<div class="panel"><div class="panel-head"><div><h3>Daftar surat keluar</h3><p>${pending.length} surat menunggu keputusan${overdue.length?` · ${overdue.length} terlambat`:''}</p></div></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>NOMOR / PERIHAL</th><th>TANGGAL</th><th>DIAJUKAN OLEH</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${rows.map(x=>`<tr><td><span class="doc-title">${esc(x.number)}</span><span class="subtext">${esc(x.subject)}</span></td><td>${dateFmt(x.date)}</td><td>${esc(x.creator)}</td><td>${statusBadge(x.status)}${x.status==='Menunggu Persetujuan'&&Date.now()-letterCreatedAt(x)>=APPROVAL_OVERDUE_AFTER?'<span class="subtext late-label">Terlambat &gt; 24 jam</span>':''}</td><td><div class="actions"><button class="icon-btn" onclick="showDetail(${x.id})">Tinjau</button>${canDeleteLetters()?`<button class="btn danger" onclick="deleteLetter(${x.id})">Hapus</button>`:''}${currentUser.role==='atasan'&&x.status==='Menunggu Persetujuan'?`<button class="btn secondary" onclick="openRevisionRequestForm(${x.id})">Minta revisi</button><button class="btn danger" onclick="decideLetter(${x.id},'Ditolak')">Tolak</button><button class="btn primary" onclick="decideLetter(${x.id},'Disetujui')">Setujui</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Belum ada surat keluar.</div>'}</div>`;
}

function usersPage() {
  if (currentUser.role !== 'admin') return '';
  const term = userQuery.trim().toLowerCase(),
    visible = users.filter(user => [user.username, user.name, roleName(user.role)].join(' ').toLowerCase().includes(term)),
    activeCount = users.filter(user => user.active !== false).length,
    suspendedCount = users.length - activeCount;
  return `${pageHead('Manajemen pengguna','Kelola akun, status akses, dan peran pengguna.',`<button class="btn primary" onclick="openUserForm()">＋ Tambah pengguna</button>`)}<div class="user-admin-stats"><div class="user-admin-stat"><span>Total akun</span><b>${users.length}</b></div><div class="user-admin-stat"><span>Akun aktif</span><b>${activeCount}</b></div><div class="user-admin-stat"><span>Ditangguhkan</span><b>${suspendedCount}</b></div></div><div class="notice">Perubahan akun diproses dan disimpan melalui server.</div><div class="panel"><div class="table-tools"><div class="search"><input id="userSearch" placeholder="Cari nama pengguna atau peran..." value="${esc(userQuery)}" oninput="userQuery=this.value;refreshUsers()"></div><span class="muted">${visible.length} dari ${users.length} akun</span></div><div id="usersTable">${usersTableMarkup(visible)}</div></div>`;
}

function usersTableMarkup(rows) {
  if (!rows.length) return '<div class="empty">Tidak ada akun yang cocok.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>NAMA PENGGUNA</th><th>NAMA TAMPILAN</th><th>PERAN</th><th>STATUS AKSES</th><th>AKSI ADMIN</th></tr></thead><tbody>${rows.map(user=>{const suspended=user.active===false;return `<tr><td><b>${esc(user.username)}</b></td><td>${esc(user.name)}</td><td><span class="status info">${roleName(user.role)}</span></td><td><span class="status ${suspended?'rejected':'approved'}">${suspended?'Ditangguhkan':'Aktif'}</span></td><td><div class="actions"><button class="icon-btn" onclick="openEditUserForm('${esc(user.username)}')">Edit</button><button class="icon-btn" onclick="toggleUserSuspension('${esc(user.username)}')">${suspended?'Aktifkan':'Tangguhkan'}</button><button class="icon-btn" onclick="openResetPasswordForm('${esc(user.username)}')">Reset sandi</button><button class="icon-btn" onclick="deleteUser('${esc(user.username)}')">Hapus</button></div></td></tr>`;}).join('')}</tbody></table></div>`;
}

function refreshUsers() {
  const target = document.getElementById('usersTable');
  if (target) target.innerHTML = usersTableMarkup(users.filter(user => [user.username, user.name, roleName(user.role)].join(' ').toLowerCase().includes(userQuery.trim().toLowerCase())));
}

function openUserForm() {
  if (currentUser?.role !== 'admin') return;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>Tambah pengguna</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="userForm"><div class="modal-body"><div class="field"><label>Nama pengguna *</label><input name="username" required maxlength="40" pattern="[A-Za-z0-9._-]+" title="Gunakan huruf, angka, titik, garis bawah, atau tanda hubung." autocomplete="off"></div><div class="field"><label>Nama lengkap *</label><input name="name" required maxlength="80"></div><div class="field"><label>Kata sandi awal *</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div><div class="field"><label>Peran *</label><select name="role"><option value="pegawai">Pegawai</option><option value="atasan">Atasan</option><option value="admin">Admin</option></select></div></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Batal</button><button class="btn primary">Buat akun</button></div></form></div></div>`;
  document.getElementById('userForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target),
      username = f.get('username').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(username)) {
      toast('Nama pengguna hanya boleh berisi huruf, angka, titik, _ atau -.');
      return;
    }
    try {
      await postMutation('user-create', {
        username,
        name: f.get('name').trim(),
        password: f.get('password'),
        role: f.get('role')
      });
      closeModal();
      render();
      toast('Akun pengguna berhasil dibuat.');
    } catch (error) {
      showApiError(error);
    }
  });
}

function openEditUserForm(username) {
  if (currentUser?.role !== 'admin') return;
  const user = users.find(item => item.username === username);
  if (!user) return;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>Edit akun pengguna</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="editUserForm"><div class="modal-body"><div class="field"><label>Nama pengguna</label><input value="${esc(user.username)}" disabled></div><div class="field"><label>Nama lengkap *</label><input name="name" value="${esc(user.name)}" required maxlength="80"></div><div class="field"><label>Peran *</label><select name="role" ${user.username===currentUser.username?'disabled':''}><option value="pegawai" ${user.role==='pegawai'?'selected':''}>Pegawai</option><option value="atasan" ${user.role==='atasan'?'selected':''}>Atasan</option><option value="admin" ${user.role==='admin'?'selected':''}>Admin</option></select>${user.username===currentUser.username?'<small>Peran akun yang sedang digunakan tidak dapat diubah.</small>':''}</div></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Batal</button><button class="btn primary">Simpan perubahan</button></div></form></div></div>`;
  document.getElementById('editUserForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await postMutation('user-update', {
        username: user.username,
        name: form.get('name').trim(),
        role: form.get('role') || user.role
      });
      closeModal();
      render();
      toast('Informasi pengguna diperbarui.');
    } catch (error) {
      showApiError(error);
    }
  });
}

async function toggleUserSuspension(username) {
  if (currentUser?.role !== 'admin') {
    toast('Hanya admin yang dapat mengubah status akses pengguna.');
    return;
  }
  const user = users.find(item => item.username === username);
  if (!user) return;
  const activate = user.active === false;
  try {
    await postMutation('user-suspension', { username });
    render();
    toast(activate ? 'Akun berhasil diaktifkan.' : 'Akun berhasil ditangguhkan.');
  } catch (error) {
    showApiError(error);
  }
}

function openResetPasswordForm(username) {
  if (currentUser?.role !== 'admin') return;
  const user = users.find(item => item.username === username);
  if (!user) return;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>Atur ulang kata sandi</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><form id="resetPasswordForm"><div class="modal-body"><p class="muted">Atur kata sandi baru untuk akun <b>${esc(user.username)}</b>.</p><div class="field"><label>Kata sandi baru *</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div></div><div class="modal-foot"><button type="button" class="btn secondary" onclick="closeModal()">Batal</button><button class="btn primary">Simpan kata sandi</button></div></form></div></div>`;
  document.getElementById('resetPasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await postMutation('user-password', {
        username: user.username,
        password: new FormData(e.target).get('password')
      });
      closeModal();
      render();
      toast('Kata sandi berhasil diatur ulang.');
    } catch (error) {
      showApiError(error);
    }
  });
}

async function deleteUser(username) {
  if (currentUser?.role !== 'admin') {
    toast('Hanya admin yang dapat menghapus akun.');
    return;
  }
  const user = users.find(item => item.username === username);
  if (!user) return;
  if (!confirm(`Hapus akun "${user.username}"? Surat yang pernah dicatat oleh akun ini tidak ikut dihapus.`)) return;
  try {
    await postMutation('user-delete', { username });
    render();
    toast('Akun pengguna dihapus.');
  } catch (error) {
    showApiError(error);
  }
}

function approvedLetters() {
  return letters.filter(letter => letter.status === 'Disetujui');
}

function archivePage() {
  const rows = approvedLetters();
  const filteredRows = filterLetters(rows);
  return `${pageHead('Dokumen','Surat masuk dan keluar yang telah disetujui. Cari dokumen berdasarkan nomor surat, perihal, pengirim, atau tujuan.')}<div class="panel"><div class="table-tools"><div class="search"><input id="archiveSearch" type="search" aria-label="Cari dokumen" placeholder="Cari nomor surat, perihal, pengirim, atau tujuan..." value="${esc(query)}" oninput="query=this.value;refreshArchive()"></div><span class="muted" id="archiveCount">${filteredRows.length}${query.trim()?` dari ${rows.length}`:''} dokumen</span></div><div id="archiveTable">${tableMarkup(rows,false)}</div></div>`;
}

function refreshArchive() {
  const target = document.getElementById('archiveTable');
  const rows = approvedLetters(),
    filteredRows = filterLetters(rows),
    count = document.getElementById('archiveCount');
  if (target) target.innerHTML = tableMarkup(rows, false);
  if (count) count.textContent = `${filteredRows.length}${query.trim()?` dari ${rows.length}`:''} dokumen`;
}
approvalPage = function() {
  if (currentUser.role !== 'admin' && currentUser.role !== 'atasan') return '<div class="notice">Anda tidak memiliki akses ke halaman ini.</div>';
  const rows = letters.slice().sort((a, b) => b.id - a.id),
    pending = pendingApprovals(),
    overdue = overdueApprovals(),
    action = currentUser.role === 'atasan' ? `<button class="btn secondary" onclick="enableSupervisorNotifications()">🔔 Aktifkan notifikasi</button>` : '',
    notice = overdue.length ? `<div class="notice overdue-notice">Perhatian: ${overdue.length} surat telah menunggu lebih dari 24 jam. Mohon segera ditinjau.</div>` : '<div class="notice">Surat masuk dan surat keluar baru akan langsung masuk ke daftar ini untuk ditinjau atasan.</div>';
  return `${pageHead('Persetujuan surat','Tinjau dan setujui surat masuk maupun surat keluar.',action)}${notice}<div class="panel"><div class="panel-head"><div><h3>Daftar surat</h3><p>${pending.length} surat menunggu keputusan${overdue.length?` · ${overdue.length} terlambat`:''}</p></div></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>JENIS</th><th>NOMOR / PERIHAL</th><th>TANGGAL</th><th>DIAJUKAN OLEH</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.type)}</td><td><span class="doc-title">${esc(x.number)}</span><span class="subtext">${esc(x.subject)}</span></td><td>${dateFmt(x.date)}</td><td>${esc(x.creator)}</td><td>${statusBadge(x.status)}${x.status==='Menunggu Persetujuan'&&Date.now()-letterCreatedAt(x)>=APPROVAL_OVERDUE_AFTER?'<span class="subtext late-label">Terlambat &gt; 24 jam</span>':''}</td><td><div class="actions"><button class="icon-btn" onclick="showDetail(${x.id})">Tinjau</button>${canDeleteLetters()?`<button class="btn danger" onclick="deleteLetter(${x.id})">Hapus</button>`:''}${currentUser.role==='atasan'&&x.status==='Menunggu Persetujuan'?`<button class="btn secondary" onclick="openRevisionRequestForm(${x.id})">Minta revisi</button><button class="btn danger" onclick="decideLetter(${x.id},'Ditolak')">Tolak</button><button class="btn primary" onclick="decideLetter(${x.id},'Disetujui')">Setujui</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Belum ada surat yang tercatat.</div>'}</div>`;
};

(async function restoreSession() {
  try {
    const state = await apiRequest('state', null, 'GET');
    if (!state.authenticated) return;
    applyState(state);
    startApp();
  } catch (error) {
    document.getElementById('loginError').textContent = error.message;
  }
})();