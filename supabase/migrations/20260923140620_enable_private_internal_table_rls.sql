-- These internal tables are accessed by service_role-only, security-invoker
-- RPCs. Keep ordinary API roles without table grants and enable RLS as a
-- second boundary; service_role and postgres retain their BYPASSRLS behavior.
revoke all on table private.agent_request_log, private.mcp_connector_tokens
  from public, anon, authenticated;

alter table private.agent_request_log enable row level security;
alter table private.mcp_connector_tokens enable row level security;
