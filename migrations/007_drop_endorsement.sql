-- ============================================================
-- MINERVA HRIS — Drop Unused Endorsement Columns
-- Version: 007 (applies on top of 006_bug_fixes.sql)
-- ============================================================
-- PURPOSE:
--   Remove endorsement-related schema artifacts now that the direct-to-HR
--   approval flow is in place (A3). The coordinator endorsement step was
--   dropped from the MVP; these columns are unreferenced by any service.
--
-- AFFECTED TABLES:
--   tbl_form_upload — endorsement_status column
--   tbl_leave       — endorsed_by column + 'endorsed' enum value on status
-- ============================================================

-- [E1] Drop endorsement_status from tbl_form_upload
ALTER TABLE tbl_form_upload
  DROP COLUMN endorsement_status;

-- [E2] Drop endorsed_by from tbl_leave
ALTER TABLE tbl_leave
  DROP COLUMN endorsed_by;

-- [E3] Remove 'endorsed' from tbl_leave.status enum
--   Restate full ENUM without 'endorsed'; rows in 'endorsed' state should not
--   exist (service never sets it), but add a safety UPDATE first.
UPDATE tbl_leave SET status = 'pending' WHERE status = 'endorsed';

ALTER TABLE tbl_leave
  MODIFY COLUMN status
    ENUM('pending','approved','denied','cancelled') NOT NULL DEFAULT 'pending';
