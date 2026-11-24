import express from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Request, Response, Router } from 'express';
import type { YeneTeleStore } from '../store/yeneStore.ts';

interface MelaHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMelaRouter(store: YeneTeleStore): Router {
  const router = express.Router();

  router.post('/ask', async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error: 'MELA_AI_NOT_CONFIGURED',
        message: 'Mela AI is not configured yet. Please check Settings > Secrets for GEMINI_API_KEY.',
      });
      return;
    }

    const body = (req.body ?? {}) as {
      question?: string;
      history?: MelaHistoryTurn[];
      currentPath?: string;
    };

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 600) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Please enter a concise question (up to 600 characters).',
      });
      return;
    }

    const wantStream =
      req.query.stream === '1' ||
      String(req.headers.accept ?? '').includes('text/event-stream');

    try {
      const [operators, products, phones] = await Promise.all([
        store.listOperators(),
        store.listEsimProducts(),
        store.listPhoneProducts(),
      ]);
      const devices = store.listDevices();

      const operatorSummary = operators
        .map(
          (op) =>
            `${op.displayName} (${op.operatorCode}): enabled=${op.isEnabled}, supply=${op.activeSupplyMethod}, numberSelection=${op.numberAvailabilityMode}, prePayHold=${op.supportsPrePaymentReservation}`,
        )
        .join('; ');

      const productSummary = products
        .filter((p) => p.isActive)
        .map(
          (p) =>
            `${p.name} [${p.operatorCode}, ${p.productType}]: price=${p.priceEtb ?? p.sandboxPreviewAmountEtb ?? 'TBD'} ETB`,
        )
        .join('; ');

      const phoneSummary = phones
        .slice(0, 12)
        .map(
          (p) =>
            `${p.brand} ${p.model} (${p.exactModelNumber}, ${p.storage}, ${p.condition}): status=${p.esimCompatibilityStatus}, unlocked=${p.networkUnlockStatus}, price=${p.unitPriceEtb ?? p.sandboxPreviewPriceEtb ?? 'quote'} ETB, stock=${p.stockQty}`,
        )
        .join(' | ');

      const unsupportedExamples = devices
        .filter((d) => !d.esimSupported)
        .slice(0, 5)
        .map((d) => `${d.brand} ${d.modelFamily}: ${d.regionalCaveat}`)
        .join('; ');

      const historyText = Array.isArray(body.history)
        ? body.history
            .slice(-4)
            .map((h) => `${h.role === 'user' ? 'User' : 'Mela'}: ${String(h.text ?? '').slice(0, 200)}`)
            .join('\n')
        : '';

      const systemInstruction = [
        'You are Mela (መላ), Yene Tele’s crisp, knowledgeable Ethiopian eSIM & smartphone assistant.',
        'Style: Answer directly in 2 to 4 short sentences (or up to 3 concise bullets). Zero fluff. Reply in Amharic if asked in Amharic, otherwise clear English.',
        'Ground every answer strictly in these Yene Tele platform facts:',
        '1. About Yene Tele (የእኔ ቴሌኮም): Ethiopia-focused digital eSIM reseller, eSIM wallet, verified eSIM smartphone store, and business/agent platform. Independent partner reseller, not an MNO.',
        '2. Buy eSIM (6 Steps): (0) Sign in with Google first before starting the form; (1) Pick Ethio telecom (+251 9xx, 15-min stock hold) or Safaricom Ethiopia (+251 7xx); (2) Verify device is unlocked & shows 32-digit EID via *#06# (Mainland China/HK dual-SIM models like iPhone A3092 lack eSIM); (3) Subscriber Fayda KYC (legal name + 12-digit FAN/FIN + +251 phone + personal consent; agents cannot submit KYC for customers); (4) Pick number; (5) Pay via Chapa (Telebirr, CBE Birr, M-Pesa, cards); (6) Get AES-256-GCM encrypted QR, SM-DP+, and LPA:1$... code in /app/esims. iPhone: Settings -> Cellular -> Add eSIM. Android: Settings -> Network & internet -> SIMs -> Download a SIM.',
        '3. Phone Store (/phones & /app/phones): Curated iPhone, Samsung Galaxy & Google Pixel handsets checked by exact model number with 3 statuses (Verified eSIM Compatible, Compatibility Needs Verification, Not eSIM Compatible). Delivery via Klick courier requires active Ethiopian contact phone & address; customers can pair an eSIM operator.',
        '4. Portals: Customer (/app), My eSIMs (/app/esims), Business bulk (/app/business), Authorized Agents (/agent-programme, /agent).',
        `5. Operators: ${operatorSummary || 'Ethio telecom, Safaricom Ethiopia'}`,
        `6. Plans: ${productSummary || 'New eSIM Line'}`,
        `7. Phone Inventory: ${phoneSummary || 'iPhone, Samsung Galaxy, Google Pixel models'}`,
        `8. Non-eSIM Caveats: ${unsupportedExamples || 'Mainland China iPhone & Galaxy dual-SIM models lack eSIM.'}`,
        body.currentPath ? `9. User page: ${String(body.currentPath).slice(0, 80)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = historyText
        ? `Recent chat:\n${historyText}\n\nUser question: ${question}`
        : question;

      // Primary: recommended Q&A model (gemini-4-hydrogen with LOW thinking); fallback to gemini-3.1-flash-lite on transient 503/429
      const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel }> = [
        { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL },
      ];

      if (wantStream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        let streamedAny = false;
        for (let i = 0; i < attempts.length; i++) {
          const cfg = attempts[i];
          try {
            const stream = await ai.models.generateContentStream({
              model: cfg.model,
              contents: prompt,
              config: {
                systemInstruction,
                thinkingConfig: { thinkingLevel: cfg.thinkingLevel },
              },
            });
            for await (const chunk of stream) {
              const delta = chunk.text ?? '';
              if (delta) {
                streamedAny = true;
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              }
            }
            if (streamedAny) {
              res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              res.end();
              return;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const transient =
              msg.includes('503') ||
              msg.includes('429') ||
              msg.includes('UNAVAILABLE') ||
              msg.includes('RESOURCE_EXHAUSTED');
            if (!streamedAny && i < attempts.length - 1 && transient) {
              await sleep(200);
              continue;
            }
            const friendly = transient
              ? 'Mela is temporarily busy. Please ask again in a few seconds.'
              : msg;
            res.write(`data: ${JSON.stringify({ error: friendly })}\n\n`);
            res.end();
            return;
          }
        }
        res.write(
          `data: ${JSON.stringify({ error: 'Mela could not generate an answer right now. Please try again.' })}\n\n`,
        );
        res.end();
        return;
      }

      let answerText = '';
      let lastError: unknown = null;

      for (let i = 0; i < attempts.length; i++) {
        const cfg = attempts[i];
        try {
          const response = await ai.models.generateContent({
            model: cfg.model,
            contents: prompt,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: cfg.thinkingLevel },
            },
          });
          const candidate = response.text?.trim() ?? '';
          if (candidate) {
            answerText = candidate;
            break;
          }
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const transient =
            msg.includes('503') ||
            msg.includes('429') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('RESOURCE_EXHAUSTED');
          if (i < attempts.length - 1 && transient) {
            await sleep(200);
            continue;
          }
          if (i === attempts.length - 1) {
            throw err;
          }
        }
      }

      if (!answerText) {
        if (lastError) throw lastError;
        res.status(502).json({
          error: 'EMPTY_AI_RESPONSE',
          message: 'Mela could not generate an answer right now. Please try again.',
        });
        return;
      }

      res.json({ answer: answerText });
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Unable to reach Mela AI.';
      const isBusy =
        raw.includes('503') ||
        raw.includes('429') ||
        raw.includes('UNAVAILABLE') ||
        raw.toLowerCase().includes('high demand');
      if (wantStream && res.headersSent) {
        res.write(
          `data: ${JSON.stringify({ error: isBusy ? 'Mela is temporarily busy. Please ask again in a few seconds.' : raw })}\n\n`,
        );
        res.end();
        return;
      }
      res.status(502).json({
        error: 'MELA_UPSTREAM_ERROR',
        message: isBusy
          ? 'Mela is temporarily busy. Please ask again in a few seconds.'
          : raw,
      });
    }
  });

  return router;
}
