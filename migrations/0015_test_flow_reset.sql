-- One-time neutralization of leftover Guided Test Sales Flow follow-ups.
-- TEST uids are exactly 'test-sales-flow' or 'test-sales-flow:<run>'.
-- Real prospect rows are never matched. History is not deleted.
-- UNKNOWN_DELIVERY / sent / failed / cancelled rows are left as-is.

WITH cancelled AS (
  UPDATE scheduled_followups
  SET status = 'cancelled'
  WHERE status IN ('scheduled', 'sending')
    AND (prospect_uid = 'test-sales-flow' OR prospect_uid LIKE 'test-sales-flow:%')
  RETURNING id, user_id, prospect_uid, sequence_id, step
)
INSERT INTO outreach_audit (id, user_id, prospect_uid, action, detail, input_method, sequence_id, provider_ids)
SELECT gen_random_uuid()::text,
       user_id,
       prospect_uid,
       'TEST_FLOW_RESET',
       'cancelled ' || step || ' — TEST_FLOW_RESET',
       'AUTOMATION',
       sequence_id,
       ''
FROM cancelled;

UPDATE outreach_sequences
SET status = 'stopped'
WHERE status = 'active'
  AND (prospect_uid = 'test-sales-flow' OR prospect_uid LIKE 'test-sales-flow:%');

UPDATE sales_test_state
SET message_id = NULL,
    thread_id = NULL,
    sequence_id = NULL,
    followups_before = 0,
    reply_count = 0,
    followups_after = NULL,
    booking_token = NULL,
    event_id = NULL,
    slots_offered = 0,
    pipeline_stage = NULL,
    step = 1,
    prospect_uid = 'test-sales-flow:' || replace(gen_random_uuid()::text, '-', ''),
    updated_at = now();
