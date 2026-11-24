import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { apiRequest } from '../lib/apiClient';
import { auth, googleProvider } from '../lib/firebase';
import type {
  AdminRole,
  AgentProfileRecord,
  AgentReviewStatus,
  AuthenticatedMeResponse,
} from '../types/domain';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: AuthenticatedMeResponse | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  refreshProfile: () => Promise<AuthenticatedMeResponse | null>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  isStaffAdmin: boolean;
  adminRole: AdminRole | null;
  agentStatus: AgentReviewStatus | 'none';
  agentProfile: AgentProfileRecord | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in is not yet enabled in this Firebase project Console. Use "Continue with Google" or enable Email/Password under Firebase Console -> Authentication -> Sign-in method.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Invalid email or password.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists. Please sign in instead.';
  }
  if (code === 'auth/weak-password') {
    return 'Password should be at least 6 characters.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Sign-in window was closed before completing.';
  }
  return err instanceof Error ? err.message : 'Authentication failed.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthenticatedMeResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshProfile = useCallback(async (): Promise<AuthenticatedMeResponse | null> => {
    if (!auth.currentUser) {
      setProfile(null);
      return null;
    }
    const data = await apiRequest<AuthenticatedMeResponse>('/api/v1/me');
    setProfile(data);
    return data;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }
      try {
        await refreshProfile();
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to load profile.');
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, [refreshProfile]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      await refreshProfile();
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await refreshProfile();
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const registerWithEmail = async (name: string, email: string, password: string) => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }
      await refreshProfile();
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    setAuthError(null);
    await signOut(auth);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        authError,
        clearAuthError: () => setAuthError(null),
        refreshProfile,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        requestPasswordReset,
        logout,
        isStaffAdmin: Boolean(profile?.isStaffAdmin),
        adminRole: profile?.adminRole ?? null,
        agentStatus: profile?.agentStatus ?? 'none',
        agentProfile: profile?.agentProfile ?? null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
