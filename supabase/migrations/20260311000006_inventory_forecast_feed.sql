INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source, handler_endpoint, schedule_cron, is_active)
VALUES ('inventory_forecast', 'Inventory Forecast & Reorder Alerts', 'calculated', '/api/ops/abra/auto-teach?feed=inventory_forecast', '0 8 * * *', true)
ON CONFLICT (feed_key) DO NOTHING;
