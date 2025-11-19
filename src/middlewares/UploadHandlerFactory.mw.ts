import multer from 'multer';
import { Logger } from '@smythos/sdk/core';
const console = Logger('UploadHandlerFactory.mw');

const MAX_FILE_SIZE = 1024 * 1024 * 20; // 20MB
const MAX_FILE_COUNT = 5;

export default function uploadHandlerFactory(maxFileSize: number = MAX_FILE_SIZE, maxFileCount: number = MAX_FILE_COUNT) {
    const upload = multer({
        limits: { fileSize: maxFileSize },
        storage: multer.memoryStorage(),
    });

    function uploadHandler(req, res, next) {
        upload.any()(req, res, (err) => {
            if (err) {
                console.warn(`File upload error: ${err.message}`);
                return next(new Error(`File upload error: ${err.message}`));
            }

            if (req.files && req.files.length > maxFileCount) {
                console.warn(`Too many files: ${req.files.length}`);
                return res.status(400).send('Too many files');
            }

            next();
        });
    }

    return uploadHandler;
}
