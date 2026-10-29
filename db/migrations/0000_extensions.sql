-- Hand-written. Runs before the tables: pg_trgm for search indexes, schema "app" for helpers.
create extension if not exists pg_trgm with schema extensions;
--> statement-breakpoint
create schema if not exists app;
