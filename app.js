(() => {
    const loginScreen = document.getElementById('loginScreen');
    const loginForm = document.getElementById('loginForm');
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const loginMessage = document.getElementById('loginMessage');
    const loginSubmit = document.getElementById('loginSubmit');
    const guestLoginButton = document.getElementById('guestLoginButton') || document.querySelector('[data-guest-login]');
    const logoutButton = document.getElementById('logoutButton');
    const authUserPanel = document.getElementById('authUserPanel');
    const authUserName = document.getElementById('authUserName');
    const authUserMeta = document.getElementById('authUserMeta');
    const manageUsersButton = document.getElementById('manageUsersButton');
    const userManageModal = document.getElementById('userManageModal');
    const closeUserManageModal = document.getElementById('closeUserManageModal');
    const userManageContent = document.getElementById('userManageContent');
    const DEFAULT_LOCAL_API_ORIGIN = 'http://localhost:3000';
    const RESTORE_SESSION_ON_LOAD = false;

    if (!loginScreen || !loginForm) {
        return;
    }

    const roleLabels = {
        super_admin: 'Super Admin',
        admin_bidang: 'Admin Bidang',
        tamu: 'Tamu',
    };
    let currentUser = null;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    const normalizeText = (value) => String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');

    const normalizeRole = (role) => {
        const normalized = normalizeText(role);

        if (normalized === 'superadmin' || normalized === 'superadministrator') {
            return 'super_admin';
        }

        if (normalized === 'adminbidang') {
            return 'admin_bidang';
        }

        if (normalized === 'tamu' || normalized === 'guest') {
            return 'tamu';
        }

        return role;
    };

    const getApiBaseUrl = () => {
        const configuredBaseUrl = window.SIDOTI_API_BASE_URL || document.documentElement.dataset.apiBaseUrl;

        if (configuredBaseUrl) {
            return String(configuredBaseUrl).replace(/\/+$/, '');
        }

        const { protocol, hostname, port } = window.location;

        if (protocol === 'file:') {
            return DEFAULT_LOCAL_API_ORIGIN;
        }

        const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);

        if (isLocalHost && port && port !== '3000') {
            const apiHost = hostname === '::1' ? '[::1]' : hostname;
            return `${protocol}//${apiHost}:3000`;
        }

        return '';
    };

    const API_BASE_URL = getApiBaseUrl();
    const apiUrl = (path) => `${API_BASE_URL}${path}`;

    const setAuthState = (state) => {
        document.body.classList.remove('auth-pending', 'auth-locked', 'auth-ready');
        document.body.classList.add(state);
    };

    const setLoginMessage = (message, type = 'error') => {
        loginMessage.textContent = message || '';
        loginMessage.classList.toggle('is-success', type === 'success');
    };

    const setLoginBusy = (isBusy) => {
        loginSubmit.disabled = isBusy;
        if (guestLoginButton) {
            guestLoginButton.disabled = isBusy;
        }
        loginUsername.disabled = isBusy;
        loginPassword.disabled = isBusy;
    };

    const roleCan = (control) => {
        const role = normalizeRole(currentUser?.role);

        if (control === 'upload') {
            return Boolean(currentUser) && role !== 'tamu';
        }

        if (control === 'edit') {
            return Boolean(currentUser) && role !== 'tamu';
        }

        if (control === 'manage-users') {
            return role === 'super_admin';
        }

        return true;
    };

    const applyRoleControls = () => {
        document.querySelectorAll('[data-role-control]').forEach((element) => {
            const control = element.dataset.roleControl;
            element.classList.toggle('hidden', !roleCan(control));
        });
    };

    const setUploadScopeForRole = () => {
        const kategori = document.getElementById('uploadKategori');
        const subKategori = document.getElementById('uploadSubKategori');

        if (!kategori || !subKategori) {
            return;
        }

        kategori.disabled = false;
        subKategori.disabled = false;
    };

    const notifyAuthChange = () => {
        window.dispatchEvent(new CustomEvent('sidoti:auth-change', {
            detail: { user: currentUser },
        }));
    };

    const applyAuthenticatedUser = (user) => {
        currentUser = {
            ...user,
            role: normalizeRole(user.role),
        };
        window.sidotiAuth = {
            user: currentUser,
            hasRole: (...roles) => roles.map(normalizeRole).includes(currentUser.role),
        };

        authUserPanel?.classList.remove('hidden');

        if (authUserName) {
            authUserName.textContent = currentUser.nama || currentUser.username || 'User';
        }

        if (authUserMeta) {
            authUserMeta.textContent = `${roleLabels[currentUser.role] || currentUser.role} - ${currentUser.bidang || 'umum'}`;
        }

        applyRoleControls();
        notifyAuthChange();
        setAuthState('auth-ready');
    };

    const lockApp = () => {
        currentUser = null;
        window.sidotiAuth = null;
        applyRoleControls();
        notifyAuthChange();
        authUserPanel?.classList.add('hidden');
        setAuthState('auth-locked');
        loginPassword.value = '';
        loginUsername.focus();
    };

    const requestJson = async (url, options = {}) => {
        let response;

        try {
            response = await fetch(apiUrl(url), {
                credentials: 'include',
                headers: {
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.headers || {}),
                },
                ...options,
            });
        } catch (error) {
            throw new Error('Server login belum tersambung. Jalankan npm start lalu buka http://localhost:3000.');
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.message || 'Permintaan gagal diproses.');
        }

        return data;
    };

    window.sidotiApiUrl = apiUrl;

    const checkSession = async () => {
        try {
            const data = await requestJson('/api/auth/me');
            applyAuthenticatedUser(data.user);
        } catch {
            lockApp();
        }
    };

    const renderUsers = (users) => {
        if (!users.length) {
            userManageContent.innerHTML = '<div class="document-search-state">Belum ada user.</div>';
            return;
        }

        userManageContent.innerHTML = `
            <table class="user-table">
                <thead>
                    <tr>
                        <th>Nama</th>
                        <th>Username</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Bidang</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map((user) => {
                        const isActive = normalizeText(user.status) === 'aktif';

                        return `
                            <tr>
                                <td>${escapeHtml(user.nama)}</td>
                                <td>${escapeHtml(user.username)}</td>
                                <td>${escapeHtml(user.email || '-')}</td>
                                <td><span class="role-pill">${escapeHtml(roleLabels[user.role] || user.role)}</span></td>
                                <td>${escapeHtml(user.bidang || '-')}</td>
                                <td><span class="status-pill ${isActive ? '' : 'is-inactive'}">${escapeHtml(user.status || '-')}</span></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    };

    const openUserManager = async () => {
        if (currentUser?.role !== 'super_admin') {
            window.alert('Hanya Super Admin yang dapat mengelola user.');
            return;
        }

        userManageModal.classList.remove('hidden');
        userManageContent.textContent = 'Memuat user...';

        try {
            const data = await requestJson('/api/users');
            renderUsers(Array.isArray(data.data) ? data.data : []);
        } catch (error) {
            userManageContent.textContent = error.message;
        }
    };

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (loginUsername.value.trim().toLowerCase() === 'tamu' && !loginPassword.value) {
            loginAsGuest();
            return;
        }

        setLoginBusy(true);
        setLoginMessage('Memvalidasi akun...', 'success');

        try {
            const data = await requestJson('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: loginUsername.value.trim(),
                    password: loginPassword.value,
                }),
            });

            setLoginMessage('', 'success');
            applyAuthenticatedUser(data.user);
        } catch (error) {
            setLoginMessage(error.message);
        } finally {
            setLoginBusy(false);
        }
    });

    const loginAsGuest = async () => {
        setLoginBusy(true);
        setLoginMessage('Masuk sebagai tamu...', 'success');

        try {
            const data = await requestJson('/api/auth/guest', {
                method: 'POST',
                body: JSON.stringify({ role: 'tamu' }),
            });

            loginUsername.value = '';
            loginPassword.value = '';
            setLoginMessage('', 'success');
            applyAuthenticatedUser(data.user);
        } catch (error) {
            setLoginMessage(error.message);
        } finally {
            setLoginBusy(false);
        }
    };

    guestLoginButton?.addEventListener('click', (event) => {
        event.preventDefault();
        loginAsGuest();
    });

    document.addEventListener('click', (event) => {
        if (event.defaultPrevented) {
            return;
        }

        const button = event.target.closest('[data-guest-login]');

        if (!button) {
            return;
        }

        event.preventDefault();
        loginAsGuest();
    });

    logoutButton?.addEventListener('click', async () => {
        try {
            await requestJson('/api/auth/logout', { method: 'POST' });
        } catch {
            // Tetap kunci UI lokal jika session di server sudah hilang.
        } finally {
            lockApp();
        }
    });

    document.getElementById('uploadButton')?.addEventListener('click', () => {
        if (currentUser?.role === 'tamu') {
            window.alert('Tamu hanya dapat melihat dan mengunduh dokumen.');
            return;
        }

        window.setTimeout(setUploadScopeForRole, 0);
    });

    manageUsersButton?.addEventListener('click', openUserManager);
    closeUserManageModal?.addEventListener('click', () => userManageModal.classList.add('hidden'));
    userManageModal?.addEventListener('click', (event) => {
        if (event.target === userManageModal) {
            userManageModal.classList.add('hidden');
        }
    });

    if (RESTORE_SESSION_ON_LOAD) {
        checkSession();
    } else {
        lockApp();
    }
})();

(() => {
    const searchRoot = document.getElementById('documentSearchRoot');
    const searchInput = document.getElementById('documentSearchInput');
    const searchResults = document.getElementById('documentSearchResults');
    const viewAllDocumentButtons = document.querySelectorAll('[data-view-all-documents]');

    if (!searchRoot || !searchInput || !searchResults) {
        return;
    }

    const debounceDelay = 350;
    const defaultDocumentLimit = 8;
    const allDocumentLimit = 100;
    let debounceTimer = null;
    let activeRequestId = 0;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    const getApiBaseUrl = () => {
        const configuredBaseUrl = window.SIDOTI_API_BASE_URL || document.documentElement.dataset.apiBaseUrl;

        if (configuredBaseUrl) {
            return String(configuredBaseUrl).replace(/\/+$/, '');
        }

        const { protocol, hostname, port } = window.location;

        if (protocol === 'file:') {
            return 'http://localhost:3000';
        }

        const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);

        if (isLocalHost && port && port !== '3000') {
            const apiHost = hostname === '::1' ? '[::1]' : hostname;
            return `${protocol}//${apiHost}:3000`;
        }

        return '';
    };

    const apiUrl = window.sidotiApiUrl || ((path) => `${getApiBaseUrl()}${path}`);

    const setResultsOpen = (isOpen) => {
        searchResults.classList.toggle('hidden', !isOpen);
        searchInput.setAttribute('aria-expanded', String(isOpen));
    };

    const formatDate = (value) => {
        if (!value) {
            return '';
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return new Intl.DateTimeFormat('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        }).format(date);
    };

    const renderState = (message, type = 'info') => {
        searchResults.innerHTML = `
            <div class="document-search-state document-search-state-${escapeHtml(type)}">
                ${escapeHtml(message)}
            </div>
        `;
        setResultsOpen(true);
    };

    const openDocumentUrl = (url) => {
        if (!url) {
            window.alert('File PDF belum tersedia.');
            return;
        }

        const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');

        if (!openedWindow) {
            window.location.href = url;
        }
    };

    const getDocuments = async (query, limit = defaultDocumentLimit) => {
        const endpoint = query
            ? `/api/documents/search?q=${encodeURIComponent(query)}`
            : `/api/documents?limit=${encodeURIComponent(limit)}`;
        let response;

        try {
            response = await fetch(apiUrl(endpoint), {
                credentials: 'include',
            });
        } catch (error) {
            throw new Error('Server dokumen belum tersambung. Jalankan npm start lalu buka http://localhost:3000.');
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Dokumen gagal dimuat.');
        }

        const payload = await response.json();
        return Array.isArray(payload.data) ? payload.data : [];
    };

    const renderDocuments = (documents) => {
        if (!documents.length) {
            renderState('Dokumen tidak ditemukan', 'empty');
            return;
        }

        searchResults.innerHTML = `
            <div class="document-search-list">
                ${documents.map((documentData) => {
                    const modifiedDate = formatDate(documentData.modifiedTime);
                    const folderPath = documentData.folderPath || 'SIDOTi';

                    return `
                        <article class="document-search-card" data-preview-url="${escapeHtml(documentData.previewUrl || documentData.fileUrl || '')}" data-download-url="${escapeHtml(documentData.downloadUrl || documentData.fileUrl || '')}">
                            <div class="document-search-icon" aria-hidden="true">
                                <i class="far fa-file-pdf"></i>
                            </div>
                            <div class="document-search-content">
                                <h3 class="document-search-title">${escapeHtml(documentData.name || 'Dokumen tanpa nama')}</h3>
                                <p class="document-search-meta">${escapeHtml(folderPath)}${modifiedDate ? ` - ${escapeHtml(modifiedDate)}` : ''}</p>
                                <div class="document-search-actions">
                                    <button type="button" class="document-search-action" data-search-action="preview" aria-label="Preview PDF ${escapeHtml(documentData.name || 'dokumen')}">
                                        <i class="fas fa-eye" aria-hidden="true"></i>
                                        <span>Preview</span>
                                    </button>
                                    <button type="button" class="document-search-action document-search-action-download" data-search-action="download" aria-label="Download PDF ${escapeHtml(documentData.name || 'dokumen')}">
                                        <i class="fas fa-download" aria-hidden="true"></i>
                                        <span>Download</span>
                                    </button>
                                </div>
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        `;
        setResultsOpen(true);
    };

    const runSearch = async (query, limit = defaultDocumentLimit) => {
        const requestId = ++activeRequestId;

        renderState('Memuat dokumen...', 'loading');

        try {
            const documents = await getDocuments(query, limit);

            if (requestId !== activeRequestId) {
                return;
            }

            renderDocuments(documents);
        } catch (error) {
            if (requestId !== activeRequestId) {
                return;
            }

            renderState(error.message || 'Dokumen gagal dimuat.', 'error');
        }
    };

    const scheduleSearch = () => {
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            runSearch(searchInput.value.trim());
        }, debounceDelay);
    };

    const showAllDocuments = () => {
        window.clearTimeout(debounceTimer);
        searchInput.value = '';
        searchRoot.scrollIntoView({ behavior: 'smooth', block: 'center' });
        runSearch('', allDocumentLimit);
        searchInput.focus({ preventScroll: true });
    };

    searchInput.addEventListener('input', scheduleSearch);

    searchInput.addEventListener('focus', () => {
        if (!searchResults.innerHTML.trim()) {
            runSearch(searchInput.value.trim());
            return;
        }

        setResultsOpen(true);
    });

    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setResultsOpen(false);
            searchInput.blur();
        }
    });

    searchResults.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-search-action]');

        if (!actionButton) {
            return;
        }

        const card = actionButton.closest('.document-search-card');
        const action = actionButton.dataset.searchAction;
        const url = action === 'download'
            ? card?.dataset.downloadUrl
            : card?.dataset.previewUrl;

        openDocumentUrl(url || '');
    });

    viewAllDocumentButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showAllDocuments();
        });
    });

    document.addEventListener('click', (event) => {
        if (event.defaultPrevented) {
            return;
        }

        if (!searchRoot.contains(event.target)) {
            setResultsOpen(false);
        }
    });
})();
