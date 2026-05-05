const express     = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS     = require('exceljs');
const reportsSvc  = require('../services/reports');
const { requireRole } = require('../middleware/scope');

const router = express.Router();

// GET /api/reports/timekeeping/:cutoff_id
router.get('/timekeeping/:cutoff_id', requireRole('hr', 'admin', 'super_admin'), async (req, res) => {
  try {
    const subdeptId = req.query.subdept_id ? parseInt(req.query.subdept_id, 10) : null;
    const data = await reportsSvc.timekeepingSummary(
      parseInt(req.params.cutoff_id, 10),
      subdeptId,
      req.user
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/reports/payroll/:cutoff_id
router.get('/payroll/:cutoff_id', requireRole('hr', 'admin', 'super_admin'), async (req, res) => {
  try {
    const subdeptId = req.query.subdept_id ? parseInt(req.query.subdept_id, 10) : null;
    const data = await reportsSvc.payrollDataView(
      parseInt(req.params.cutoff_id, 10),
      subdeptId,
      req.user
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/reports/timekeeping/:cutoff_id/excel — Excel export
router.get('/timekeeping/:cutoff_id/excel', requireRole('hr', 'admin', 'super_admin'), async (req, res) => {
  try {
    const subdeptId = req.query.subdept_id ? parseInt(req.query.subdept_id, 10) : null;
    const cutoffId  = parseInt(req.params.cutoff_id, 10);
    const rows      = await reportsSvc.timekeepingSummary(cutoffId, subdeptId, req.user);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Timekeeping Summary');

    ws.columns = [
      { header: 'Employee No.', key: 'employee_number', width: 14 },
      { header: 'Name',         key: 'employee_name',   width: 30 },
      { header: 'Position',     key: 'position_name',   width: 20 },
      { header: 'Department',   key: 'subdepartment_name', width: 20 },
      { header: 'Reg. Hours',   key: 'regular_hours',   width: 12 },
      { header: 'OT Hours',     key: 'ot_hours',        width: 12 },
      { header: 'ND Hours',     key: 'nd_hours',        width: 12 },
      { header: 'Late (hrs)',   key: 'late_hours',      width: 12 },
      { header: 'UT (hrs)',     key: 'undertime_hours', width: 12 },
      { header: 'Break Ded.',   key: 'break_deduct_hours', width: 12 },
      { header: 'Absent Days',  key: 'absent_days',     width: 12 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.addRows(rows);

    const fileName = `timekeeping_cutoff_${cutoffId}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();

    await reportsSvc.logExport({ cutoffId, exportFormat: 'excel', rowCount: rows.length, fileName }, req.user);

  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/reports/timekeeping/:cutoff_id/pdf — PDF export (basic layout)
router.get('/timekeeping/:cutoff_id/pdf', requireRole('hr', 'admin', 'super_admin'), async (req, res) => {
  try {
    const cutoffId  = parseInt(req.params.cutoff_id, 10);
    const subdeptId = req.query.subdept_id ? parseInt(req.query.subdept_id, 10) : null;
    const rows      = await reportsSvc.timekeepingSummary(cutoffId, subdeptId, req.user);

    const doc      = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const fileName = `timekeeping_cutoff_${cutoffId}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);

    doc.fontSize(14).text('MINERVA HRIS — Timekeeping Summary', { align: 'center' });
    doc.fontSize(10).text(`Cutoff ID: ${cutoffId}`, { align: 'center' });
    doc.moveDown();

    const headers = ['Employee No.', 'Name', 'Position', 'Reg.Hrs', 'OT', 'ND', 'Late', 'UT', 'Absent'];
    let x = 40;
    const colWidths = [70, 130, 90, 50, 40, 40, 40, 40, 50];

    doc.fontSize(8).font('Helvetica-Bold');
    headers.forEach((h, i) => { doc.text(h, x, doc.y, { width: colWidths[i], continued: i < headers.length - 1 }); x += colWidths[i]; });
    doc.font('Helvetica');

    for (const row of rows) {
      x = 40;
      const vals = [
        row.employee_number, row.employee_name, row.position_name,
        Number(row.regular_hours).toFixed(2), Number(row.ot_hours).toFixed(2),
        Number(row.nd_hours).toFixed(2), Number(row.late_hours).toFixed(2),
        Number(row.undertime_hours).toFixed(2), row.absent_days,
      ];
      const y = doc.y;
      vals.forEach((v, i) => {
        doc.text(String(v ?? ''), x, y, { width: colWidths[i], continued: i < vals.length - 1 });
        x += colWidths[i];
      });
    }

    doc.end();
    await reportsSvc.logExport({ cutoffId, exportFormat: 'pdf', rowCount: rows.length, fileName }, req.user);

  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
