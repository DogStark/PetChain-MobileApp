import {
  cameraPermissionAllowsCamera,
  cameraPermissionRequiresSettings,
  resolveCameraPermissionState,
} from '../cameraPermission';

describe('cameraPermission state resolution (Issue #936)', () => {
  describe('resolveCameraPermissionState', () => {
    it('maps a null / undefined snapshot to unavailable', () => {
      expect(resolveCameraPermissionState(null)).toBe('unavailable');
      expect(resolveCameraPermissionState(undefined)).toBe('unavailable');
    });

    it('maps a granted snapshot to granted (via granted flag)', () => {
      expect(
        resolveCameraPermissionState({ status: 'granted', granted: true, canAskAgain: true }),
      ).toBe('granted');
    });

    it('maps a granted status to granted even when canAskAgain is absent', () => {
      expect(resolveCameraPermissionState({ status: 'granted' })).toBe('granted');
    });

    it('maps undetermined to undetermined', () => {
      expect(resolveCameraPermissionState({ status: 'undetermined', granted: false })).toBe(
        'undetermined',
      );
    });

    it('maps an unavailable status to unavailable', () => {
      expect(resolveCameraPermissionState({ status: 'unavailable' })).toBe('unavailable');
    });

    it('maps restricted to restricted', () => {
      expect(resolveCameraPermissionState({ status: 'restricted', granted: false })).toBe(
        'restricted',
      );
    });

    it('maps a denied snapshot that canAskAgain=false to denied-permanently', () => {
      expect(
        resolveCameraPermissionState({ status: 'denied', granted: false, canAskAgain: false }),
      ).toBe('denied-permanently');
    });

    it('maps a denied snapshot that can still ask again to denied', () => {
      expect(
        resolveCameraPermissionState({ status: 'denied', granted: false, canAskAgain: true }),
      ).toBe('denied');
    });

    it('defaults a denied snapshot without canAskAgain info to denied', () => {
      expect(resolveCameraPermissionState({ status: 'denied', granted: false })).toBe('denied');
    });
  });

  describe('cameraPermissionRequiresSettings', () => {
    it('requires settings only for denied-permanently and restricted', () => {
      expect(cameraPermissionRequiresSettings('denied-permanently')).toBe(true);
      expect(cameraPermissionRequiresSettings('restricted')).toBe(true);
      expect(cameraPermissionRequiresSettings('denied')).toBe(false);
      expect(cameraPermissionRequiresSettings('undetermined')).toBe(false);
      expect(cameraPermissionRequiresSettings('granted')).toBe(false);
    });
  });

  describe('cameraPermissionAllowsCamera', () => {
    it('allows the camera only when granted', () => {
      expect(cameraPermissionAllowsCamera('granted')).toBe(true);
      expect(cameraPermissionAllowsCamera('denied')).toBe(false);
      expect(cameraPermissionAllowsCamera('denied-permanently')).toBe(false);
    });
  });
});
