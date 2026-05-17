const {
    assertSuperAdmin,
    createSheetsReadClient,
    createSheetsWriteClient,
    getQuery,
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

    try {
        if (request.method === 'GET') {
            const query = getQuery(request);
            const spreadsheetId = getSpreadsheetId(query.spreadsheetId);
            const range = String(query.range || '').trim();

            if (!range) {
                sendJson(response, 400, { message: 'Parameter range wajib diisi.' });
                return;
            }

            const sheets = await createSheetsReadClient();
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
                majorDimension: 'ROWS',
            });

            sendJson(response, 200, { values: result.data.values || [] });
            return;
        }

        if (request.method === 'PUT') {
            assertSuperAdmin(request);

            const body = await readJsonBody(request);
            const spreadsheetId = getSpreadsheetId(body.spreadsheetId);
            const range = String(body.range || '').trim();

            if (!range || !Array.isArray(body.values)) {
                sendJson(response, 400, { message: 'Range dan values wajib diisi.' });
                return;
            }

            const sheets = await createSheetsWriteClient();
            const result = await sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: body.valueInputOption || 'USER_ENTERED',
                requestBody: {
                    majorDimension: body.majorDimension || 'ROWS',
                    values: body.values,
                },
            });

            sendJson(response, 200, {
                updatedRange: result.data.updatedRange,
                updatedRows: result.data.updatedRows,
                updatedColumns: result.data.updatedColumns,
                updatedCells: result.data.updatedCells,
            });
            return;
        }

        sendJson(response, 405, { message: 'Method tidak diizinkan.' });
    } catch (error) {
        handleApiError(response, error, 'Google Sheets gagal diproses.');
    }
};
