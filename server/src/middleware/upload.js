import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const MB = 1024 * 1024;

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
const gifTypes = ['image/gif'];
const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'video/mp4'];

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

function safeName(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const base = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${base}${ext}`;
}

function storageFor(category) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const target = path.join(env.uploadDir, category);
      ensureDir(target);
      cb(null, target);
    },
    filename: (req, file, cb) => cb(null, safeName(file))
  });
}

function uploadFor(category, allowedTypes, maxSizeMb) {
  return multer({
    storage: storageFor(category),
    limits: { fileSize: maxSizeMb * MB },
    fileFilter: (req, file, cb) => {
      if (!allowedTypes.includes(file.mimetype)) {
        cb(badRequest('Formato de arquivo nao permitido.'));
        return;
      }
      cb(null, true);
    }
  });
}

export const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * MB },
  fileFilter: (req, file, cb) => {
    if (!imageTypes.includes(file.mimetype)) {
      cb(badRequest('Formato de arquivo nao permitido.'));
      return;
    }
    cb(null, true);
  }
}).single('photo');

export const assessmentPhotosUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * MB },
  fileFilter: (req, file, cb) => {
    if (!imageTypes.includes(file.mimetype)) {
      cb(badRequest('Formato de arquivo nao permitido.'));
      return;
    }
    cb(null, true);
  }
}).fields([
  { name: 'front', maxCount: 1 },
  { name: 'side', maxCount: 1 },
  { name: 'back', maxCount: 1 }
]);

export const exerciseMediaUpload = multer({
  storage: storageFor('exercises'),
  limits: { fileSize: 8 * MB },
  fileFilter: (req, file, cb) => {
    const allowed = {
      video: videoTypes,
      gif: gifTypes,
      audio: audioTypes
    };

    if (!allowed[file.fieldname]?.includes(file.mimetype)) {
      cb(badRequest('Formato de midia do exercicio nao permitido.'));
      return;
    }

    cb(null, true);
  }
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'gif', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]);

export function relativeUploadPath(category, file) {
  if (!file) return null;
  return `${category}/${file.filename}`;
}
