
create unique index if not exists activity_log_agent_idempotency_unique
  on public.activity_log (
    team_id,
    actor_label,
    (metadata->>'idempotency_key')
  )
  where actor_type = 'agent'
    and nullif(metadata->>'idempotency_key','') is not null;

comment on index public.activity_log_agent_idempotency_unique is
  'Prevents concurrent agent writes with the same idempotency key from leaving duplicate persisted effects.';

comment on table private.agent_request_log is
  'Server-only cache of completed Head Coach requests keyed by team, agent subject and idempotency key.';
;
