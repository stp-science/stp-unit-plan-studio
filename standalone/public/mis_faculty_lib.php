<?php
declare(strict_types=1);
/**
 * Unit Plan Studio, standalone edition: the small part of the school site's faculty/department layer that the curriculum map needs.
 * Departments and faculties are plain lists of names; there are no staff assignments here.
 */

function mis_department_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_departments (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        school_id BIGINT NOT NULL,
        faculty_id BIGINT NULL,
        name VARCHAR(140) NOT NULL,
        code VARCHAR(30) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        KEY idx_dept_school (school_id, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_department_heads (
        department_id BIGINT NOT NULL,
        teacher_id BIGINT NOT NULL,
        school_id BIGINT NOT NULL,
        PRIMARY KEY (department_id, teacher_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function mis_faculty_setup(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_faculties (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        school_id BIGINT NOT NULL,
        name VARCHAR(140) NOT NULL,
        code VARCHAR(30) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        KEY idx_fac_school (school_id, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS mis_faculty_heads (
        faculty_id BIGINT NOT NULL,
        teacher_id BIGINT NOT NULL,
        school_id BIGINT NOT NULL,
        PRIMARY KEY (faculty_id, teacher_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
