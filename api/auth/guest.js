const {
    createGuestProfile,
    findGuestUser,
    sanitizeUser,
    sendJson,
} = require('../_auth');

module.exports = async (request, response) => {
    if (request.method !== 'POST') {
        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
        return;
    }

    try {
        const guestUser = createGuestProfile(await findGuestUser());
        sendJson(response, 200, { user: sanitizeUser(guestUser) });
    } catch (error) {
        sendJson(response, 500, { message: error.message || 'Login tamu gagal diproses.' });
    }
};
