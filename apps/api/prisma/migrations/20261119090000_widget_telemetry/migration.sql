-- Widget install telemetry on the embed key. Set when the widget pings on page
-- load (POST /api/v1/tenant-chat/:slug/ping); null => the widget has never loaded
-- with this key. Lets the dashboard flip to "widget detected". widgetUrl is the
-- page it last loaded on (origin + path only — no query string).
ALTER TABLE "TenantApiKey" ADD COLUMN "widgetSeenAt" TIMESTAMP(3);
ALTER TABLE "TenantApiKey" ADD COLUMN "widgetUrl" TEXT;
