const {
    getRequestQuery,
    sendDocuments,
    sendJson,
    sendOptions,
} = require('../_documents');

module.exports = async (request, response) => {
    if (request.method === 'OPTIONS') {
        sendOptions(response);
        return;
    }

    if (request.method !== 'GET') {
        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
        return;
    }

    const query = getRequestQuery(request);
    await sendDocuments(request, response, query.q || '');
};
