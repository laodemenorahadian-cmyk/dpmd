const { google } = require('googleapis');

const DEFAULT_DRIVE_FOLDER_ID = '1k3zNzMOBIXrSmGNkN_UrPRHgxcEUMyVb';
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER_ID;
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const CACHE_TTL_MS = Number(process.env.DOCUMENT_CACHE_TTL_MS || 120000);

let documentsCache = {
    expiresAt: 0,
    data: [],
};

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

    throw new Error('Konfigurasi Google Drive belum tersedia. Isi GOOGLE_API_KEY atau kredensial service account di Environment Variables Vercel.');
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
        throw new Error('GOOGLE_DRIVE_FOLDER_ID belum diatur di Environment Variables Vercel.');
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

const isRestrictedPenganggaranDocument = (documentData) => (
    isRestrictedPenganggaranKey(documentData.name)
    || isRestrictedPenganggaranKey(documentData.folderPath)
);

const filterDocumentsForRole = (documents, user) => {
    if (normalizeRole(user?.role) !== 'tamu') {
        return documents;
    }

    return documents.filter((documentData) => !isRestrictedPenganggaranDocument(documentData));
};

const sendJson = (response, statusCode, payload) => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(payload));
};

const getRequestQuery = (request) => {
    if (request.query) {
        return request.query;
    }

    const url = new URL(request.url || '/', 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
};

const sendDocuments = async (request, response, query = '') => {
    try {
        const requestQuery = getRequestQuery(request);
        const rawLimit = Number(requestQuery.limit || 50);
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);
        const role = requestQuery.role || request.headers?.['x-sidoti-role'] || 'super_admin';
        const documents = await getCachedDocuments();
        const visibleDocuments = filterDocumentsForRole(documents, { role });
        const results = searchDocuments(visibleDocuments, query).slice(0, limit);

        sendJson(response, 200, {
            count: results.length,
            data: results,
        });
    } catch (error) {
        sendJson(response, 500, {
            message: error.message || 'Dokumen gagal dimuat.',
        });
    }
};

module.exports = {
    getRequestQuery,
    sendDocuments,
    sendJson,
};
