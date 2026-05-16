const {
    findUserByLogin,
    isActiveUser,
    isPasswordMatch,
    readJsonBody,
    sanitizeUser,
    sendJson,
} = require('../_auth');

module.exports = async (request, response) => {
    if (request.method !== 'POST') {
        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
        return;
    }

    try {
        const { username, password } = await readJsonBody(request);

        if (!username || !password) {
            sendJson(response, 400, { message: 'Username/email dan password wajib diisi.' });
            return;
        }

        const user = await findUserByLogin(username);

        if (!user || !isActiveUser(user) || !isPasswordMatch(password, user.password)) {
            sendJson(response, 401, { message: 'Login gagal. Periksa username dan password.' });
            return;
        }

        sendJson(response, 200, { user: sanitizeUser(user) });
    } catch (error) {
        sendJson(response, 500, { message: error.message || 'Login gagal diproses.' });
    }
};
