require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const USER_SPREADSHEET_ID = process.env.GOOGLE_USER_SPREADSHEET_ID || '1aBSadBTJq7lylc-YJyM2_4A-EWlDxd66FCdq41Ylz0w';
const USER_SHEET_NAME = process.env.GOOGLE_USER_SHEET_NAME || 'user';
const USER_SHEET_NAMES = [...new Set([USER_SHEET_NAME, 'user', 'users'].filter(Boolean))];
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const CACHE_TTL_MS = Number(process.env.DOCUMENT_CACHE_TTL_MS || 120000);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const SESSION_COOKIE_NAME = 'sidoti_session';
const LOCAL_CORS_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const CONFIGURED_CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

let documentsCache = {
    expiresAt: 0,
    data: [],
};
const sessions = new Map();

const isAllowedCorsOrigin = (origin) => {
    if (!origin) {
        return true;
    }

    if (CONFIGURED_CORS_ORIGINS.includes(origin)) {
        return true;
    }

    if (process.env.NODE_ENV !== 'production' && origin === 'null') {
        return true;
    }

    if (process.env.NODE_ENV !== 'production') {
        try {
            return LOCAL_CORS_HOSTS.has(new URL(origin).hostname);
        } catch (error) {
            return false;
        }
    }

    return false;
};

const corsOptions = {
    credentials: true,
    origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin tidak diizinkan mengakses API SIDOTi.'));
    },
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.static(__dirname, {
    etag: true,
    setHeaders: (response, filePath) => {
        if (/\.(?:html|js|css)$/i.test(filePath)) {
            response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            response.setHeader('Pragma', 'no-cache');
            response.setHeader('Expires', '0');
            return;
        }

        if (/\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(filePath)) {
            response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    },
}));

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getServiceAccountCredentials = () => {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    }

    if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
        return JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
    }

    return null;
};

const getGoogleApiKey = () => process.env.GOOGLE_API_KEY || process.env.GOOGLE_DRIVE_API_KEY;

const createGoogleAuth = async (scopes) => {
    const credentials = getServiceAccountCredentials();

    if (credentials) {
        return new google.auth.GoogleAuth({
            credentials,
            scopes,
        });
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes,
        });
    }

    return null;
};

const createDriveClient = async () => {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_DRIVE_API_KEY;

    if (apiKey) {
        return google.drive({
            version: 'v3',
            auth: apiKey,
        });
    }

    const auth = await createGoogleAuth([DRIVE_READONLY_SCOPE]);

    if (auth) {
        return google.drive({
            version: 'v3',
            auth,
        });
    }

    throw new Error('Konfigurasi Google Drive belum tersedia. Isi GOOGLE_API_KEY atau kredensial service account di .env.');
};

const createSheetsClient = async () => {
    const apiKey = getGoogleApiKey();

    if (apiKey) {
        return google.sheets({
            version: 'v4',
            auth: apiKey,
        });
    }

    const auth = await createGoogleAuth([SHEETS_READONLY_SCOPE]);

    if (auth) {
        return google.sheets({
            version: 'v4',
            auth,
        });
    }

    throw new Error('Konfigurasi Google Sheets belum tersedia. Isi GOOGLE_API_KEY atau kredensial service account di .env.');
};

const getGvizCellValue = (cell) => {
    if (!cell) {
        return '';
    }

    return cell.f ?? cell.v ?? '';
};

const fetchPublicSheetValues = async (spreadsheetId, sheetName) => {
    if (typeof fetch !== 'function') {
        throw new Error('Runtime Node.js tidak mendukung fetch. Gunakan Node.js 18 atau lebih baru.');
    }

    const callbackName = `sidotiAuth_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&headers=1&tqx=out:json;responseHandler:${callbackName}&cacheBust=${Date.now()}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Sheet user gagal dimuat: HTTP ${response.status}.`);
    }

    const text = await response.text();
    const prefix = `${callbackName}(`;
    const startIndex = text.indexOf(prefix);
    const endIndex = text.lastIndexOf(');');

    if (startIndex === -1 || endIndex === -1) {
        throw new Error('Respons Google Sheets tidak valid.');
    }

    const payload = JSON.parse(text.slice(startIndex + prefix.length, endIndex));

    if (!payload || payload.status === 'error') {
        const message = payload?.errors?.[0]?.detailed_message
            || payload?.errors?.[0]?.message
            || 'Sheet user tidak dapat dimuat.';
        throw new Error(message);
    }

    const table = payload.table || {};
    const headers = (table.cols || []).map((column, index) => (
        String(column.label || column.id || `kolom_${index + 1}`).trim()
    ));
    const rows = (table.rows || []).map((row) => (
        (row.c || []).map((cell) => getGvizCellValue(cell))
    ));

    return [headers, ...rows];
};

const getCookieValue = (request, name) => {
    const cookieHeader = request.headers.cookie || '';
    const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
    const cookie = cookies.find((item) => item.startsWith(`${name}=`));

    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
};

const getSessionCookieOptions = () => [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
].filter(Boolean).join('; ');

const setSessionCookie = (response, token) => {
    response.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${getSessionCookieOptions()}`);
};

const clearSessionCookie = (response) => {
    response.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
};

const sanitizeUser = (user) => ({
    id: user.id,
    nama: user.nama,
    username: user.username,
    email: user.email,
    role: normalizeRole(user.role),
    bidang: user.bidang,
    status: user.status,
    catatan: user.catatan,
});

const normalizeRole = (role) => {
    const normalized = normalizeText(role).replace(/[^a-z0-9]+/g, '');

    if (normalized === 'admin' || normalized === 'superadmin' || normalized === 'superadministrator') {
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

const mapUserRows = (values = []) => {
    const [headers = [], ...rows] = values;
    const normalizedHeaders = headers.map((header) => normalizeText(header).replace(/\s+/g, '_'));

    return rows
        .filter((row) => row.some((cell) => String(cell || '').trim()))
        .map((row) => normalizedHeaders.reduce((record, header, index) => {
            record[header || `kolom_${index + 1}`] = String(row[index] || '').trim();
            return record;
        }, {}));
};

const hasLoginColumns = (rows) => rows.some((row) => (
    Boolean(row.username || row.user || row.nama_pengguna || row.email)
    && Object.prototype.hasOwnProperty.call(row, 'password')
));

const getUsersFromSheet = async () => {
    let lastError = null;
    let sheets = null;

    try {
        sheets = await createSheetsClient();
    } catch (error) {
        lastError = error;
    }

    if (sheets) {
        for (const sheetName of USER_SHEET_NAMES) {
            try {
                const range = `'${sheetName.replace(/'/g, "''")}'!A1:Z1000`;
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: USER_SPREADSHEET_ID,
                    range,
                    valueRenderOption: 'FORMATTED_VALUE',
                });
                const users = mapUserRows(response.data.values || []);

                if (hasLoginColumns(users)) {
                    return users;
                }

                throw new Error(`Sheet "${sheetName}" bukan sheet akun.`);
            } catch (error) {
                lastError = error;
            }
        }
    }

    for (const sheetName of USER_SHEET_NAMES) {
        try {
            const values = await fetchPublicSheetValues(USER_SPREADSHEET_ID, sheetName);
            const users = mapUserRows(values);

            if (hasLoginColumns(users)) {
                return users;
            }

            throw new Error(`Sheet "${sheetName}" bukan sheet akun.`);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Data user gagal dimuat.');
};

const isActiveUser = (user) => {
    const status = normalizeText(user.status);
    return ['aktif', 'active', '1', 'true', 'ya'].includes(status);
};

const safeCompare = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isPasswordMatch = (inputPassword, storedPassword) => {
    const input = String(inputPassword || '').trim();
    const stored = String(storedPassword || '').trim();

    if (!input || !stored) {
        return false;
    }

    if (stored.startsWith('sha256:')) {
        const hash = crypto.createHash('sha256').update(input).digest('hex');
        return safeCompare(hash, stored.slice(7));
    }

    if (/^[a-f0-9]{64}$/i.test(stored)) {
        const hash = crypto.createHash('sha256').update(input).digest('hex');
        return safeCompare(hash, stored);
    }

    return safeCompare(input, stored);
};

const findUserByLogin = async (login) => {
    const users = await getUsersFromSheet();
    const normalizedLogin = normalizeText(login);

    return users.find((user) => (
        normalizeText(user.username) === normalizedLogin
        || normalizeText(user.email) === normalizedLogin
    ));
};

const findGuestUser = async () => {
    const users = await getUsersFromSheet();

    return users.find((user) => normalizeText(user.role) === 'tamu')
        || users.find((user) => normalizeText(user.username) === 'tamu')
        || {
            id: 'guest',
            nama: 'Tamu',
            username: 'tamu',
            email: '',
            role: 'tamu',
            bidang: 'umum',
            status: 'aktif',
            catatan: 'Akses tamu tanpa password',
        };
};

const createGuestProfile = (user) => ({
    ...user,
    id: user.id || 'guest',
    nama: user.nama || 'Tamu',
    username: user.username || 'tamu',
    role: 'tamu',
    bidang: user.bidang || 'umum',
    status: 'aktif',
    catatan: user.catatan || 'Akses tamu tanpa password',
});

const createSession = (user) => {
    const token = crypto.randomBytes(32).toString('hex');
    const safeUser = sanitizeUser(user);

    sessions.set(token, {
        user: safeUser,
        expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return {
        token,
        user: safeUser,
    };
};

const getSession = (request) => {
    const token = getCookieValue(request, SESSION_COOKIE_NAME);

    if (!token) {
        return null;
    }

    const session = sessions.get(token);

    if (!session || session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    return {
        token,
        ...session,
    };
};

const requireAuth = (request, response, next) => {
    const session = getSession(request);

    if (!session) {
        response.status(401).json({ message: 'Anda harus login terlebih dahulu.' });
        return;
    }

    request.user = session.user;
    request.sessionToken = session.token;
    next();
};

const optionalAuth = (request, response, next) => {
    const session = getSession(request);

    if (session) {
        request.user = session.user;
        request.sessionToken = session.token;
    } else {
        request.user = { role: 'tamu' };
    }

    next();
};

const requireRoles = (...roles) => (request, response, next) => {
    if (!roles.includes(request.user?.role)) {
        response.status(403).json({ message: 'Akses tidak diizinkan untuk role ini.' });
        return;
    }

    next();
};

const getFileLinks = (file) => {
    const viewUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

    return {
        viewUrl,
        previewUrl: file.mimeType === 'application/pdf'
            ? `https://drive.google.com/file/d/${file.id}/preview`
            : viewUrl,
        downloadUrl: file.webContentLink || `https://drive.google.com/uc?export=download&id=${file.id}`,
    };
};

const mapDriveFile = (file, folderPath) => {
    const links = getFileLinks(file);

    return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size || '',
        createdTime: file.createdTime || '',
        modifiedTime: file.modifiedTime || '',
        folderPath: folderPath.join(' / '),
        fileUrl: links.viewUrl,
        previewUrl: links.previewUrl,
        downloadUrl: links.downloadUrl,
    };
};

const listFolderDocuments = async (drive, folderId, folderPath = ['SIDOTi']) => {
    const documents = [];
    let pageToken = null;

    do {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
            orderBy: 'folder,name',
            pageSize: 1000,
            pageToken,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
        });

        for (const file of response.data.files || []) {
            if (file.mimeType === FOLDER_MIME_TYPE) {
                const childDocuments = await listFolderDocuments(drive, file.id, [...folderPath, file.name]);
                documents.push(...childDocuments);
                continue;
            }

            documents.push(mapDriveFile(file, folderPath));
        }

        pageToken = response.data.nextPageToken || null;
    } while (pageToken);

    return documents;
};

const getCachedDocuments = async () => {
    if (!DRIVE_FOLDER_ID) {
        throw new Error('GOOGLE_DRIVE_FOLDER_ID belum diatur di .env.');
    }

    if (documentsCache.expiresAt > Date.now()) {
        return documentsCache.data;
    }

    const drive = await createDriveClient();
    const documents = await listFolderDocuments(drive, DRIVE_FOLDER_ID);
    const sortedDocuments = documents.sort((first, second) => (
        new Date(second.modifiedTime || 0).getTime() - new Date(first.modifiedTime || 0).getTime()
    ));

    documentsCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        data: sortedDocuments,
    };

    return sortedDocuments;
};

const searchDocuments = (documents, query) => {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery) {
        return documents;
    }

    return documents.filter((documentData) => {
        const haystack = normalizeText([
            documentData.name,
            documentData.folderPath,
            documentData.mimeType,
        ].join(' '));

        return haystack.includes(normalizedQuery);
    });
};

const normalizeRestrictedDocumentKey = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, '');

const isRestrictedPenganggaranKey = (value) => {
    const key = normalizeRestrictedDocumentKey(value);

    return key.startsWith('rka2026') || key.includes('rka2026') || key.startsWith('dpa') || key.includes('dpa');
};

const isRestrictedPenganggaranDocument = (documentData) => {
    return isRestrictedPenganggaranKey(documentData.name)
        || isRestrictedPenganggaranKey(documentData.folderPath);
};

const filterDocumentsForRole = (documents, user) => {
    if (normalizeRole(user?.role) !== 'tamu') {
        return documents;
    }

    return documents.filter((documentData) => !isRestrictedPenganggaranDocument(documentData));
};

const sendDocuments = async (request, response, query = '') => {
    try {
        const limit = Math.min(Number(request.query.limit || 50), 100);
        const documents = await getCachedDocuments();
        const visibleDocuments = filterDocumentsForRole(documents, request.user);
        const results = searchDocuments(visibleDocuments, query).slice(0, limit);

        response.json({
            count: results.length,
            data: results,
        });
    } catch (error) {
        response.status(500).json({
            message: error.message || 'Dokumen gagal dimuat.',
        });
    }
};

app.post('/api/auth/login', async (request, response) => {
    const { username, password } = request.body || {};

    if (normalizeText(username) === 'tamu' && !password) {
        try {
            const guestUser = createGuestProfile(await findGuestUser());
            const session = createSession(guestUser);

            setSessionCookie(response, session.token);
            response.json({ user: session.user });
        } catch (error) {
            response.status(500).json({ message: error.message || 'Login tamu gagal diproses.' });
        }
        return;
    }

    if (!username || !password) {
        response.status(400).json({ message: 'Username/email dan password wajib diisi.' });
        return;
    }

    try {
        const user = await findUserByLogin(username);

        if (!user || !isActiveUser(user) || !isPasswordMatch(password, user.password)) {
            response.status(401).json({ message: 'Login gagal. Periksa username dan password.' });
            return;
        }

        const session = createSession(user);
        setSessionCookie(response, session.token);
        response.json({ user: session.user });
    } catch (error) {
        response.status(500).json({ message: error.message || 'Login gagal diproses.' });
    }
});

app.post('/api/auth/guest', async (request, response) => {
    try {
        const guestUser = createGuestProfile(await findGuestUser());
        const session = createSession(guestUser);

        setSessionCookie(response, session.token);
        response.json({ user: session.user });
    } catch (error) {
        response.status(500).json({ message: error.message || 'Login tamu gagal diproses.' });
    }
});

app.get('/api/auth/me', (request, response) => {
    const session = getSession(request);

    if (!session) {
        response.status(401).json({ message: 'Belum login.' });
        return;
    }

    response.json({ user: session.user });
});

app.post('/api/auth/logout', requireAuth, (request, response) => {
    sessions.delete(request.sessionToken);
    clearSessionCookie(response);
    response.json({ ok: true });
});

app.get('/api/users', requireAuth, requireRoles('super_admin'), async (request, response) => {
    try {
        const users = await getUsersFromSheet();
        response.json({
            count: users.length,
            data: users.map(sanitizeUser),
        });
    } catch (error) {
        response.status(500).json({ message: error.message || 'Data user gagal dimuat.' });
    }
});

app.get('/api/documents', optionalAuth, (request, response) => {
    sendDocuments(request, response);
});

app.get('/api/documents/search', optionalAuth, (request, response) => {
    sendDocuments(request, response, request.query.q || '');
});

app.get('*', (request, response) => {
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`SIDOTi server berjalan di http://localhost:${PORT}`);
    });
}

module.exports = app;
