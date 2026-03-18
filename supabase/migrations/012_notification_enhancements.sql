-- Add 'every3days' frequency option to notification settings
ALTER TABLE public.chainthings_notification_settings
  DROP CONSTRAINT IF EXISTS chainthings_notification_settings_frequency_check;

ALTER TABLE public.chainthings_notification_settings
  ADD CONSTRAINT chainthings_notification_settings_frequency_check
  CHECK (frequency IN ('daily', 'every3days', 'weekly', 'biweekly'));
