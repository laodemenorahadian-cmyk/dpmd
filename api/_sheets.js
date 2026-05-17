const { google } = require('googleapis');

const DEFAULT_SPREADSHEET_ID = '1aBSadBTJq7lylc-YJyM2_4A-EWlDxd66FCdq41Ylz0w';
const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS_WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

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

const getServiceAccountCredentials = () => {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    }

    if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
        return JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
    }

    return null;
};

const getOAuthRefreshClient = () => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        return null;
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
};

const createGoogleAuth = async (scopes) => {
    const credentials = getServiceAccountCredentials();

    if (credentials) {
        return new google.auth.GoogleAuth({
            credentials,
            scopes,
        });
    }

    const refreshClient = getOAuthRefreshClient();

    if (refreshClient) {
        return refreshClient;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes,
        });
    }

    return null;
};

const createSheetsReadClient = async () => {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_DRIVE_API_KEY;

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

    throw new Error('Konfigurasi baca Google Sheets belum tersedia.');
};

const createSheetsWriteClient = async () => {
    const auth = await createGoogleAuth([SHEETS_WRITE_SCOPE]);

    if (!auth) {
        throw new Error('Simpan data belum aktif di server. Tambahkan GOOGLE_SERVICE_ACCOUNT_JSON atau GOOGLE_SERVICE_ACCOUNT_BASE64 di Environment Variables Vercel, lalu bagikan spreadsheet ke email service account tersebut sebagai Editor.');
    }

    return google.sheets({
        version: 'v4',
        auth,
    });
};

const getQuery = (request) => {
    if (request.query) {
        return request.query;
    }

    const url = new URL(request.url || '/', 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
};

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
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, X-SIDOTI-Role, X-SIDOTI-Username');
    response.end(JSON.stringify(payload));
};

const sendOptions = (response) => {
    response.statusCode = 204;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, X-SIDOTI-Role, X-SIDOTI-Username');
    response.end();
};

const getSpreadsheetId = (value) => String(value || DEFAULT_SPREADSHEET_ID).trim();

const assertSuperAdmin = (request) => {
    const role = request.headers?.['x-sidoti-role'];

    if (normalizeRole(role) !== 'super_admin') {
        const error = new Error('Hanya super admin yang dapat menyimpan perubahan.');
        error.statusCode = 403;
        throw error;
    }
};

const handleApiError = (response, error, fallbackMessage) => {
    sendJson(response, error.statusCode || 500, {
        message: error.message || fallbackMessage,
    });
};

module.exports = {
    assertSuperAdmin,
    createSheetsReadClient,
    createSheetsWriteClient,
    getQuery,
    getSpreadsheetId,
    handleApiError,
    readJsonBody,
    sendJson,
    sendOptions,
};
