import { Router } from 'express';

const router = Router();

const iosBundleId = process.env.IOS_BUNDLE_ID || 'app.petchain.mobile';
const appleTeamId = process.env.APPLE_TEAM_ID || 'TEAMID';
const androidPackageName = process.env.ANDROID_PACKAGE_NAME || 'app.petchain.mobile';

router.get('/.well-known/apple-app-site-association', (_req, res) => {
  res.type('application/json').json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${appleTeamId}.${iosBundleId}`,
          paths: ['/pets/*', '/appointments/*', '/sos/*', '/records/*'],
        },
      ],
    },
  });
});

router.get('/.well-known/assetlinks.json', (_req, res) => {
  res.type('application/json').json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: androidPackageName,
        sha256_cert_fingerprints: [process.env.ANDROID_SHA256_FINGERPRINT || ''],
      },
    },
  ]);
});

router.get(['/pets/:petId', '/appointments/:id', '/sos/:id'], (req, res) => {
  const deepLink = req.originalUrl;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>PetChain</title>
      <meta http-equiv="refresh" content="2;url=https://petchain.app/download">
    </head>
    <body>
      <p>Opening PetChain... <a href="petchain:/${deepLink}">Open App</a></p>
      <p>Don't have PetChain? <a href="https://petchain.app/download">Download it</a></p>
    </body>
    </html>
  `);
});

export default router;
