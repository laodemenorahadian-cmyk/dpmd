const { sendJson } = require('../_auth');

module.exports = async (request, response) => {
    if (request.method !== 'POST') {
        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
        return;
    }

    sendJson(response, 200, { ok: true });
};
