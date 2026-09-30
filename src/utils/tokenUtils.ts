export type TokenPayload = Record<string, unknown> & {
  exp?: number;
};

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  if (typeof atob === 'function') {
    return decodeURIComponent(
      atob(padded)
        .split('')
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
  }

  return Buffer.from(padded, 'base64').toString('utf8');
};

export const decodeToken = (token: string): TokenPayload | null => {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    return JSON.parse(decodeBase64Url(payload)) as TokenPayload;
  } catch {
    return null;
  }
};

export const getTokenExpiry = (token: string): Date | null => {
  const payload = decodeToken(token);
  if (typeof payload?.exp !== 'number') return null;

  return new Date(payload.exp * 1000);
};

export const isTokenExpired = (token: string): boolean => {
  const expiry = getTokenExpiry(token);
  if (!expiry) return true;

  return expiry.getTime() <= Date.now();
};

export const shouldRefresh = (token: string, bufferSeconds = 300): boolean => {
  const expiry = getTokenExpiry(token);
  if (!expiry) return true;

  return expiry.getTime() - Date.now() <= bufferSeconds * 1000;
};
