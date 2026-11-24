import express from 'express';
import type { Response, Router } from 'express';
import { DatabaseConnectionError } from '../../db/pool.ts';
import { createRequireApprovedAgent, type AuthenticatedRequest } from '../auth/authMiddleware.ts';
import { DomainRuleError, YeneTeleStore } from '../store/yeneStore.ts';

function handleError(res: Response, err: unknown, store: YeneTeleStore): void {
  if (err instanceof DomainRuleError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof DatabaseConnectionError) {
    store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
    res.status(503).json({
      error: 'DATABASE_UNAVAILABLE',
      message: 'Database service is temporarily unavailable. Please retry shortly.',
    });
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
}

export function createAgentRouter(
  store: YeneTeleStore,
  requireAuth: (req: AuthenticatedRequest, res: Response, next: () => void) => void,
): Router {
  const router = express.Router();
  const requireApprovedAgent = createRequireApprovedAgent(store);

  router.use(requireAuth);

  router.get('/application', async (req: AuthenticatedRequest, res) => {
    try {
      const [application, agent] = await Promise.all([
        store.getAgentApplicationForUser(req.identity!.uid),
        store.getAnyAgentProfileByUserId(req.identity!.uid),
      ]);
      res.json({ application, agent });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/application', async (req: AuthenticatedRequest, res) => {
    try {
      const { fullName, phone, city, businessName, applicantType, experienceSummary } =
        (req.body ?? {}) as {
          fullName?: string;
          phone?: string;
          city?: string;
          businessName?: string;
          applicantType?: 'individual_agent' | 'retail_shop' | 'corporate_reseller';
          experienceSummary?: string;
        };
      if (!fullName?.trim() || !phone?.trim() || !city?.trim() || !experienceSummary?.trim()) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Full name, phone number, city, and distribution background are required.',
        });
        return;
      }
      const application = await store.submitAgentApplication(req.identity!.uid, req.identity!.email, {
        fullName,
        phone,
        city,
        businessName,
        applicantType: applicantType ?? 'individual_agent',
        experienceSummary,
      });
      res.status(201).json({ application });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  // Strict server-side approval guard: pending/rejected/regular users cannot access approved agent operations
  router.get('/dashboard', requireApprovedAgent, async (req: AuthenticatedRequest, res) => {
    try {
      const dashboard = await store.getAgentDashboard(req.approvedAgent!.id);
      res.json(dashboard);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  return router;
}
