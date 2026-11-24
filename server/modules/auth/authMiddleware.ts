import type { NextFunction, Request, Response } from 'express';
import type { AdminRole, AgentProfileRecord } from '../../../src/types/domain.ts';
import { DatabaseConnectionError } from '../../db/pool.ts';
import type { TokenVerifier, VerifiedIdentity } from './firebaseVerifier.ts';
import type { StaffAdminRecord, YeneTeleStore } from '../store/yeneStore.ts';

export interface AuthenticatedRequest extends Request {
  identity?: VerifiedIdentity;
  staffAdmin?: StaffAdminRecord;
  approvedAgent?: AgentProfileRecord;
}

export function createRequireAuth(verifier: TokenVerifier, store: YeneTeleStore) {
  return async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication token required.',
      });
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication token is empty.',
      });
      return;
    }

    let identity: VerifiedIdentity;
    try {
      identity = await verifier.verifyIdToken(token);
    } catch {
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired Firebase authentication token.',
      });
      return;
    }

    try {
      const user = await store.upsertAuthenticatedUser(identity);
      if (user.accountStatus !== 'active') {
        await store.recordAudit({
          actorType: 'customer',
          actorId: identity.uid,
          actorEmail: identity.email ?? undefined,
          action: 'SUSPENDED_ACCOUNT_ACCESS_BLOCKED',
          targetType: 'auth_session',
          targetId: identity.uid,
          reason: `Blocked request for ${user.accountStatus} account${user.suspendedReason ? `: ${user.suspendedReason}` : ''}`,
        });
        res.status(403).json({
          error: 'ACCOUNT_SUSPENDED',
          message: user.suspendedReason || 'Your Yene Tele account is currently suspended or disabled.',
        });
        return;
      }
      req.identity = identity;
      next();
    } catch (err) {
      if (err instanceof DatabaseConnectionError) {
        store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
        res.status(503).json({
          error: 'DATABASE_UNAVAILABLE',
          message: 'Database service is temporarily unavailable. Please retry shortly.',
        });
        return;
      }
      next(err);
    }
  };
}

export function createRequireApprovedAgent(store: YeneTeleStore) {
  return async function requireApprovedAgent(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const identity = req.identity;
    if (!identity) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
      return;
    }

    try {
      const agent = await store.getApprovedAgentByUserId(identity.uid);
      if (!agent) {
        await store.recordAudit({
          actorType: 'customer',
          actorId: identity.uid,
          actorEmail: identity.email ?? undefined,
          action: 'UNAUTHORIZED_AGENT_ACCESS_BLOCKED',
          targetType: 'agent_route',
          targetId: req.originalUrl,
          reason: 'Customer without approved agent status attempted to access restricted agent operations',
        });
        res.status(403).json({
          error: 'FORBIDDEN_AGENT_APPROVAL_REQUIRED',
          message: 'An approved Yene Tele agent profile is required for this endpoint.',
        });
        return;
      }

      req.approvedAgent = agent;
      next();
    } catch (err) {
      if (err instanceof DatabaseConnectionError) {
        store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
        res.status(503).json({
          error: 'DATABASE_UNAVAILABLE',
          message: 'Database service is temporarily unavailable. Please retry shortly.',
        });
        return;
      }
      next(err);
    }
  };
}

export function createRequireStaffAdmin(
  store: YeneTeleStore,
  allowedRoles?: AdminRole[],
) {
  return async function requireStaffAdmin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const identity = req.identity;
    if (!identity) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
      return;
    }

    try {
      const admin = await store.getStaffAdmin(identity.uid);
      if (!admin) {
        await store.recordAudit({
          actorType: 'customer',
          actorId: identity.uid,
          actorEmail: identity.email ?? undefined,
          action: 'UNAUTHORIZED_ADMIN_ACCESS_BLOCKED',
          targetType: 'admin_route',
          targetId: req.originalUrl,
          reason: 'Non-admin identity attempted to access restricted Yene Tele staff endpoint',
        });
        res.status(403).json({
          error: 'FORBIDDEN_ADMIN_ONLY',
          message: 'Staff administrator authorization is required for this endpoint.',
        });
        return;
      }

      if (allowedRoles && !allowedRoles.includes(admin.role)) {
        res.status(403).json({
          error: 'INSUFFICIENT_ADMIN_ROLE',
          message: `Admin role "${admin.role}" does not hold permission for this endpoint.`,
        });
        return;
      }

      req.staffAdmin = admin;
      next();
    } catch (err) {
      if (err instanceof DatabaseConnectionError) {
        store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
        res.status(503).json({
          error: 'DATABASE_UNAVAILABLE',
          message: 'Database service is temporarily unavailable. Please retry shortly.',
        });
        return;
      }
      next(err);
    }
  };
}
