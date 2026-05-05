const express  = require('express');
const multer   = require('multer');
const empSvc   = require('../services/employees');
const { requireRole } = require('../middleware/scope');
const auditLog        = require('../middleware/audit');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = express.Router();

// POST /api/employees/import — bulk import from Excel file
// Declared before /:id so Express does not treat the literal 'import' as an ID param
router.post(
  '/import',
  requireRole('hr', 'super_admin'),
  upload.single('file'),
  auditLog('BULK_IMPORT_EMPLOYEES', 'tbl_employees'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Excel file required (field name: file)' });
      }
      const data = await empSvc.bulkImportFromFile(req.file.buffer, req.user);
      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }
);

// POST /api/employees/import/json — bulk import from pre-parsed JSON (for testing)
router.post(
  '/import/json',
  requireRole('hr', 'super_admin'),
  auditLog('BULK_IMPORT_EMPLOYEES', 'tbl_employees'),
  async (req, res) => {
    try {
      const { rows, column_map } = req.body;
      if (!Array.isArray(rows) || !column_map) {
        return res.status(400).json({ success: false, error: 'rows (array) and column_map (object) required' });
      }
      const data = await empSvc.bulkImport(rows, column_map, req.user);
      res.json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }
);

// GET /api/employees
router.get('/', async (req, res) => {
  try {
    const { search, is_active, limit, offset } = req.query;
    const data = await empSvc.list({
      search:   search || null,
      isActive: is_active !== 'false',
      limit:    parseInt(limit  || '100', 10),
      offset:   parseInt(offset || '0',   10),
    }, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/employees/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await empSvc.get(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/employees
router.post(
  '/',
  requireRole('hr', 'super_admin'),
  auditLog('CREATE_EMPLOYEE', 'tbl_employees'),
  async (req, res) => {
    try {
      const data = await empSvc.create(req.body, req.user);
      res.status(201).json({ success: true, data });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }
);

// PUT /api/employees/:id
router.put(
  '/:id',
  requireRole('hr', 'super_admin'),
  auditLog('UPDATE_EMPLOYEE', 'tbl_employees'),
  async (req, res) => {
    try {
      await empSvc.update(parseInt(req.params.id, 10), req.body, req.user);
      res.json({ success: true, message: 'Employee updated' });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }
);

// DELETE /api/employees/:id — soft deactivate only
router.delete(
  '/:id',
  requireRole('hr', 'super_admin'),
  auditLog('DEACTIVATE_EMPLOYEE', 'tbl_employees'),
  async (req, res) => {
    try {
      await empSvc.deactivate(
        parseInt(req.params.id, 10),
        req.body.separation_date,
        req.body.separation_type   ?? null,
        req.body.separation_reason ?? null,
        req.user
      );
      res.json({ success: true, message: 'Employee deactivated' });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
