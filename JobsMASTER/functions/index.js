const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");

initializeApp();

exports.proxyStorage = onRequest({ cors: true }, async (req, res) => {
    const filePath = req.query.filePath;
    if (!filePath) {
        return res.status(400).json({ error: 'filePath required' });
    }
    try {
        const bucket = getStorage().bucket();
        const file = bucket.file(filePath);
        const [content] = await file.download();
        res.set('Content-Type', 'application/json');
        res.send(content);
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});
