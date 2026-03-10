INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source_type, schedule_cron, is_active)
VALUES ('pipeline_health', 'Pipeline Health & Deal Follow-ups', 'calculated', '0 15 * * 1-5', true)
ON CONFLICT (feed_key) DO NOTHING;
