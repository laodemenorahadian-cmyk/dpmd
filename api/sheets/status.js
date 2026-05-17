const {
    getWriteCredentialStatus,
    sendJson,
    sendOptions,
} = require('../_sheets');

module.exports = async (request, response) => {
    if (request.method === 'OPTIONS') {
        sendOptions(response);
        return;
    }

    if (request.method !== 'GET') {
        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
        return;
    }

    sendJson(response, 200, getWriteCredentialStatus());
};
