-- Unit Plan Studio (standalone): MySQL / MariaDB schema.
-- Run this first, then data.sql. Character set utf8mb4.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS teachers (id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL DEFAULT '', school_id BIGINT NULL, role VARCHAR(32) NOT NULL DEFAULT 'teacher', is_active TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mis_departments (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, school_id BIGINT NOT NULL, faculty_id BIGINT NULL, name VARCHAR(140) NOT NULL, code VARCHAR(30) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0, KEY idx_dept_school (school_id, is_active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mis_faculties (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, school_id BIGINT NOT NULL, name VARCHAR(140) NOT NULL, code VARCHAR(30) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, sort_order INT NOT NULL DEFAULT 0, KEY idx_fac_school (school_id, is_active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mis_department_heads (department_id BIGINT NOT NULL, teacher_id BIGINT NOT NULL, school_id BIGINT NOT NULL, PRIMARY KEY (department_id, teacher_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mis_faculty_heads (faculty_id BIGINT NOT NULL, teacher_id BIGINT NOT NULL, school_id BIGINT NOT NULL, PRIMARY KEY (faculty_id, teacher_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_curriculum_maps` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `school_id` bigint NOT NULL,
  `department_id` bigint NOT NULL,
  `data` longtext NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `updated_by` bigint NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cm_dept` (`school_id`,`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_curriculum_map_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `school_id` bigint NOT NULL,
  `department_id` bigint NOT NULL,
  `data` longtext NOT NULL,
  `saved_by` bigint NOT NULL DEFAULT '0',
  `reason` varchar(20) NOT NULL DEFAULT '',
  `saved_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cm_hist` (`school_id`,`department_id`,`saved_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_map_statements` (
  `school_id` bigint NOT NULL,
  `department_id` bigint NOT NULL,
  `topic_id` varchar(24) NOT NULL,
  `hash` char(40) NOT NULL,
  `kind` varchar(10) NOT NULL,
  `stmt` text NOT NULL,
  `source` varchar(255) NOT NULL DEFAULT '',
  `doc_id` varchar(100) NOT NULL DEFAULT '',
  `confidence` tinyint unsigned DEFAULT NULL,
  `selected` tinyint(1) NOT NULL DEFAULT '1',
  `updated_by` bigint NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`department_id`,`topic_id`,`hash`),
  KEY `idx_ms_school` (`school_id`,`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_map_match` (
  `school_id` bigint NOT NULL,
  `department_id` bigint NOT NULL,
  `topic_id` varchar(24) NOT NULL,
  `status` varchar(10) NOT NULL,
  `found` smallint unsigned NOT NULL DEFAULT '0',
  `note` varchar(255) NOT NULL DEFAULT '',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`department_id`,`topic_id`),
  KEY `idx_mm_school` (`school_id`,`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_level_map` (
  `school_id` bigint NOT NULL,
  `department_id` bigint NOT NULL,
  `doc_id` varchar(100) NOT NULL,
  `level` varchar(40) NOT NULL,
  `years` varchar(40) NOT NULL DEFAULT '',
  `updated_by` bigint NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`department_id`,`doc_id`,`level`),
  KEY `idx_lm_school` (`school_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_statement_bank` (
  `doc_id` varchar(100) NOT NULL,
  `yr` tinyint unsigned NOT NULL,
  `disc` varchar(40) NOT NULL DEFAULT '',
  `chunk` smallint unsigned NOT NULL,
  `total` smallint unsigned NOT NULL,
  `items` mediumtext NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`doc_id`,`yr`,`disc`,`chunk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_topic_guides` (
  `id` varchar(40) NOT NULL,
  `school_id` bigint NOT NULL,
  `teacher_id` bigint NOT NULL,
  `title` varchar(200) NOT NULL DEFAULT '',
  `data` longtext NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tg_teacher` (`teacher_id`,`updated_at`),
  KEY `fk_tg_school` (`school_id`),
  CONSTRAINT `fk_tg_school` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_curriculum_school_config` (
  `school_id` bigint NOT NULL,
  `priorities` text NOT NULL,
  `capability_guidance` text NOT NULL,
  `additional_guidance` text NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `updated_by` bigint DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`school_id`),
  CONSTRAINT `fk_cc_cfg_school` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_curriculum_usage` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `school_id` bigint NOT NULL,
  `teacher_id` bigint NOT NULL,
  `op` varchar(20) NOT NULL,
  `detail` varchar(40) NOT NULL DEFAULT '',
  `model` varchar(60) NOT NULL DEFAULT '',
  `input_tokens` int NOT NULL DEFAULT '0',
  `cached_tokens` int NOT NULL DEFAULT '0',
  `output_tokens` int NOT NULL DEFAULT '0',
  `seconds` int NOT NULL DEFAULT '0',
  `ok` tinyint(1) NOT NULL DEFAULT '1',
  `error` varchar(200) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cu_school` (`school_id`,`created_at`),
  KEY `idx_cu_teacher` (`teacher_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `mis_map_statements_trash` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `deleted_at` datetime NOT NULL,
  `deleted_by` bigint NOT NULL,
  `school_id` bigint NOT NULL,
  `department_id` bigint NOT NULL,
  `topic_id` varchar(24) NOT NULL,
  `kind` varchar(10) NOT NULL,
  `stmt` text NOT NULL,
  `source` varchar(255) NOT NULL DEFAULT '',
  `doc_id` varchar(100) NOT NULL DEFAULT '',
  `confidence` tinyint unsigned DEFAULT NULL,
  `selected` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_t` (`school_id`,`department_id`,`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

