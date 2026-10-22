function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const value = parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const [fr, fg, fb] = hexToRgb(foreground);
  const [br, bg, bb] = hexToRgb(background);
  const foregroundLuminance =
    0.2126 * channelLuminance(fr) + 0.7152 * channelLuminance(fg) + 0.0722 * channelLuminance(fb);
  const backgroundLuminance =
    0.2126 * channelLuminance(br) + 0.7152 * channelLuminance(bg) + 0.0722 * channelLuminance(bb);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function passesWcagAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}
