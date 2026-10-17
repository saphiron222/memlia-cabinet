-- Runs once as the separate bootstrap administrator. No password is logged.
CREATE ROLE memlia LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
SELECT format('ALTER ROLE memlia PASSWORD %L', rtrim(pg_read_file('/run/secrets/application-password'), E'\n')) \gexec
ALTER DATABASE memlia OWNER TO memlia;
GRANT CREATE ON SCHEMA public TO memlia;
