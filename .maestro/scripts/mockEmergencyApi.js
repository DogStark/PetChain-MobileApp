// Mock the emergency SOS API call so no real alerts are sent during tests.
// Maestro runScript injects this before the flow uses the API.
http.mock('POST', '/api/emergency/sos', {
  status: 200,
  body: JSON.stringify({ success: true, message: 'SOS Sent', contactsNotified: 2 }),
  headers: { 'Content-Type': 'application/json' },
});

// Mock the pre-flight channel verification endpoint used before SOS activation.
// Returns per-contact channel status so the UI can display it and report failures
// without blocking healthy fallback channels.
http.mock('POST', '/api/emergency/contacts/verify', {
  status: 200,
  body: JSON.stringify({
    success: true,
    contacts: [
      {
        id: 'contact-1',
        name: 'Primary Contact',
        channels: [
          { type: 'sms', status: 'ok' },
          { type: 'push', status: 'ok' },
        ],
      },
      {
        id: 'contact-2',
        name: 'Fallback Contact',
        channels: [
          { type: 'sms', status: 'invalid_number' },
          { type: 'push', status: 'expired_token' },
        ],
      },
    ],
  }),
  headers: { 'Content-Type': 'application/json' },
});

// Mock the test notification endpoint. The payload intentionally contains no
// health data or location so the test notification stays privacy-safe.
http.mock('POST', '/api/emergency/contacts/test-notification', {
  status: 200,
  body: JSON.stringify({
    success: true,
    message: 'Test notification sent',
    delivered: ['contact-1'],
    failed: ['contact-2'],
  }),
  headers: { 'Content-Type': 'application/json' },
});

// Also mock location permission grant
output.mockLocationPermission = true;
