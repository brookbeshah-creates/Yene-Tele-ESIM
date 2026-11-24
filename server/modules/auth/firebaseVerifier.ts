import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  phoneNumber: string | null;
  name: string | null;
  emailVerified: boolean;
}

export interface TokenVerifier {
  verifyIdToken(token: string): Promise<VerifiedIdentity>;
}

export function createFirebaseTokenVerifier(projectId: string): TokenVerifier {
  const app = getApps().length > 0 ? getApp() : initializeApp({ projectId });
  const auth = getAuth(app);

  return {
    async verifyIdToken(token: string): Promise<VerifiedIdentity> {
      const decoded = await auth.verifyIdToken(token);
      return {
        uid: decoded.uid,
        email: typeof decoded.email === 'string' ? decoded.email : null,
        phoneNumber: typeof decoded.phone_number === 'string' ? decoded.phone_number : null,
        name: typeof decoded.name === 'string' ? decoded.name : null,
        emailVerified: Boolean(decoded.email_verified),
      };
    },
  };
}
