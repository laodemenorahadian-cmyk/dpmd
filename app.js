(() => {
    // ============================================================
    // KONFIGURASI — sesuaikan dengan Spreadsheet user kamu
    // Sheet harus punya kolom: username | password | nama | role | bidang | status
    // Role yang valid: super_admin / admin_bidang / tamu
    // ============================================================
    const USER_SPREADSHEET_ID = '1aBSadBTJq7lylc-YJyM2_4A-EWlDxd66FCdq41Ylz0w';
    const USER_SHEET_NAMES = ['user', 'users']; // nama tab sheet user yang dicoba berurutan
    // ============================================================

    const loginScreen    = document.getElementById('loginScreen');
    const loginForm      = document.getElementById('loginForm');
    const loginUsername  = document.getElementById('loginUsername');
    const loginPassword  = document.getElementById('loginPassword');
    const loginMessage   = document.getElementById('loginMessage');
    const loginSubmit    = document.getElementById('loginSubmit');
    const guestLoginButton   = document.getElementById('guestLoginButton') || document.querySelector('[data-guest-login]');
    const logoutButton       = document.getElementById('logoutButton');
    const authUserPanel      = document.getElementById('authUserPanel');
    const authUserName       = document.getElementById('authUserName');
    const authUserMeta       = document.getElementById('authUserMeta');
    const manageUsersButton  = document.getElementById('manageUsersButton');
    const userManageModal    = document.getElementById('userManageModal');
    const closeUserManageModal = document.getElementById('closeUserManageModal');
    const userManageContent  = document.getElementById('userManageContent');

    if (!loginScreen || !loginForm) return;

    // ── helpers ──────────────────────────────────────────────────
    const escapeHtml = (v) => String(v ?? '')
        .replaceAll('&','&amp;').replaceAll('<','&lt;')
        .replaceAll('>','&gt;').replaceAll('"','&quot;')
        .replaceAll("'",'&#039;');

    const normalizeText = (v) => String(v || '')
        .toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');

    const normalizeRole = (role) => {
        const n = normalizeText(role);
        if (n === 'admin') return 'super_admin';
        if (n === 'superadmin' || n === 'superadministrator') return 'super_admin';
        if (n === 'adminbidang') return 'admin_bidang';
        if (n === 'tamu' || n === 'guest') return 'tamu';
        return role || 'tamu';
    };

    const roleLabels = {
        super_admin:  'Super Admin',
        admin_bidang: 'Admin Bidang',
        tamu:         'Tamu',
    };

    // ── state ─────────────────────────────────────────────────────
    let currentUser = null;

    // ── UI helpers ────────────────────────────────────────────────
    const setAuthState = (state) => {
        document.body.classList.remove('auth-pending','auth-locked','auth-ready');
        document.body.classList.add(state);
    };

    const setLoginMessage = (msg, type = 'error') => {
        loginMessage.textContent = msg || '';
        loginMessage.classList.toggle('is-success', type === 'success');
    };

    const setLoginBusy = (busy) => {
        loginSubmit.disabled = busy;
        if (guestLoginButton) guestLoginButton.disabled = busy;
        loginUsername.disabled = busy;
        loginPassword.disabled = busy;
    };

    const postJson = async (url, body = {}) => {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
        });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            throw new Error(data.message || 'Permintaan gagal diproses.');
        }

        return data;
    };

    // ── role controls ─────────────────────────────────────────────
    const roleCan = (control) => {
        const role = normalizeRole(currentUser?.role);
        if (control === 'upload')       return Boolean(currentUser) && role !== 'tamu';
        if (control === 'edit')         return Boolean(currentUser) && role !== 'tamu';
        if (control === 'manage-users') return role === 'super_admin';
        return true;
    };

    const applyRoleControls = () => {
        document.querySelectorAll('[data-role-control]').forEach((el) => {
            el.classList.toggle('hidden', !roleCan(el.dataset.roleControl));
        });
    };

    const notifyAuthChange = () => {
        window.dispatchEvent(new CustomEvent('sidoti:auth-change', { detail: { user: currentUser } }));
    };

    // ── apply / lock ──────────────────────────────────────────────
    const applyAuthenticatedUser = (user) => {
        currentUser = { ...user, role: normalizeRole(user.role) };
        window.sidotiAuth = {
            user: currentUser,
            hasRole: (...roles) => roles.map(normalizeRole).includes(currentUser.role),
        };

        authUserPanel?.classList.remove('hidden');
        if (authUserName) authUserName.textContent = currentUser.nama || currentUser.username || 'User';
        if (authUserMeta) {
            const roleLabel = roleLabels[currentUser.role] || currentUser.role;
            const bidang    = currentUser.bidang ? currentUser.bidang.toUpperCase() : 'SEMUA';
            authUserMeta.textContent = `${roleLabel} - ${bidang}`;
        }

        applyRoleControls();
        notifyAuthChange();
        setAuthState('auth-ready');
    };

    const lockApp = () => {
        currentUser    = null;
        window.sidotiAuth = null;
        applyRoleControls();
        notifyAuthChange();
        authUserPanel?.classList.add('hidden');
        setAuthState('auth-locked');
        loginPassword.value = '';
        loginUsername.focus();
    };

    // ── Google Sheets loader ──────────────────────────────────────
    /**
     * Memuat satu sheet via JSONP (tidak butuh API key / backend).
     * Sheet wajib dibagikan "Siapa saja yang punya link bisa melihat".
     */
    const loadSheet = (spreadsheetId, sheetName) => new Promise((resolve, reject) => {
        const cbName = `sidotiGviz_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const script  = document.createElement('script');
        let settled   = false;

        const cleanup = () => { delete window[cbName]; script.remove(); };

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true; cleanup();
            reject(new Error('Koneksi ke Google Sheets timeout. Periksa koneksi internet.'));
        }, 12000);

        window[cbName] = (resp) => {
            if (settled) return;
            settled = true; clearTimeout(timer); cleanup();

            if (!resp || resp.status === 'error') {
                const msg = resp?.errors?.[0]?.detailed_message
                    || resp?.errors?.[0]?.message
                    || `Sheet "${sheetName}" tidak dapat dimuat.`;
                reject(new Error(msg));
                return;
            }

            // Ubah table → array of plain objects
            const headers = resp.table.cols.map((c, i) =>
                normalizeText(c.label || c.id || `col${i}`) || `col${i}`
            );
            const rows = resp.table.rows
                .map((r) => {
                    const obj = {};
                    r.c.forEach((cell, i) => { obj[headers[i]] = cell?.v ?? ''; });
                    return obj;
                })
                .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''));

            resolve(rows);
        };

        script.onerror = () => {
            if (settled) return;
            settled = true; clearTimeout(timer); cleanup();
            reject(new Error(`Gagal memuat sheet "${sheetName}". Pastikan spreadsheet dibagikan publik.`));
        };

        script.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`
            + `?sheet=${encodeURIComponent(sheetName)}`
            + `&headers=1&tqx=out:json;responseHandler:${cbName}`
            + `&cacheBust=${Date.now()}`;

        document.head.appendChild(script);
    });

    // ── autentikasi via Sheets ────────────────────────────────────
    let cachedUsers = null; // cache agar tidak fetch berulang
    let activeUserSheetName = USER_SHEET_NAMES[0];

    const findCol = (row, ...aliases) => {
        for (const a of aliases) {
            const k = normalizeText(a);
            if (row[k] !== undefined) return String(row[k]).trim();
        }
        return '';
    };

    const hasLoginColumns = (rows) => rows.some((row) => (
        Boolean(findCol(row, 'username','user','nama_pengguna','email'))
        && Object.prototype.hasOwnProperty.call(row, 'password')
    ));

    const loadUserSheet = async () => {
        let lastError = null;

        for (const sheetName of USER_SHEET_NAMES) {
            try {
                const rows = await loadSheet(USER_SPREADSHEET_ID, sheetName);
                if (!hasLoginColumns(rows)) {
                    throw new Error(`Sheet "${sheetName}" bukan sheet akun.`);
                }
                activeUserSheetName = sheetName;
                return rows;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Sheet user tidak dapat dimuat.');
    };

    const getUsers = async () => {
        if (cachedUsers) return cachedUsers;
        cachedUsers = await loadUserSheet();
        return cachedUsers;
    };

    const authenticateFromSheet = async (username, password) => {
        const users = await getUsers();

        // Kolom yang dicari: username / user / nama_pengguna
        // Kolom password  : password / pass / sandi
        // Kolom role      : role / peran / jabatan
        // Kolom nama      : nama / nama_lengkap / name
        // Kolom bidang    : bidang / divisi / unit
        // Kolom status    : status / aktif
        const uNorm = normalizeText(username);

        const match = users.find((row) => {
            const rowUser = normalizeText(findCol(row, 'username','user','nama_pengguna','email'));
            const rowPass = findCol(row, 'password','pass','sandi');
            const status  = normalizeText(findCol(row, 'status','aktif'));
            const isActive = !status || status === 'aktif' || status === 'active';
            return isActive && rowUser === uNorm && rowPass === password;
        });

        if (!match) throw new Error('Username atau password salah.');

        return {
            username: findCol(match, 'username','user','nama_pengguna','email') || username,
            nama:     findCol(match, 'nama','nama_lengkap','name') || username,
            role:     findCol(match, 'role','peran','jabatan') || 'tamu',
            bidang:   findCol(match, 'bidang','divisi','unit') || 'SEMUA',
        };
    };

    const authenticate = async (username, password) => {
        try {
            const data = await postJson('/api/auth/login', { username, password });
            return data.user;
        } catch (serverError) {
            return authenticateFromSheet(username, password);
        }
    };

    // ── login sebagai tamu ────────────────────────────────────────
    const loginAsGuest = async () => {
        setLoginBusy(true);
        setLoginMessage('Memuat akses tamu...', 'success');

        try {
            const data = await postJson('/api/auth/guest');
            applyAuthenticatedUser(data.user || {
                nama:     'Tamu',
                username: 'tamu',
                role:     'tamu',
                bidang:   'SEMUA',
            });
        } catch (error) {
            applyAuthenticatedUser({
                nama:     'Tamu',
                username: 'tamu',
                role:     'tamu',
                bidang:   'SEMUA',
            });
        } finally {
            loginUsername.value = '';
            loginPassword.value = '';
            setLoginMessage('', 'success');
            setLoginBusy(false);
        }
    };

    // ── form submit ───────────────────────────────────────────────
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const username = loginUsername.value.trim();
        const password = loginPassword.value;

        // Shortcut tamu tanpa password
        if (normalizeText(username) === 'tamu' && !password) {
            await loginAsGuest();
            return;
        }

        setLoginBusy(true);
        setLoginMessage('Memvalidasi akun...', 'success');

        try {
            const user = await authenticate(username, password);
            setLoginMessage('', 'success');
            applyAuthenticatedUser(user);
        } catch (err) {
            setLoginMessage(err.message);
            cachedUsers = null; // reset cache agar bisa retry
        } finally {
            setLoginBusy(false);
        }
    });

    // ── tombol masuk sebagai tamu ─────────────────────────────────
    guestLoginButton?.addEventListener('click', (e) => { e.preventDefault(); loginAsGuest(); });

    document.addEventListener('click', (e) => {
        if (e.defaultPrevented) return;
        const btn = e.target.closest('[data-guest-login]');
        if (!btn) return;
        e.preventDefault();
        loginAsGuest();
    });

    // ── logout ────────────────────────────────────────────────────
    logoutButton?.addEventListener('click', async () => {
        cachedUsers = null;
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'same-origin',
            });
        } catch (error) {
            // Local lock still protects the UI when the network is unavailable.
        } finally {
            lockApp();
        }
    });

    // ── upload guard ──────────────────────────────────────────────
    document.getElementById('uploadButton')?.addEventListener('click', () => {
        if (currentUser?.role === 'tamu') {
            window.alert('Tamu hanya dapat melihat dan mengunduh dokumen.');
        }
    });

    // ── kelola user (baca dari Sheets, tampilkan tanpa password) ──
    const openUserManager = async () => {
        if (normalizeRole(currentUser?.role) !== 'super_admin') {
            window.alert('Hanya Super Admin yang dapat mengelola user.');
            return;
        }

        userManageModal.classList.remove('hidden');
        userManageContent.textContent = 'Memuat data user...';

        try {
            cachedUsers = null;
            const users = await getUsers();

            if (!users.length) {
                userManageContent.innerHTML = '<div class="document-search-state">Belum ada user.</div>';
                return;
            }

            const findCol = (row, ...aliases) => {
                for (const a of aliases) {
                    const k = normalizeText(a);
                    if (row[k] !== undefined) return String(row[k]).trim();
                }
                return '';
            };

            userManageContent.innerHTML = `
                <table class="user-table">
                    <thead>
                        <tr>
                            <th>Nama</th><th>Username</th><th>Role</th>
                            <th>Bidang</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map((u) => {
                            const role    = normalizeRole(findCol(u,'role','peran','jabatan'));
                            const status  = findCol(u,'status','aktif') || 'aktif';
                            const isActive = normalizeText(status) === 'aktif';
                            return `
                                <tr>
                                    <td>${escapeHtml(findCol(u,'nama','nama_lengkap','name'))}</td>
                                    <td>${escapeHtml(findCol(u,'username','user','email'))}</td>
                                    <td><span class="role-pill">${escapeHtml(roleLabels[role] || role)}</span></td>
                                    <td>${escapeHtml(findCol(u,'bidang','divisi','unit') || '-')}</td>
                                    <td><span class="status-pill ${isActive ? '' : 'is-inactive'}">${escapeHtml(status)}</span></td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>`;
        } catch (err) {
            userManageContent.textContent = err.message;
        }
    };

    manageUsersButton?.addEventListener('click', openUserManager);
    closeUserManageModal?.addEventListener('click', () => userManageModal.classList.add('hidden'));
    userManageModal?.addEventListener('click', (e) => {
        if (e.target === userManageModal) userManageModal.classList.add('hidden');
    });

    // ── inisialisasi: langsung tampilkan login ────────────────────
    lockApp();
})();

// ── Document Search (tidak bergantung backend) ────────────────────
// Fitur pencarian dokumen bergantung pada API Drive.
// Di Vercel tanpa backend, panel search tetap tampil tapi tidak mengembalikan
// hasil dari API. Untuk mengaktifkan: deploy /api/documents ke Vercel Functions
// atau hubungkan Google Drive API via Apps Script Web App.
(() => {
    const searchRoot    = document.getElementById('documentSearchRoot');
    const searchInput   = document.getElementById('documentSearchInput');
    const searchResults = document.getElementById('documentSearchResults');
    const viewAllBtns   = document.querySelectorAll('[data-view-all-documents]');

    if (!searchRoot || !searchInput || !searchResults) return;

    const escapeHtml = (v) => String(v ?? '')
        .replaceAll('&','&amp;').replaceAll('<','&lt;')
        .replaceAll('>','&gt;').replaceAll('"','&quot;')
        .replaceAll("'",'&#039;');

    const setOpen = (open) => {
        searchResults.classList.toggle('hidden', !open);
        searchInput.setAttribute('aria-expanded', String(open));
    };

    const renderState = (msg, type = 'info') => {
        searchResults.innerHTML = `<div class="document-search-state document-search-state-${escapeHtml(type)}">${escapeHtml(msg)}</div>`;
        setOpen(true);
    };

    // ── Apps Script Web App URL (opsional) ────────────────────────
    // Jika kamu deploy Apps Script sebagai Web App untuk membaca Drive,
    // isi URL-nya di sini. Biarkan kosong jika belum ada.
    const DRIVE_SEARCH_API_URL = window.SIDOTI_DRIVE_SEARCH_URL || '/api/documents/search';

    const openDocumentUrl = (url) => {
        if (!url) { window.alert('File belum tersedia.'); return; }
        const w = window.open(url, '_blank', 'noopener,noreferrer');
        if (!w) window.location.href = url;
    };

    const renderDocuments = (docs) => {
        if (!docs.length) { renderState('Dokumen tidak ditemukan.', 'empty'); return; }

        const formatDate = (v) => {
            if (!v) return '';
            const d = new Date(v);
            return isNaN(d) ? '' : new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(d);
        };

        searchResults.innerHTML = `<div class="document-search-list">${
            docs.map((doc) => {
                const modDate = formatDate(doc.modifiedTime);
                const folder  = doc.folderPath || 'SIDOTi';
                return `
                    <article class="document-search-card"
                        data-preview-url="${escapeHtml(doc.previewUrl || doc.fileUrl || '')}"
                        data-download-url="${escapeHtml(doc.downloadUrl || doc.fileUrl || '')}">
                        <div class="document-search-icon" aria-hidden="true"><i class="far fa-file-pdf"></i></div>
                        <div class="document-search-content">
                            <h3 class="document-search-title">${escapeHtml(doc.name || 'Dokumen')}</h3>
                            <p class="document-search-meta">${escapeHtml(folder)}${modDate ? ` - ${escapeHtml(modDate)}` : ''}</p>
                            <div class="document-search-actions">
                                <button type="button" class="document-search-action" data-search-action="preview">
                                    <i class="fas fa-eye" aria-hidden="true"></i><span>Preview</span>
                                </button>
                                <button type="button" class="document-search-action document-search-action-download" data-search-action="download">
                                    <i class="fas fa-download" aria-hidden="true"></i><span>Download</span>
                                </button>
                            </div>
                        </div>
                    </article>`;
            }).join('')
        }</div>`;
        setOpen(true);
    };

    const runSearch = async (query) => {
        if (!DRIVE_SEARCH_API_URL) {
            renderState('Pencarian dokumen memerlukan konfigurasi API. Hubungi administrator.', 'info');
            return;
        }

        renderState('Memuat dokumen...', 'loading');

        try {
            const url = query
                ? `${DRIVE_SEARCH_API_URL}?q=${encodeURIComponent(query)}`
                : DRIVE_SEARCH_API_URL;
            const resp = await fetch(url, { credentials: 'same-origin' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.message || 'Gagal memuat dokumen.');
            renderDocuments(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);
        } catch (err) {
            renderState(err.message || 'Dokumen gagal dimuat.', 'error');
        }
    };

    let debounceTimer = null;
    const scheduleSearch = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runSearch(searchInput.value.trim()), 350);
    };

    searchInput.addEventListener('input', scheduleSearch);
    searchInput.addEventListener('focus', () => {
        if (!searchResults.innerHTML.trim()) runSearch(searchInput.value.trim());
        else setOpen(true);
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { setOpen(false); searchInput.blur(); }
    });

    searchResults.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-search-action]');
        if (!btn) return;
        const card = btn.closest('.document-search-card');
        const url  = btn.dataset.searchAction === 'download'
            ? card?.dataset.downloadUrl
            : card?.dataset.previewUrl;
        openDocumentUrl(url || '');
    });

    viewAllBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            searchInput.value = '';
            searchRoot.scrollIntoView({ behavior: 'smooth', block: 'center' });
            runSearch('');
            searchInput.focus({ preventScroll: true });
        });
    });

    document.addEventListener('click', (e) => {
        if (!searchRoot.contains(e.target)) setOpen(false);
    });
})();
