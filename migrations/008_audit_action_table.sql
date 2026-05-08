-- Migration 008: Add tbl_audit_action lookup table for UI badge rendering
-- tbl_audit_log.action_type references action_code here (no FK — action_type is free-text for flexibility)
-- This table is seeded by scripts/seed-audit-actions.js

CREATE TABLE IF NOT EXISTS tbl_audit_action (
  action_id    INT AUTO_INCREMENT PRIMARY KEY,
  action_code  VARCHAR(60) NOT NULL,
  label        VARCHAR(100) NOT NULL,
  badge_bg     VARCHAR(20) NOT NULL DEFAULT '#F5F5F5',
  badge_color  VARCHAR(20) NOT NULL DEFAULT '#777777',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_audit_action_code (action_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
