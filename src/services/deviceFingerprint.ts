/**
 * Device Fingerprint Module
 *
 * Responsible for constructing and providing device metadata used in session
 * monitoring and crash reports.
 */

import config from '../config';

export interface DeviceMetadata {
  /** Device model identifier, e.g. "iPhone 14 Pro", "Pixel 7" */
  model: string;
  /** OS name, e.g. "iOS", "Android" */
  os: string;
  /** OS version string, e.g. "17.2", "14" */
  osVersion: string;
  /** App version from config */
  appVersion: string;
  /** Platform: "ios" | "android" | "web" */
  platform: string;
}

/**
 * Returns a fallback DeviceMetadata object when no device info is available.
 */
export function getDefaultDevice(): DeviceMetadata {
  return {
    model: 'unknown',
    os: 'unknown',
    osVersion: 'unknown',
    appVersion: config.app.version,
    platform: 'unknown',
  };
}
