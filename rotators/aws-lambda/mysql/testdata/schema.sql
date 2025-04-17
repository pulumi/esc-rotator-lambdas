-- MySQL Migration for Credential Rotation Testing

-- Create Test Database
CREATE DATABASE IF NOT EXISTS credential_rotation_test;
USE credential_rotation_test;

-- Create Test Table
CREATE TABLE IF NOT EXISTS test_data
(
    id    INT AUTO_INCREMENT PRIMARY KEY,
    name  VARCHAR(100) NOT NULL,
    value TEXT
);

-- Create Target User (with reduced privileges - only SELECT, INSERT, UPDATE on test_data)
CREATE USER IF NOT EXISTS 'target_user'@'%' IDENTIFIED BY 'initial_password';
GRANT SELECT, INSERT, UPDATE
    ON credential_rotation_test.test_data
    TO 'target_user'@'%';

-- Create Managing User (with privileges to alter the target user)
CREATE USER IF NOT EXISTS 'managing_user'@'%' IDENTIFIED BY 'manager_password';
GRANT ALTER ON credential_rotation_test.* TO 'managing_user'@'%';
GRANT CREATE USER ON *.* TO 'managing_user'@'%';
