import path from 'node:path';
import { config } from '../config/index.js';

const extByMime = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
};

export const allowedImageMimes = new Set(config.allowedImageTypes);
export const allowedImageExts = new Set(config.allowedImageTypes.flatMap((mime) => extByMime[mime] || []));
export const maxImageSize = config.maxUploadMb * 1024 * 1024;
export const maxImagesPerTask = 10;

export function validateImageFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!allowedImageExts.has(ext)) {
    throw validationError(`不支援的副檔名：${ext || 'unknown'}`);
  }
  if (!allowedImageMimes.has(file.mimetype)) {
    throw validationError(`不支援的 MIME 類型：${file.mimetype || 'unknown'}`);
  }
  if (Number(file.size || 0) > maxImageSize) {
    throw validationError(`Image must be ${config.maxUploadMb}MB or smaller.`);
  }
}

export function validateImageFiles(files, min = 1, max = maxImagesPerTask) {
  const list = files || [];
  if (list.length < min) {
    throw validationError('請至少上傳 1 張圖片');
  }
  if (list.length > max) {
    throw validationError('每次最多上傳 10 張圖片');
  }
  list.forEach(validateImageFile);
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}
