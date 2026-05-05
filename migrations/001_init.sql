-- ============================================================
-- MINERVA HRIS — Complete Database Schema
-- Version: 5.0 (Finalized Pre-Documentation Pass)
-- Scope: Minerva (client-specific) with Julie-ready extensions
-- Companies: Urban Travellers Hotel (UTH) + Shogun Suite Hotel (SSH)
-- ============================================================
-- Design Rules:
--   1. No hard deletes. All deactivations use is_active flags.
--   2. All tables carry created_at, created_by, updated_at, updated_by.
--   3. Every significant action writes to tbl_audit_log (append-only).
--   4. Monetary values use decimal(10,2). Never int.
--   5. ip_address fields use varchar(45) for IPv4 and IPv6.
--   6. Grace period and time window values stored in minutes.
--   7. Coordinator accounts scoped via tbl_user_scope.
--   8. Timekeeping for midnight-crossing shifts dated to shift start date.
--   9. No ON DELETE CASCADE on any FK. Use is_active for deactivation.
--  10. Julie-only features marked with -- [JULIE ONLY] comments.
-- ============================================================
-- SOURCE: reference/CONTEXT_SUMMARY_UNO.md Section 9
-- Apply this file first, then 002_patches.sql, then 003_seed_and_finalize.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE tbl_company (
  company_id          INT AUTO_INCREMENT PRIMARY KEY,
  company_name        VARCHAR(150) NOT NULL,
  legal_entity_name   VARCHAR(200) NULL,
  tin                 VARCHAR(30) NULL,
  address             VARCHAR(300) NULL,
  province            VARCHAR(100) NULL,
  contact_person      VARCHAR(100) NULL,
  contact_number      VARCHAR(20) NULL,
  email               VARCHAR(100) NULL,
  sss_employer_number VARCHAR(30) NULL,
  philhealth_employer_number VARCHAR(30) NULL,
  pagibig_employer_number    VARCHAR(30) NULL,
  region              VARCHAR(100) NULL,
  cutoff_anchor_date  DATE NULL,
  cutoff_cycle_days   INT NOT NULL DEFAULT 15,
  dole_notified_broken_time   BOOLEAN NOT NULL DEFAULT FALSE,
  dole_notified_forced_leave  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  UNIQUE KEY uq_company_name (company_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_wage_floor (
  wage_floor_id   INT AUTO_INCREMENT PRIMARY KEY,
  region          VARCHAR(100) NOT NULL,
  daily_rate      DECIMAL(10,2) NOT NULL,
  monthly_rate    DECIMAL(10,2) NOT NULL,
  effective_date  DATE NOT NULL,
  wage_order_ref  VARCHAR(100) NULL,
  notes           TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  UNIQUE KEY uq_wage_floor_region_date (region, effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_department (
  department_id   INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT NOT NULL,
  department_name VARCHAR(100) NOT NULL,
  department_code VARCHAR(20) NULL,
  description     TEXT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  updated_at      TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by      INT NULL,
  UNIQUE KEY uq_dept_name_company (department_name, company_id),
  CONSTRAINT fk_dept_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_subdepartment (
  subdepartment_id   INT AUTO_INCREMENT PRIMARY KEY,
  department_id      INT NOT NULL,
  company_id         INT NOT NULL,
  subdepartment_name VARCHAR(100) NOT NULL,
  subdepartment_code VARCHAR(20) NULL,
  description        TEXT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_subdept_name_dept (subdepartment_name, department_id),
  CONSTRAINT fk_subdept_dept    FOREIGN KEY (department_id) REFERENCES tbl_department(department_id),
  CONSTRAINT fk_subdept_company FOREIGN KEY (company_id)   REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_position (
  position_id      INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  position_name    VARCHAR(150) NOT NULL,
  position_code    VARCHAR(20) NULL,
  is_managerial    BOOLEAN NOT NULL DEFAULT FALSE,
  min_employees    INT NULL,
  description      TEXT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_position_name_subdept (position_name, subdepartment_id),
  CONSTRAINT fk_position_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_station (
  station_id       INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  station_name     VARCHAR(100) NOT NULL,
  is_seasonal      BOOLEAN NOT NULL DEFAULT FALSE,
  season_start_month TINYINT NULL,
  season_end_month   TINYINT NULL,
  notes            VARCHAR(500) NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_station_name_subdept (station_name, subdepartment_id),
  CONSTRAINT fk_station_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employment_type (
  employment_type_id INT AUTO_INCREMENT PRIMARY KEY,
  employment_type    VARCHAR(60) NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_employment_type (employment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_status (
  employee_status_id INT AUTO_INCREMENT PRIMARY KEY,
  employment_status  VARCHAR(60) NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_employee_status (employment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employees (
  employee_id            INT AUTO_INCREMENT PRIMARY KEY,
  employee_number        VARCHAR(30) NOT NULL,
  last_name              VARCHAR(60) NOT NULL,
  first_name             VARCHAR(60) NOT NULL,
  middle_name            VARCHAR(60) NULL,
  middle_initial         CHAR(1) NULL,
  name_suffix            VARCHAR(10) NULL,
  company_id             INT NOT NULL,
  department_id          INT NOT NULL,
  subdepartment_id       INT NOT NULL,
  employment_type_id     INT NOT NULL,
  employee_status_id     INT NOT NULL,
  date_hired             DATE NOT NULL,
  training_start_date    DATE NULL,
  training_end_date      DATE NULL,
  probationary_start_date DATE NULL,
  date_regularized       DATE NULL,
  date_separated         DATE NULL,
  separation_type        ENUM('resigned','end_of_contract','terminated_just_cause',
                              'terminated_authorized_cause','awol','retirement','death') NULL,
  separation_reason      VARCHAR(500) NULL,
  final_clearance        BOOLEAN NULL,
  schedule_eligible_from_cutoff_id INT NULL,
  basic_salary           DECIMAL(10,2) NULL,
  previous_salary        DECIMAL(10,2) NULL,
  allowance              DECIMAL(10,2) NULL,
  has_allowance_integrated BOOLEAN NOT NULL DEFAULT FALSE,
  payroll_type           ENUM('Monthly','Semi-monthly','Weekly','Daily') NULL,
  payroll_cycle          ENUM('Monthly','Semi-monthly','Weekly','Daily') NULL,
  pay_class              ENUM('Salaried','Daily-paid','Hourly') NULL,
  pay_factor             SMALLINT NULL DEFAULT 313,
  payroll_account_number VARCHAR(60) NULL,
  sss_number             VARCHAR(30) NULL,
  philhealth_number      VARCHAR(30) NULL,
  pagibig_number         VARCHAR(30) NULL,
  tin_number             VARCHAR(30) NULL,
  sss_coverage           BOOLEAN NOT NULL DEFAULT TRUE,
  philhealth_coverage    BOOLEAN NOT NULL DEFAULT TRUE,
  pagibig_coverage       BOOLEAN NOT NULL DEFAULT TRUE,
  gender                 VARCHAR(20) NULL,
  civil_status           VARCHAR(30) NULL,
  date_of_birth          DATE NULL,
  present_address        TEXT NULL,
  province               VARCHAR(100) NULL,
  contact_number         VARCHAR(20) NULL,
  email_address          VARCHAR(150) NULL,
  dependent_count        SMALLINT NULL,
  education_attainment   VARCHAR(150) NULL,
  education_course       VARCHAR(200) NULL,
  biometric_device_uid   VARCHAR(50) NULL,
  biometric_name         VARCHAR(100) NULL,
  biometric_sync_status  ENUM('not_enrolled','enrolled','sync_pending','sync_conflict','sync_failed') NULL,
  import_batch_id        VARCHAR(50) NULL,
  remarks                TEXT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             INT NULL,
  updated_at             TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT NULL,
  UNIQUE KEY uq_employee_number_company (employee_number, company_id),
  KEY idx_emp_company     (company_id),
  KEY idx_emp_subdept     (subdepartment_id),
  KEY idx_emp_status      (employee_status_id),
  KEY idx_emp_biometric   (biometric_device_uid),
  CONSTRAINT fk_emp_company     FOREIGN KEY (company_id)         REFERENCES tbl_company(company_id),
  CONSTRAINT fk_emp_department  FOREIGN KEY (department_id)      REFERENCES tbl_department(department_id),
  CONSTRAINT fk_emp_subdept     FOREIGN KEY (subdepartment_id)   REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_emp_emp_type    FOREIGN KEY (employment_type_id) REFERENCES tbl_employment_type(employment_type_id),
  CONSTRAINT fk_emp_status      FOREIGN KEY (employee_status_id) REFERENCES tbl_employee_status(employee_status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_position (
  employee_position_id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id          INT NOT NULL,
  position_id          INT NOT NULL,
  is_primary           BOOLEAN NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  position_start_date  DATE NULL,
  position_end_date    DATE NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by           INT NULL,
  updated_at           TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by           INT NULL,
  CONSTRAINT fk_emppos_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_emppos_position FOREIGN KEY (position_id) REFERENCES tbl_position(position_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_emergency_contact (
  contact_id   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT NOT NULL,
  contact_name VARCHAR(150) NOT NULL,
  relationship VARCHAR(60) NULL,
  contact_number VARCHAR(20) NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   INT NULL,
  updated_at   TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by   INT NULL,
  CONSTRAINT fk_emerg_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_employment_history (
  history_id         INT AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT NOT NULL,
  employment_type_id INT NULL,
  employee_status_id INT NULL,
  position_id        INT NULL,
  start_date         DATE NOT NULL,
  end_date           DATE NULL,
  notes              TEXT NULL,
  recorded_by        INT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_emphistory_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_document (
  document_id   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id   INT NOT NULL,
  document_type ENUM('employment_contract','government_id','educational_credential',
                     'performance_appraisal','disciplinary_record','clearance',
                     'medical_certificate','other') NOT NULL,
  file_path     VARCHAR(500) NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  description   VARCHAR(500) NULL,
  uploaded_by   INT NOT NULL,
  upload_date   DATE NOT NULL,
  notes         TEXT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_empdoc_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_position_rate (
  rate_id             INT AUTO_INCREMENT PRIMARY KEY,
  position_id         INT NOT NULL,
  company_id          INT NOT NULL,
  basic_daily         DECIMAL(10,2) NOT NULL,
  basic_monthly       DECIMAL(10,2) NOT NULL,
  salary_band_label   VARCHAR(30) NULL,
  effective_date      DATE NOT NULL,
  wage_order_reference VARCHAR(100) NULL,
  notes               TEXT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  CONSTRAINT fk_posrate_position FOREIGN KEY (position_id) REFERENCES tbl_position(position_id),
  CONSTRAINT fk_posrate_company  FOREIGN KEY (company_id)  REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_device_adapter (
  adapter_id    INT AUTO_INCREMENT PRIMARY KEY,
  adapter_name  VARCHAR(100) NOT NULL,
  adapter_key   VARCHAR(50) NOT NULL,
  protocol      ENUM('tcp_ip','http_rest','websocket','sdk','mobile') NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT NULL,
  UNIQUE KEY uq_adapter_key (adapter_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_device (
  device_id        INT AUTO_INCREMENT PRIMARY KEY,
  company_id       INT NOT NULL,
  adapter_id       INT NOT NULL,
  device_code      VARCHAR(50) NOT NULL,
  device_name      VARCHAR(100) NOT NULL,
  device_type      VARCHAR(60) NOT NULL,
  location         VARCHAR(200) NOT NULL,
  ip_address       VARCHAR(45) NULL,
  serial_number    VARCHAR(60) NULL,
  firmware_version VARCHAR(30) NULL,
  sync_interval    INT NOT NULL DEFAULT 15,
  last_sync_at     TIMESTAMP NULL,
  last_sync_count  INT NULL,
  status           ENUM('online','offline','error','maintenance') NOT NULL DEFAULT 'online',
  last_error_code  VARCHAR(100) NULL,
  pairing_code     VARCHAR(20) NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_device_code (device_code),
  CONSTRAINT fk_device_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id),
  CONSTRAINT fk_device_adapter FOREIGN KEY (adapter_id) REFERENCES tbl_device_adapter(adapter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_biometric_enrollment (
  enrollment_id   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id     INT NOT NULL,
  device_id       INT NOT NULL,
  device_user_id  INT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  enrolled_at     TIMESTAMP NULL,
  enrolled_by     INT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_user (device_id, device_user_id),
  CONSTRAINT fk_bioenroll_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_bioenroll_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_biometric_enrollment_log (
  log_id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT NOT NULL,
  device_id           INT NOT NULL,
  attempted_uid       INT NOT NULL,
  result              ENUM('success','conflict','failed') NOT NULL,
  conflict_employee_id INT NULL,
  error_message       VARCHAR(500) NULL,
  performed_by        INT NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_biolog_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_biolog_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_device_sync_log (
  sync_id         INT AUTO_INCREMENT PRIMARY KEY,
  device_id       INT NOT NULL,
  synced_at       TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP NULL,
  record_count    INT NULL,
  resolved_count  INT NULL,
  unresolved_count INT NULL,
  status          ENUM('in_progress','success','partial','failed') NOT NULL,
  error_code      VARCHAR(100) NULL,
  triggered_by    ENUM('scheduled','manual') NOT NULL,
  triggered_by_user INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_synclog_device FOREIGN KEY (device_id) REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_raw_device_logs (
  rdl_id                 INT AUTO_INCREMENT PRIMARY KEY,
  device_id              INT NOT NULL,
  sync_id                INT NULL,
  ac_no                  VARCHAR(20) NOT NULL,
  device_user_id         INT NOT NULL,
  employee_id            INT NULL,
  employee_name_raw      VARCHAR(100) NOT NULL,
  record_time            TIMESTAMP NOT NULL,
  state                  VARCHAR(20) NOT NULL,
  new_state              VARCHAR(50) NULL,
  exception              VARCHAR(50) NULL,
  operation              VARCHAR(50) NULL,
  verify_type            VARCHAR(30) NULL,
  ip                     VARCHAR(45) NULL,
  reconciliation_status  ENUM('unresolved','resolved','unresolvable') NOT NULL DEFAULT 'unresolved',
  reconciliation_note    VARCHAR(500) NULL,
  is_processed           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             INT NULL,
  updated_at             TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT NULL,
  CONSTRAINT fk_rdl_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id),
  CONSTRAINT fk_rdl_sync     FOREIGN KEY (sync_id)     REFERENCES tbl_device_sync_log(sync_id),
  CONSTRAINT fk_rdl_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift (
  shift_id          INT AUTO_INCREMENT PRIMARY KEY,
  shift_name        VARCHAR(60) NOT NULL,
  time_in           TIME NOT NULL,
  time_out          TIME NOT NULL,
  crosses_midnight  BOOLEAN NOT NULL DEFAULT FALSE,
  grace_period      INT NOT NULL DEFAULT 30,
  has_break         BOOLEAN NOT NULL DEFAULT TRUE,
  total_hours       DECIMAL(5,2) NULL,
  remarks           TEXT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        INT NULL,
  updated_at        TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT NULL,
  UNIQUE KEY uq_shift_name (shift_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift_slot (
  slot_id          INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  slot_label       VARCHAR(60) NOT NULL,
  slot_order       TINYINT NOT NULL,
  is_reliever      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_slot_label_subdept (subdepartment_id, slot_label),
  UNIQUE KEY uq_slot_order_subdept (subdepartment_id, slot_order),
  CONSTRAINT fk_slot_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift_pool (
  pool_id          INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  shift_id         INT NOT NULL,
  shift_sequence_order INT NOT NULL,
  shift_display_label  VARCHAR(60) NULL,
  is_graveyard     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_pool_subdept_shift    (subdepartment_id, shift_id),
  UNIQUE KEY uq_pool_subdept_seqorder (subdepartment_id, shift_sequence_order),
  CONSTRAINT fk_pool_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_pool_shift   FOREIGN KEY (shift_id)         REFERENCES tbl_shift(shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_subdept_rest_day_config (
  config_id        INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  day_of_week      ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  is_default_rest_day BOOLEAN NOT NULL DEFAULT FALSE,
  is_configurable  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_rest_subdept_day (subdepartment_id, day_of_week),
  CONSTRAINT fk_restday_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_cutoff_period (
  cutoff_id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id           INT NOT NULL,
  cutoff_name          VARCHAR(60) NOT NULL,
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  drafting_opens_at    TIMESTAMP NULL,
  lock_in_starts_at    TIMESTAMP NULL,
  is_locked            BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed            BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at            TIMESTAMP NULL,
  closed_by            INT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by           INT NULL,
  CONSTRAINT fk_cutoff_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_cutoff_schedule_status (
  status_id        INT AUTO_INCREMENT PRIMARY KEY,
  cutoff_id        INT NOT NULL,
  subdepartment_id INT NOT NULL,
  schedule_state   ENUM('pending','open','closing','locked') NOT NULL DEFAULT 'pending',
  is_published     BOOLEAN NOT NULL DEFAULT FALSE,
  published_at     TIMESTAMP NULL,
  published_by     INT NULL,
  publish_source   ENUM('manual','auto_previous','force_hr') NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cutoff_status (cutoff_id, subdepartment_id),
  CONSTRAINT fk_cutoffstatus_cutoff  FOREIGN KEY (cutoff_id)        REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_cutoffstatus_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule (
  schedule_id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id           INT NOT NULL,
  cutoff_id             INT NOT NULL,
  subdepartment_id      INT NOT NULL,
  slot_id               INT NULL,
  station_id            INT NULL,
  shift_id              INT NULL,
  continuation_shift_id INT NULL,
  date                  DATE NOT NULL,
  day_of_week           ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  start_date            DATE NULL,
  end_date              DATE NULL,
  is_rest_day           BOOLEAN NOT NULL DEFAULT FALSE,
  is_draft              BOOLEAN NOT NULL DEFAULT TRUE,
  is_reliever           BOOLEAN NOT NULL DEFAULT FALSE,
  relieving_for_employee_id INT NULL,
  shift_order           TINYINT NULL,
  sched_type            ENUM('regular','off','absent','on_leave','fvl','dod','regot',
                             'changeoff','holiday','absent_with_notice') NULL,
  is_ot                 BOOLEAN NOT NULL DEFAULT FALSE,
  night_diff            BOOLEAN NOT NULL DEFAULT FALSE,
  flex_time_in          TIME NULL,
  flex_time_out         TIME NULL,
  effective_date        DATE NOT NULL,
  hr_override           BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason       VARCHAR(500) NULL,
  remarks               TEXT NULL,
  is_holiday            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            INT NULL,
  updated_at            TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by            INT NULL,
  UNIQUE KEY uq_schedule_emp_date (employee_id, date),
  KEY idx_schedule_cutoff (cutoff_id),
  KEY idx_schedule_subdept (subdepartment_id),
  CONSTRAINT fk_sched_employee     FOREIGN KEY (employee_id)             REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_sched_cutoff       FOREIGN KEY (cutoff_id)               REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_sched_subdept      FOREIGN KEY (subdepartment_id)        REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_sched_slot         FOREIGN KEY (slot_id)                 REFERENCES tbl_shift_slot(slot_id),
  CONSTRAINT fk_sched_station      FOREIGN KEY (station_id)              REFERENCES tbl_station(station_id),
  CONSTRAINT fk_sched_shift        FOREIGN KEY (shift_id)                REFERENCES tbl_shift(shift_id),
  CONSTRAINT fk_sched_continuation FOREIGN KEY (continuation_shift_id)  REFERENCES tbl_shift(shift_id),
  CONSTRAINT fk_sched_reliever_for FOREIGN KEY (relieving_for_employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule_date_annotation (
  annotation_id   INT AUTO_INCREMENT PRIMARY KEY,
  schedule_id     INT NOT NULL,
  employee_id     INT NOT NULL,
  date            DATE NOT NULL,
  annotation_type ENUM('off','day_off','absent','absent_with_notice','on_leave','fvl',
                       'holiday_work','dod','regular_ot','change_off','admin_duty',
                       'reliever_active') NOT NULL,
  custom_label    VARCHAR(100) NULL,
  custom_time_in  TIME NULL,
  custom_time_out TIME NULL,
  activates_dod   BOOLEAN NOT NULL DEFAULT FALSE,
  activates_ot    BOOLEAN NOT NULL DEFAULT FALSE,
  notes           VARCHAR(500) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  UNIQUE KEY uq_annotation_emp_date_type (employee_id, date, annotation_type),
  CONSTRAINT fk_annotation_schedule FOREIGN KEY (schedule_id) REFERENCES tbl_schedule(schedule_id),
  CONSTRAINT fk_annotation_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule_exception (
  exception_id             INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              INT NOT NULL,
  cutoff_id                INT NOT NULL,
  date                     DATE NOT NULL,
  original_shift_id        INT NULL,
  override_shift_id        INT NULL,
  relief_type              ENUM('shift_exchange','emergency_coverage','early_departure_coverage',
                                'event_coverage','reliever_activation') NULL,
  relief_start_time        TIME NULL,
  relief_end_time          TIME NULL,
  form_upload_id           INT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by               INT NULL,
  updated_at               TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by               INT NULL,
  UNIQUE KEY uq_exception_emp_date (employee_id, date),
  CONSTRAINT fk_exception_employee  FOREIGN KEY (employee_id)       REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_exception_cutoff    FOREIGN KEY (cutoff_id)         REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_exception_origshift FOREIGN KEY (original_shift_id) REFERENCES tbl_shift(shift_id),
  CONSTRAINT fk_exception_ovrdshift FOREIGN KEY (override_shift_id) REFERENCES tbl_shift(shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule_event (
  event_id         INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  cutoff_id        INT NOT NULL,
  station_id       INT NULL,
  event_date       DATE NOT NULL,
  event_name       VARCHAR(200) NOT NULL,
  notes            TEXT NULL,
  external_ref     VARCHAR(200) NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  CONSTRAINT fk_event_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_event_cutoff  FOREIGN KEY (cutoff_id)        REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_event_station FOREIGN KEY (station_id)       REFERENCES tbl_station(station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_timekeeping (
  timekeeping_id      INT AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT NOT NULL,
  schedule_id         INT NULL,
  cutoff_id           INT NOT NULL,
  date                DATE NOT NULL,
  day_of_week         VARCHAR(10) NULL,
  segment_order       TINYINT NOT NULL DEFAULT 1,
  is_continuation     BOOLEAN NOT NULL DEFAULT FALSE,
  time_in             TIME NULL,
  time_out            TIME NULL,
  scheduled_time_in   TIME NULL,
  scheduled_time_out  TIME NULL,
  segment_hours       DECIMAL(5,2) NULL,
  gap_minutes_before_segment SMALLINT NULL,
  total_hours_day     DECIMAL(5,2) NULL,
  is_override         BOOLEAN NOT NULL DEFAULT FALSE,
  day_scenario        ENUM('regular','rest_day','regular_holiday','special_holiday',
                           'regular_holiday_rest_day','special_holiday_rest_day') NULL,
  ot_multiplier_snapshot  DECIMAL(4,2) NULL,
  nd_rate_snapshot        DECIMAL(4,2) NULL,
  is_late             BOOLEAN NOT NULL DEFAULT FALSE,
  late_minutes        SMALLINT NULL,
  is_absent           BOOLEAN NOT NULL DEFAULT FALSE,
  ot_approval_status  ENUM('not_required','pending_form','form_approved','flagged_no_form') NULL,
  anomaly_flag        BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_notes       TEXT NULL,
  supervisor_verified BOOLEAN NOT NULL DEFAULT FALSE,
  break_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  ot_form_required    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  UNIQUE KEY uq_tk_employee_date_segment (employee_id, date, segment_order),
  KEY idx_tk_cutoff   (cutoff_id),
  KEY idx_tk_employee (employee_id),
  CONSTRAINT fk_tk_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_tk_schedule FOREIGN KEY (schedule_id) REFERENCES tbl_schedule(schedule_id),
  CONSTRAINT fk_tk_cutoff   FOREIGN KEY (cutoff_id)   REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_deduction (
  deduction_id     INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id   INT NOT NULL,
  cutoff_id        INT NOT NULL,
  date             DATE NOT NULL,
  late             DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  undertime        DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  halfday          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_absent        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_deduction_tk (timekeeping_id),
  CONSTRAINT fk_deduction_tk     FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_deduction_cutoff FOREIGN KEY (cutoff_id)      REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_additional (
  additional_id    INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id   INT NOT NULL,
  cutoff_id        INT NOT NULL,
  date             DATE NOT NULL,
  early_ot         DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  late_ot          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  night_diff       DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  ot_multiplier_snapshot DECIMAL(4,2) NULL,
  nd_rate_snapshot       DECIMAL(4,2) NULL,
  ot_approval_status ENUM('not_required','pending_form','form_approved','flagged_no_form') NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_additional_tk (timekeeping_id),
  CONSTRAINT fk_additional_tk     FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_additional_cutoff FOREIGN KEY (cutoff_id)      REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_dod (
  dod_id           INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id   INT NOT NULL,
  cutoff_id        INT NOT NULL,
  date             DATE NOT NULL,
  dod_ot           DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  dod_nd           DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  dod_multiplier   DECIMAL(4,2) NOT NULL DEFAULT 1.30,
  holiday_type     ENUM('none','regular_holiday','special_holiday') NOT NULL DEFAULT 'none',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_dod_tk (timekeeping_id),
  CONSTRAINT fk_dod_tk     FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_dod_cutoff FOREIGN KEY (cutoff_id)      REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_time_override (
  override_id    INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id INT NOT NULL,
  override_type  ENUM('missed_punch_in','missed_punch_out','incorrect_punch_direction',
                      'wrong_datetime','duplicate_punch','wrong_device',
                      'device_offline_absence','retroactive_schedule_correction',
                      'attendance_status_correction') NOT NULL,
  requested_by   INT NOT NULL,
  old_time_in    TIME NULL,
  new_time_in    TIME NULL,
  old_time_out   TIME NULL,
  new_time_out   TIME NULL,
  new_schedule_id INT NULL,
  reason         VARCHAR(500) NOT NULL,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by    INT NULL,
  reviewed_at    TIMESTAMP NULL,
  review_note    VARCHAR(500) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     INT NULL,
  updated_at     TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by     INT NULL,
  CONSTRAINT fk_override_tk       FOREIGN KEY (timekeeping_id)  REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_override_newsched FOREIGN KEY (new_schedule_id) REFERENCES tbl_schedule(schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_holiday (
  holiday_id      INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT NULL,
  holiday_date    DATE NOT NULL,
  holiday_name    VARCHAR(150) NOT NULL,
  holiday_type    ENUM('regular','special_non_working','special_working') NOT NULL,
  is_proclamation BOOLEAN NOT NULL DEFAULT FALSE,
  year            INT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  updated_at      TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by      INT NULL,
  CONSTRAINT fk_holiday_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_type (
  leave_type_id       INT AUTO_INCREMENT PRIMARY KEY,
  leave_type          VARCHAR(80) NOT NULL,
  is_statutory        BOOLEAN NOT NULL DEFAULT FALSE,
  is_cash_convertible BOOLEAN NOT NULL DEFAULT FALSE,
  sss_reimbursable    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  UNIQUE KEY uq_leave_type (leave_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_config (
  leave_config_id    INT AUTO_INCREMENT PRIMARY KEY,
  employment_type_id INT NOT NULL,
  leave_type_id      INT NOT NULL,
  annual_days        DECIMAL(5,2) NOT NULL,
  effective_date     DATE NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_leave_config_emptype_leavetype (employment_type_id, leave_type_id),
  CONSTRAINT fk_leaveconfig_emptype   FOREIGN KEY (employment_type_id) REFERENCES tbl_employment_type(employment_type_id),
  CONSTRAINT fk_leaveconfig_leavetype FOREIGN KEY (leave_type_id)      REFERENCES tbl_leave_type(leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_tier_config (
  tier_id       INT AUTO_INCREMENT PRIMARY KEY,
  leave_type_id INT NOT NULL,
  tier_number   TINYINT NOT NULL,
  min_years     DECIMAL(4,2) NOT NULL,
  max_years     DECIMAL(4,2) NULL,
  annual_days   DECIMAL(5,2) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    INT NULL,
  CONSTRAINT fk_leavetier_leavetype FOREIGN KEY (leave_type_id) REFERENCES tbl_leave_type(leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_balance (
  balance_id         INT AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT NOT NULL,
  leave_type_id      INT NOT NULL,
  year               INT NOT NULL,
  total_credits      DECIMAL(5,2) NOT NULL,
  used_credits       DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  remaining_credits  DECIMAL(5,2) NOT NULL,
  carryover_credits  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  cash_payout_amount DECIMAL(10,2) NULL,
  payout_date        DATE NULL,
  allocation_source  ENUM('employment_type','tenure','position','manual') NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_leave_balance (employee_id, leave_type_id, year),
  CONSTRAINT fk_leavebal_employee  FOREIGN KEY (employee_id)   REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_leavebal_leavetype FOREIGN KEY (leave_type_id) REFERENCES tbl_leave_type(leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave (
  leave_id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id           INT NOT NULL,
  cutoff_id             INT NULL,
  leave_type_id         INT NOT NULL,
  leave_balance_id      INT NULL,
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  with_pay              BOOLEAN NOT NULL DEFAULT TRUE,
  ut_hours              DECIMAL(5,2) NULL,
  address_on_leave      VARCHAR(500) NULL,
  reason                VARCHAR(500) NULL,
  leave_initiation_type ENUM('employee_filed','hr_initiated','forced_leave') NOT NULL DEFAULT 'employee_filed',
  batch_reference       VARCHAR(100) NULL,
  status                ENUM('pending','endorsed','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  endorsed_by           INT NULL,
  approved_by           INT NULL,
  noted_by              VARCHAR(100) NULL,
  balance_at_filing_vl  DECIMAL(5,2) NULL,
  balance_at_filing_sl  DECIMAL(5,2) NULL,
  form_upload_id        INT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            INT NULL,
  updated_at            TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by            INT NULL,
  CONSTRAINT fk_leave_employee  FOREIGN KEY (employee_id)     REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_leave_cutoff    FOREIGN KEY (cutoff_id)       REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_leave_leavetype FOREIGN KEY (leave_type_id)   REFERENCES tbl_leave_type(leave_type_id),
  CONSTRAINT fk_leave_balance   FOREIGN KEY (leave_balance_id) REFERENCES tbl_leave_balance(balance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_user_account (
  user_acc_id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              INT NULL,
  email                    VARCHAR(150) NOT NULL,
  password                 VARCHAR(255) NOT NULL,
  role                     ENUM('super_admin','hr','coord','it','admin') NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  notification_delivery    ENUM('in_app','email','both') NOT NULL DEFAULT 'in_app',
  failed_login_count       INT NOT NULL DEFAULT 0,
  last_failed_login_at     TIMESTAMP NULL,
  must_change_password     BOOLEAN NOT NULL DEFAULT TRUE,
  is_bootstrap             BOOLEAN NOT NULL DEFAULT FALSE,
  can_access_system_config BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by               INT NULL,
  updated_at               TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by               INT NULL,
  UNIQUE KEY uq_email (email),
  UNIQUE KEY uq_employee_account (employee_id),
  CONSTRAINT fk_useracc_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_user_scope (
  scope_id         INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id      INT NOT NULL,
  subdepartment_id INT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_user_scope (user_acc_id, subdepartment_id),
  CONSTRAINT fk_scope_user    FOREIGN KEY (user_acc_id)      REFERENCES tbl_user_account(user_acc_id),
  CONSTRAINT fk_scope_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_module_access (
  module_access_id INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id      INT NOT NULL,
  module_key       VARCHAR(80) NOT NULL,
  is_granted       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_module_access (user_acc_id, module_key),
  CONSTRAINT fk_moduleaccess_user FOREIGN KEY (user_acc_id) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_session_log (
  session_id  INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id INT NOT NULL,
  login_at    TIMESTAMP NOT NULL,
  logout_at   TIMESTAMP NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(500) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_user FOREIGN KEY (user_acc_id) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_form_upload (
  form_upload_id      INT AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT NOT NULL,
  uploaded_by         INT NOT NULL,
  cutoff_id           INT NULL,
  form_type           ENUM('OT_Request','Vacation_Leave','Sick_Leave','Emergency_Leave',
                           'Undertime','Shift_Schedule_Exchange','Forced_Vacation_Leave','Other') NOT NULL,
  exchange_partner_id INT NULL,
  exchange_date       DATE NULL,
  reference_start     DATE NOT NULL,
  reference_end       DATE NULL,
  ot_time_start       TIME NULL,
  ot_time_end         TIME NULL,
  ot_hours_requested  DECIMAL(4,2) NULL,
  file_path           VARCHAR(500) NULL,
  file_name           VARCHAR(255) NULL,
  reason              VARCHAR(500) NOT NULL,
  agreed_by           VARCHAR(100) NULL,
  noted_by            VARCHAR(100) NULL,
  endorsement_status  ENUM('endorsed','returned') NOT NULL,
  coordinator_note    VARCHAR(500) NULL,
  hr_status           ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  reviewed_by         INT NULL,
  reviewed_at         TIMESTAMP NULL,
  hr_note             VARCHAR(500) NULL,
  cascade_status      ENUM('pending','completed','failed') NULL,
  cascaded_at         TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  CONSTRAINT fk_formup_employee FOREIGN KEY (employee_id)         REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_formup_partner  FOREIGN KEY (exchange_partner_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_formup_cutoff   FOREIGN KEY (cutoff_id)           REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift_swap (
  swap_id         INT AUTO_INCREMENT PRIMARY KEY,
  emp1_id         INT NOT NULL,
  emp2_id         INT NOT NULL,
  swap_date_start DATE NOT NULL,
  swap_date_end   DATE NOT NULL,
  emp1_time_in    TIME NULL,
  emp1_time_out   TIME NULL,
  emp2_time_in    TIME NULL,
  emp2_time_out   TIME NULL,
  reason          TEXT NULL,
  status          ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  approved_by     INT NULL,
  form_upload_id  INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  updated_at      TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by      INT NULL,
  CONSTRAINT fk_swap_emp1   FOREIGN KEY (emp1_id)        REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_swap_emp2   FOREIGN KEY (emp2_id)        REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_swap_formup FOREIGN KEY (form_upload_id) REFERENCES tbl_form_upload(form_upload_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_service_charge (
  charge_id         INT AUTO_INCREMENT PRIMARY KEY,
  cutoff_id         INT NOT NULL,
  company_id        INT NOT NULL,
  collection_amount DECIMAL(12,2) NOT NULL,
  distribution_date DATE NULL,
  status            ENUM('pending','distributed','exported') NOT NULL DEFAULT 'pending',
  notes             TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        INT NULL,
  updated_at        TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT NULL,
  CONSTRAINT fk_svccharge_cutoff  FOREIGN KEY (cutoff_id)  REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_svccharge_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_service_charge_distribution (
  distribution_id INT AUTO_INCREMENT PRIMARY KEY,
  charge_id       INT NOT NULL,
  employee_id     INT NOT NULL,
  hours_worked    DECIMAL(6,2) NOT NULL,
  share_amount    DECIMAL(10,2) NOT NULL,
  is_exported     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_svcdist_charge   FOREIGN KEY (charge_id)   REFERENCES tbl_service_charge(charge_id),
  CONSTRAINT fk_svcdist_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_13th_month_pay (
  pay_id                 INT AUTO_INCREMENT PRIMARY KEY,
  employee_id            INT NOT NULL,
  year                   INT NOT NULL,
  total_basic_salary_ytd DECIMAL(12,2) NOT NULL,
  computed_amount        DECIMAL(12,2) NOT NULL,
  status                 ENUM('computed','reviewed','released') NOT NULL DEFAULT 'computed',
  release_date           DATE NULL,
  is_exported            BOOLEAN NOT NULL DEFAULT FALSE,
  notes                  TEXT NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             INT NULL,
  updated_at             TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT NULL,
  UNIQUE KEY uq_13th_emp_year (employee_id, year),
  CONSTRAINT fk_13th_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_external_worker (
  external_worker_id INT AUTO_INCREMENT PRIMARY KEY,
  company_id         INT NOT NULL,
  full_name          VARCHAR(200) NOT NULL,
  agency_name        VARCHAR(200) NULL,
  worker_type        ENUM('guard','contractor','ojtintern','other') NOT NULL,
  station_id         INT NULL,
  contact_number     VARCHAR(20) NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  CONSTRAINT fk_extworker_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id),
  CONSTRAINT fk_extworker_station FOREIGN KEY (station_id) REFERENCES tbl_station(station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_external_attendance (
  ext_attendance_id  INT AUTO_INCREMENT PRIMARY KEY,
  external_worker_id INT NOT NULL,
  date               DATE NOT NULL,
  time_in            TIME NULL,
  time_out           TIME NULL,
  entry_source       ENUM('biometric','manual','import') NOT NULL DEFAULT 'manual',
  entered_by         INT NULL,
  notes              TEXT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  CONSTRAINT fk_extatt_worker FOREIGN KEY (external_worker_id) REFERENCES tbl_external_worker(external_worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_external_guard_schedule (
  guard_schedule_id  INT AUTO_INCREMENT PRIMARY KEY,
  external_worker_id INT NOT NULL,
  station_id         INT NULL,
  date               DATE NOT NULL,
  time_in            TIME NULL,
  time_out           TIME NULL,
  notes              TEXT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  CONSTRAINT fk_guardsch_worker  FOREIGN KEY (external_worker_id) REFERENCES tbl_external_worker(external_worker_id),
  CONSTRAINT fk_guardsch_station FOREIGN KEY (station_id)         REFERENCES tbl_station(station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_computation_rules (
  config_id                          INT PRIMARY KEY DEFAULT 1,
  grace_period_minutes               INT NOT NULL DEFAULT 30,
  early_ot_threshold_minutes         INT NOT NULL DEFAULT 30,
  late_ot_threshold_minutes          INT NOT NULL DEFAULT 30,
  missed_punch_detection_buffer_minutes INT NOT NULL DEFAULT 60,
  duplicate_punch_window_seconds     INT NOT NULL DEFAULT 60,
  min_rest_hours_between_shifts      DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  early_ot_max_hours                 DECIMAL(4,2) NOT NULL DEFAULT 4.00,
  late_ot_max_hours                  DECIMAL(4,2) NOT NULL DEFAULT 4.00,
  nd_window_start                    TIME NOT NULL DEFAULT '22:00:00',
  nd_window_end                      TIME NOT NULL DEFAULT '06:00:00',
  standard_shift_hours               DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  break_deduct_hours                 DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  break_deduct_threshold_hours       DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  break_deduction_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  awol_threshold_days                INT NOT NULL DEFAULT 3,
  awol_auto_flag_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  probation_regularization_reminder_days INT NOT NULL DEFAULT 14,
  auto_regularize                    BOOLEAN NOT NULL DEFAULT TRUE,
  training_duration_days             INT NOT NULL DEFAULT 16,
  ot_form_required                   BOOLEAN NOT NULL DEFAULT FALSE,
  eot_multiplier                     DECIMAL(5,4) NOT NULL DEFAULT 1.2500,
  lot_multiplier                     DECIMAL(5,4) NOT NULL DEFAULT 1.3750,
  nd_rate                            DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
  ot_multiplier                      DECIMAL(5,4) NOT NULL DEFAULT 1.2500,
  shod_eot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 1.6900,
  shod_lot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 1.8590,
  shod_nd_rate                       DECIMAL(5,4) NOT NULL DEFAULT 0.1300,
  shod_pay_rate                      DECIMAL(5,4) NOT NULL DEFAULT 0.3000,
  rhod_eot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 2.6000,
  rhod_lot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 2.8600,
  rhod_nd_rate                       DECIMAL(5,4) NOT NULL DEFAULT 0.2000,
  rhod_pay_rate                      DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  dod_pay_rate                       DECIMAL(5,4) NOT NULL DEFAULT 0.1300,
  dod_multiplier                     DECIMAL(5,4) NOT NULL DEFAULT 1.3000,
  dod_eot_multiplier                 DECIMAL(5,4) NOT NULL DEFAULT 1.6900,
  dod_lot_multiplier                 DECIMAL(5,4) NOT NULL DEFAULT 1.8590,
  dod_nd_rate                        DECIMAL(5,4) NOT NULL DEFAULT 0.1300,
  rhod_dod_eot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 3.3800,
  rhod_dod_lot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 3.7180,
  rhod_dod_nd_rate                   DECIMAL(5,4) NOT NULL DEFAULT 0.2600,
  rhod_dod_pay_rate                  DECIMAL(5,4) NOT NULL DEFAULT 2.6000,
  shod_dod_eot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 1.9500,
  shod_dod_lot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 2.1500,
  shod_dod_nd_rate                   DECIMAL(5,4) NOT NULL DEFAULT 0.1500,
  shod_dod_pay_rate                  DECIMAL(5,4) NOT NULL DEFAULT 1.5000,
  phic_rate                          DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  biometric_matching_strategy        ENUM('uid_only','uid_then_name','uid_then_name_then_employee_number')
                                     NOT NULL DEFAULT 'uid_then_name',
  updated_at                         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                         INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_config_global (
  config_id                    INT PRIMARY KEY DEFAULT 1,
  leave_allocation_mode        ENUM('employment_type','tenure','position','combined') NOT NULL DEFAULT 'tenure',
  leave_rule_priority          ENUM('highest_value','employment_type_first','tenure_first','position_first')
                               NOT NULL DEFAULT 'highest_value',
  vl_sl_combined               BOOLEAN NOT NULL DEFAULT FALSE,
  leave_cap_days               DECIMAL(5,2) NULL,
  carryover_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  carryover_max_days           DECIMAL(5,2) NULL,
  sl_cash_convertible          BOOLEAN NOT NULL DEFAULT TRUE,
  vl_force_consume             BOOLEAN NOT NULL DEFAULT TRUE,
  schedule_publish_reminder_days INT NULL DEFAULT 2,
  year_rollover_reminder_days  INT NULL DEFAULT 30,
  updated_at                   TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                   INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_system_config (
  config_id                          INT PRIMARY KEY DEFAULT 1,
  session_expiry_hours               INT NOT NULL DEFAULT 24,
  session_inactivity_timeout_minutes INT NOT NULL DEFAULT 30,
  max_failed_logins                  INT NOT NULL DEFAULT 5,
  account_lockout_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  lockout_duration_minutes           INT NOT NULL DEFAULT 15,
  audit_log_retention_days           INT NOT NULL DEFAULT 90,
  password_min_length                INT NOT NULL DEFAULT 8,
  password_require_uppercase         BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_number            BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_special           BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                         INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_notification_config (
  config_id            INT AUTO_INCREMENT PRIMARY KEY,
  trigger_type         VARCHAR(80) NOT NULL,
  priority_tier        ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  is_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  notify_hr            BOOLEAN NOT NULL DEFAULT FALSE,
  notify_coordinator   BOOLEAN NOT NULL DEFAULT FALSE,
  notify_it            BOOLEAN NOT NULL DEFAULT FALSE,
  notify_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_hr          ENUM('in_app','email','both') NULL,
  delivery_coordinator ENUM('in_app','email','both') NULL,
  delivery_it          ENUM('in_app','email','both') NULL,
  delivery_admin       ENUM('in_app','email','both') NULL,
  updated_at           TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by           INT NULL,
  UNIQUE KEY uq_trigger_type (trigger_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_notification (
  notification_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  recipient_id         INT NOT NULL,
  trigger_type         VARCHAR(80) NOT NULL,
  trigger_source_id    INT NULL,
  trigger_source_table VARCHAR(60) NULL,
  message              VARCHAR(500) NOT NULL,
  is_read              BOOLEAN NOT NULL DEFAULT FALSE,
  read_at              TIMESTAMP NULL,
  expires_at           TIMESTAMP NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_id) REFERENCES tbl_user_account(user_acc_id),
  CONSTRAINT fk_notif_config    FOREIGN KEY (trigger_type) REFERENCES tbl_notification_config(trigger_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_user_preference (
  preference_id    INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id      INT NOT NULL,
  preference_key   VARCHAR(80) NOT NULL,
  preference_value VARCHAR(200) NOT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_pref (user_acc_id, preference_key),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_acc_id) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_import_column_map (
  map_id                        INT AUTO_INCREMENT PRIMARY KEY,
  company_id                    INT NULL,
  profile_name                  VARCHAR(150) NOT NULL,
  created_by                    INT NOT NULL,
  field_last_name               VARCHAR(100) NULL,
  field_first_name              VARCHAR(100) NULL,
  field_middle_name             VARCHAR(100) NULL,
  field_middle_initial          VARCHAR(100) NULL,
  field_name_suffix             VARCHAR(100) NULL,
  field_employee_number         VARCHAR(100) NULL,
  field_company                 VARCHAR(100) NULL,
  field_department              VARCHAR(100) NULL,
  field_subdepartment           VARCHAR(100) NULL,
  field_position                VARCHAR(100) NULL,
  field_employment_type         VARCHAR(100) NULL,
  field_date_hired              VARCHAR(100) NULL,
  field_training_start          VARCHAR(100) NULL,
  field_probationary_start      VARCHAR(100) NULL,
  field_date_regularized        VARCHAR(100) NULL,
  field_basic_salary            VARCHAR(100) NULL,
  field_allowance               VARCHAR(100) NULL,
  field_payroll_type            VARCHAR(100) NULL,
  field_payroll_account         VARCHAR(100) NULL,
  field_gender                  VARCHAR(100) NULL,
  field_civil_status            VARCHAR(100) NULL,
  field_date_of_birth           VARCHAR(100) NULL,
  field_address                 VARCHAR(100) NULL,
  field_province                VARCHAR(100) NULL,
  field_contact_number          VARCHAR(100) NULL,
  field_email_address           VARCHAR(100) NULL,
  field_education_attainment    VARCHAR(100) NULL,
  field_education_course        VARCHAR(100) NULL,
  field_sss                     VARCHAR(100) NULL,
  field_philhealth              VARCHAR(100) NULL,
  field_pagibig                 VARCHAR(100) NULL,
  field_tin                     VARCHAR(100) NULL,
  field_dependent_count         VARCHAR(100) NULL,
  field_emergency_contact_name  VARCHAR(100) NULL,
  field_emergency_contact_rel   VARCHAR(100) NULL,
  field_emergency_contact_phone VARCHAR(100) NULL,
  field_biometric_name          VARCHAR(100) NULL,
  field_remarks                 VARCHAR(100) NULL,
  is_default                    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                    INT NULL,
  CONSTRAINT fk_importmap_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_audit_log (
  audit_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  action_type          VARCHAR(100) NOT NULL,
  actor_id             INT NOT NULL,
  actor_role           VARCHAR(30) NOT NULL,
  affected_employee_id INT NULL,
  target_table         VARCHAR(60) NULL,
  target_record_id     INT NULL,
  field_changed        VARCHAR(100) NULL,
  old_value            TEXT NULL,
  new_value            TEXT NULL,
  reason               VARCHAR(500) NULL,
  ip_address           VARCHAR(45) NULL,
  user_agent           VARCHAR(500) NULL,
  status               ENUM('success','failure','pending') NOT NULL DEFAULT 'success',
  error_message        TEXT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_dole_notification (
  notification_id   INT AUTO_INCREMENT PRIMARY KEY,
  company_id        INT NOT NULL,
  arrangement_type  ENUM('broken_time','forced_leave','compressed_workweek','reduced_hours','rotation') NOT NULL,
  date_filed        DATE NULL,
  date_acknowledged DATE NULL,
  reference_number  VARCHAR(100) NULL,
  status            ENUM('pending','filed','acknowledged') NOT NULL DEFAULT 'pending',
  notes             TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        INT NULL,
  updated_at        TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT NULL,
  CONSTRAINT fk_dolenot_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
