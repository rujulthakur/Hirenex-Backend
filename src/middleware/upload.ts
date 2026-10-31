import multer from 'multer';

export const MAX_UPLOAD_FILES = 50;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Memory storage only: uploads are never written to disk.
 * Used by the resume route (Prompt 6) with field name "files".
 */
export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_UPLOAD_FILES, fileSize: MAX_UPLOAD_BYTES, fields: 5, parts: MAX_UPLOAD_FILES + 5 },
});
