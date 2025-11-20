const { onRequest } = require("firebase-functions/v2/https");
const { getStorage, ref, getDownloadURL } = require("firebase-admin/storage");

exports.proxyStorage = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    try {
        const filePath = req.query.filePath;
        const storageRef = ref(getStorage(), filePath);
        const url = await getDownloadURL(storageRef);
        res.redirect(url);
    } catch (error) {
        res.status(404).send('File not found');
    }
});