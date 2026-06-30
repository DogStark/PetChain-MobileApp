// Mock the emergency SOS API call so no real alerts are sent during tests.
// Maestro runScript injects this before the flow uses the API.
http.mock('POST', '/api/emergency/sos', {
  status: 200,
  body: JSON.stringify({ success: true, message: 'SOS Sent', contactsNotified: 2 }),
  headers: { 'Content-Type': 'application/json' },
});

// Also mock location permission grant
output.mockLocationPermission = true;
