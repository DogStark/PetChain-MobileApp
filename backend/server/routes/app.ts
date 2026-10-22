import { Router } from 'express';

const router = Router();

/**
 * GET /api/app/version-check
 *
 * Returns the minimum required app version and store URLs.
 * The client compares this against its current version to decide
 * whether to show a blocking (critical) or dismissible (recommended) update prompt.
 */
router.get('/version-check', (_req, res) => {
  res.json({
    minimumVersion: process.env.APP_MINIMUM_VERSION ?? '1.0.0',
    recommendedVersion: process.env.APP_RECOMMENDED_VERSION ?? '1.0.0',
    iosStoreUrl: process.env.IOS_STORE_URL ?? 'https://apps.apple.com/app/petchain/id000000000',
    androidStoreUrl:
      process.env.ANDROID_STORE_URL ??
      'https://play.google.com/store/apps/details?id=app.petchain.mobile',
    message: process.env.APP_UPDATE_MESSAGE ?? 'A new version of PetChain is available.',
  });
});

export default router;
