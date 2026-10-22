declare namespace PDFKit {
  interface PDFDocument {
    [key: string]: any;
    page: {
      width: number;
      height: number;
      margins: { left: number; right: number; top: number; bottom: number };
    };
    y: number;
  }
}

declare module 'pkce-challenge' {
  export default function pkceChallenge(length?: number): {
    code_verifier: string;
    code_challenge: string;
  };
}
