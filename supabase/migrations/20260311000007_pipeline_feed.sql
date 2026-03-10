INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source, handler_endpoint, schedule_cron, is_active)
VALUES ('pipeline_health', 'Pipeline Health & Deal Follow-ups', 'calculated', '/api/ops/abra/auto-teach?feed=pipeline_health', '0 15 * * 1-5', true)
ON CONFLICT (feed_key) DO NOTHING;
