#!/bin/sh
set -eu
: "${DSS_BACKUP_PASSWORD:?Set DSS_BACKUP_PASSWORD in the database service environment}"
psql -X --username "${POSTGRES_USER:-dss_migrator}" --dbname "${POSTGRES_DB:-doushisi}" --set ON_ERROR_STOP=1 <<'SQL'
\getenv backup_password DSS_BACKUP_PASSWORD
SELECT 'CREATE ROLE dss_backup LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dss_backup') \gexec
ALTER ROLE dss_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'backup_password';
GRANT pg_read_all_data TO dss_backup;
SQL
