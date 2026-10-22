/**
 * Shared, deterministic profile-photo crop constraints.
 *
 * Used by both the camera and gallery profile-photo flows so that every
 * device produces the same bounded, predictable output regardless of the
 * source image's aspect ratio or resolution.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface CropConstraints {
  /** Fixed output width in pixels. */
  outputWidth: number;
  /** Fixed output height in pixels. */
  outputHeight: number;
  /** Output aspect ratio (width / height). */
  aspectRatio: number;
  /** JPEG compression quality in the 0..1 range. */
  quality: number;
}

/**
 * Deterministic profile-photo constraints. Output is always a square avatar
 * bounded to a fixed size, and compression is normalized across platforms.
 */
export const PROFILE_PHOTO_CONSTRAINTS: CropConstraints = {
  outputWidth: 512,
  outputHeight: 512,
  aspectRatio: 1,
  quality: 0.8,
};

/**
 * Compute a centered, contained crop rectangle for the given source image.
 *
 * The crop is the largest region matching the target aspect ratio that fits
 * entirely inside the source, centered on the image. This avoids clipping the
 * subject/face by default (no aggressive zoom or off-center framing).
 */
export function computeCropRect(
  source: ImageDimensions,
  constraints: CropConstraints = PROFILE_PHOTO_CONSTRAINTS,
): CropRect {
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  const aspectRatio = constraints.aspectRatio;

  let cropWidth: number;
  let cropHeight: number;

  if (sourceWidth / sourceHeight > aspectRatio) {
    // Source is wider than target: bound by height, crop the sides.
    cropHeight = sourceHeight;
    cropWidth = Math.round(sourceHeight * aspectRatio);
  } else {
    // Source is taller than target: bound by width, crop top/bottom.
    cropWidth = sourceWidth;
    cropHeight = Math.round(sourceWidth / aspectRatio);
  }

  cropWidth = Math.min(cropWidth, sourceWidth);
  cropHeight = Math.min(cropHeight, sourceHeight);

  return {
    originX: Math.round((sourceWidth - cropWidth) / 2),
    originY: Math.round((sourceHeight - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * Resolve the deterministic output dimensions for a crop, bounded to the
 * fixed max width/height defined by the constraints.
 */
export function computeOutputDimensions(
  constraints: CropConstraints = PROFILE_PHOTO_CONSTRAINTS,
): ImageDimensions {
  return {
    width: constraints.outputWidth,
    height: constraints.outputHeight,
  };
}

/**
 * Build the full, deterministic crop result for a source image. Both the
 * camera and gallery flows should route through this so behavior is identical.
 */
export function buildProfilePhotoCrop(
  source: ImageDimensions,
  constraints: CropConstraints = PROFILE_PHOTO_CONSTRAINTS,
): { crop: CropRect; output: ImageDimensions; quality: number } {
  return {
    crop: computeCropRect(source, constraints),
    output: computeOutputDimensions(constraints),
    quality: constraints.quality,
  };
}
