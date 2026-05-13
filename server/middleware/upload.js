import multer from 'multer';
import { allowedImageExts, allowedImageMimes, maxImageSize } from '../services/FileValidation.js';
import path from 'node:path';

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageSize,
    files: 12,
  },
  fileFilter(_req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedImageExts.has(ext) || !allowedImageMimes.has(file.mimetype)) {
      const error = new Error('只支援 JPG / JPEG / PNG / WEBP / BMP 圖片');
      error.status = 422;
      callback(error);
      return;
    }
    callback(null, true);
  },
});
