const crypto = require('crypto');

const USER_SPREADSHEET_ID = process.env.GOOGLE_USER_SPREADSHEET_ID || '1aBSadBTJq7lylc-YJyM2_4A-EWlDxd66FCdq41Ylz0w';
const USER_SHEET_NAME = process.env.GOOGLE_USER_SHEET_NAME || 'user';
const USER_SHEET_NAMES = [...new Set([USER_SHEET_NAME, 'user', 'users'].filter(Boolean))];

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKey = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, '');

const normalizeRole = (role) => {
    const normalized = normalizeKey(role);

    if (normalized === 'admin' || normalized === 'superadmin' || normalized === 'superadministrator') {
        return 'super_admin';
    }

    if (normalized === 'adminbidang') {
        return 'admin_bidang';
    }

    if (normalized === 'tamu' || normalized === 'guest') {
        return 'tamu';
    }

    return role || 'tamu';
};

const getGvizCellValue = (cell) => {
    if (!cell) {
        return '';
    }

    return cell.f ?? cell.v ?? '';
};

const fetchPublicSheetValues = async (spreadsheetId, sheetName) => {
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

const readJsonBody = async (request) => {
    if (request.body && typeof request.body === 'object') {
        return request.body;
    }

    if (typeof request.body === 'string') {
        return JSON.parse(request.body || '{}');
    }

    const chunks = [];

    for await (const chunk of request) {
        chunks.push(chunk);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
};

const sendJson = (response, statusCode, payload) => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(payload));
};

module.exports = {
    createGuestProfile,
    findGuestUser,
    findUserByLogin,
    isActiveUser,
    isPasswordMatch,
    readJsonBody,
    sanitizeUser,
    sendJson,
};
