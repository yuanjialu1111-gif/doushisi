#!/bin/sh
set -eu
psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password DSS_APP_PASSWORD
\getenv backup_password DSS_BACKUP_PASSWORD
CREATE ROLE dss_app LOGIN PASSWORD :'app_password';
CREATE ROLE dss_backup LOGIN PASSWORD :'backup_password';
GRANT pg_read_all_data TO dss_backup;
SQL
