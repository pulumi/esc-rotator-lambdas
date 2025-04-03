-- PostgreSQL Migration for Credential Rotation Testing

-- Create Test Database
CREATE DATABASE credential_rotation_test;
\c credential_rotation_test

-- Create Test Table
CREATE TABLE IF NOT EXISTS test_data
(
    id SERIAL PRIMARY KEY,
    name VARCHAR (100) NOT NULL,
    value TEXT
);

-- Create Users with appropriate privileges
-- Target User (with reduced privileges - only SELECT, INSERT, UPDATE on test_data)
CREATE USER target_user WITH PASSWORD 'initial_password';
GRANT SELECT, INSERT, UPDATE ON test_data TO target_user;

-- Managing User (with privileges to alter the target user)
CREATE USER managing_user WITH PASSWORD 'manager_password';
ALTER USER managing_user WITH CREATEROLE;
GRANT target_user TO managing_user WITH ADMIN OPTION;
