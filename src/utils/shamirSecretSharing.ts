import * as secrets from 'secrets.js-grempe';

export function splitSecret(mnemonic: string, shares: number, threshold: number): string[] {
  // convert to hex
  const hex = secrets.str2hex(mnemonic);
  // generate shares
  const parts = secrets.share(hex, shares, threshold);
  return parts;
}

export function combineShares(sharesArr: string[]): string {
  const hex = secrets.combine(sharesArr);
  const str = secrets.hex2str(hex);
  return str;
}

export default { splitSecret, combineShares };
