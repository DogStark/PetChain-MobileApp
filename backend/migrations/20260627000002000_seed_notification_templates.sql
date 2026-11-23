-- Migration: 20260627000002_seed_notification_templates
-- Description: Seed English + Spanish templates for lost_pet_alert,
-- vaccination_transfer and health_threshold_breach, used by sendNotification()
-- in notificationTemplateService.ts. Variables: {{petName}} (and
-- {{metric}}, {{value}}, {{threshold}} for health_threshold_breach).
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
  ),
  (
    gen_random_uuid(),
    'health_threshold_breach',
    'en',
    '⚠️ Health alert for {{petName}}',
    '{{petName}}''s {{metric}} reading of {{value}} is outside the configured range ({{threshold}}). Please review their health data.',
    TRUE
  ),
  (
    gen_random_uuid(),
    'health_threshold_breach',
    'es',
    '⚠️ Alerta de salud para {{petName}}',
    'La lectura de {{metric}} de {{petName}} ({{value}}) está fuera del rango configurado ({{threshold}}). Revisa sus datos de salud.',
    TRUE
  )
ON CONFLICT (key, locale) DO NOTHING;

-- down migration
DELETE FROM notification_templates
WHERE (key, locale) IN (
  ('lost_pet_alert', 'en'),
  ('lost_pet_alert', 'es'),
  ('vaccination_transfer', 'en'),
  ('vaccination_transfer', 'es'),
  ('health_threshold_breach', 'en'),
  ('health_threshold_breach', 'es')
);
