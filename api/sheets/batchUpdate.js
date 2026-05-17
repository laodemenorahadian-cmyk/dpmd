const {
    assertSuperAdmin,
    createSheetsWriteClient,
    getSpreadsheetId,
    handleApiError,
    readJsonBody,
    sendJson,
    sendOptions,
} = require('../_sheets');

module.exports = async (request, response) => {
    if (request.method === 'OPTIONS') {
        sendOptions(response);
        return;
    }

    if (request.method !== 'POST') {
        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
        return;
    }

    try {
        assertSuperAdmin(request);

        const body = await readJsonBody(request);
        const spreadsheetId = getSpreadsheetId(body.spreadsheetId);
        const data = Array.isArray(body.data) ? body.data : [];

        if (!data.length) {
            sendJson(response, 400, { message: 'Data perubahan wajib diisi.' });
            return;
        }

        const sheets = await createSheetsWriteClient();
        const result = await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: body.valueInputOption || 'USER_ENTERED',
                data,
            },
        });

        sendJson(response, 200, {
            totalUpdatedRows: result.data.totalUpdatedRows,
            totalUpdatedColumns: result.data.totalUpdatedColumns,
            totalUpdatedCells: result.data.totalUpdatedCells,
        });
    } catch (error) {
        handleApiError(response, error, 'Google Sheets gagal disimpan.');
    }
};
