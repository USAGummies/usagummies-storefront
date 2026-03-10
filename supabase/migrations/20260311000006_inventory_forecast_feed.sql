INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source_type, schedule_cron, is_active)
VALUES ('inventory_forecast', 'Inventory Forecast & Reorder Alerts', 'calculated', '0 8 * * *', true)
ON CONFLICT (feed_key) DO NOTHING;
