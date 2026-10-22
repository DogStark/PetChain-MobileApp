-- Migration: 20260627000002_seed_notification_templates
-- Description: Seed English + Spanish templates for lost_pet_alert and
-- vaccination_transfer, used by sendNotification() in
-- notificationTemplateService.ts. Variables: {{petName}}.
-- (lost_pet_alert currently has no variables but is included for parity
-- with the locale-selection mechanism.)

-- up migration
INSERT INTO notification_templates (id, key, locale, title, body, is_active)
VALUES
  (
    gen_random_uuid(),
    'lost_pet_alert',
    'en',
    'Lost pet alert near you',
    'A lost pet has been reported nearby. Tap the app for details.',
    TRUE
  ),
  (
    gen_random_uuid(),
    'lost_pet_alert',
    'es',
    'Alerta de mascota perdida cerca de ti',
    'Se ha reportado una mascota perdida cerca de ti. Toca la app para ver los detalles.',
    TRUE
  ),
  (
    gen_random_uuid(),
    'vaccination_transfer',
    'en',
    '🐾 Vaccination reminders transferred',
    'Vaccination reminders for {{petName}} are now active on your account.',
    TRUE
  ),
  (
    gen_random_uuid(),
    'vaccination_transfer',
    'es',
    '🐾 Recordatorios de vacunación transferidos',
    'Los recordatorios de vacunación de {{petName}} ya están activos en tu cuenta.',
    TRUE
  )
ON CONFLICT (key, locale) DO NOTHING;

-- down migration
DELETE FROM notification_templates
WHERE (key, locale) IN (
  ('lost_pet_alert', 'en'),
  ('lost_pet_alert', 'es'),
  ('vaccination_transfer', 'en'),
  ('vaccination_transfer', 'es')
);
