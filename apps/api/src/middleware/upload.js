const fs = require('fs');
const path = require('path');
const multer = require('multer');

// image/svg+xml deliberately excluded: an SVG can embed a <script> tag, and
// /uploads is served statically and unauthenticated (app.js) — an admin
// opening an uploaded "screenshot" URL directly in a tab would execute it.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Exported as a pure function (rather than inlined in fileFilter) so it's
// unit-testable without exercising multer/disk I/O.
function isAllowedImageType(mimetype) {
  return ALLOWED_MIME_TYPES.has(mimetype);
}

function makeUploader(subdir) {
  const dir = path.join(__dirname, '../../uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (isAllowedImageType(file.mimetype)) cb(null, true);
      else cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed'));
    }
  });
}

const complaintUpload = makeUploader('complaints');
const visitorUpload = makeUploader('visitors');
const financeUpload = makeUploader('finance');
const bugUpload = makeUploader('bugs');

function optionalImageUpload(upload) {
  return (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    }
    next();
  };
}

const optionalComplaintImage = optionalImageUpload(complaintUpload);
const optionalVisitorImage = optionalImageUpload(visitorUpload);
const optionalFinanceImage = optionalImageUpload(financeUpload);
const optionalBugImage = optionalImageUpload(bugUpload);

module.exports = {
  optionalComplaintImage,
  optionalVisitorImage,
  optionalFinanceImage,
  optionalBugImage,
  isAllowedImageType,
  uploadsDir: path.join(__dirname, '../../uploads/complaints')
};
