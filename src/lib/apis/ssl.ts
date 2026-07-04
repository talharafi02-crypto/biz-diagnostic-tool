import tls from "node:tls";

export interface SslResult {
  valid: boolean;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  error: string | null;
}

/**
 * Connects directly to the domain on port 443 and inspects the real
 * certificate. No API key, no third party — this is a live, deterministic
 * check: same domain + same cert state = same result every time.
 */
export function checkSsl(hostname: string, timeoutMs = 8000): Promise<SslResult> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname, // SNI - required for most modern hosts
        timeout: timeoutMs,
        rejectUnauthorized: false, // we want to inspect even invalid certs, not throw
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || Object.keys(cert).length === 0) {
            resolve({
              valid: false,
              issuer: null,
              validFrom: null,
              validTo: null,
              daysRemaining: null,
              error: "No certificate presented",
            });
            socket.end();
            return;
          }

          const validTo = new Date(cert.valid_to);
          const now = new Date();
          const daysRemaining = Math.round(
            (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          resolve({
            valid: socket.authorized || daysRemaining > 0,
            issuer:
              (Array.isArray(cert.issuer?.O) ? cert.issuer.O[0] : cert.issuer?.O) ??
              (Array.isArray(cert.issuer?.CN) ? cert.issuer.CN[0] : cert.issuer?.CN) ??
              null,
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            daysRemaining,
            error: socket.authorized
              ? null
              : socket.authorizationError
              ? String(socket.authorizationError)
              : null,
          });
        } catch (e) {
          resolve({
            valid: false,
            issuer: null,
            validFrom: null,
            validTo: null,
            daysRemaining: null,
            error: e instanceof Error ? e.message : "Unknown SSL parse error",
          });
        } finally {
          socket.end();
        }
      }
    );

    socket.on("error", (err) => {
      resolve({
        valid: false,
        issuer: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        error: err.message,
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        valid: false,
        issuer: null,
        validFrom: null,
        validTo: null,
        daysRemaining: null,
        error: "Connection timed out",
      });
    });
  });
}
