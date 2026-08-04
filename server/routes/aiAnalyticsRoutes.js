import express from 'express';
import { answerBusinessQuestion, canUseAiAnalytics, getAiBusinessStatus } from '../services/aiAnalyticsService.js';

export default function createAiAnalyticsRoutes(db) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!canUseAiAnalytics(req.user?.role)) {
      return res.status(403).json({ error: 'You do not have permission to use Ask PortFlow.' });
    }
    next();
  });

  router.get('/business/status', async (req, res) => {
    try {
      res.json(await getAiBusinessStatus(db, req.user.companyId));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'AI status request failed.' });
    }
  });

  router.get('/business/suggestions', (_req, res) => {
    res.json({
      suggestions: [
        'How much revenue did we make this month?',
        'Compare this month with last month.',
        'Which customer generated the most revenue?',
        'Which drivers were most efficient?',
        'Which loads are missing driver pay?',
      ],
    });
  });

  router.post('/business/query', async (req, res) => {
    try {
      res.json(await answerBusinessQuestion(db, req.user, req.body || {}));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Ask PortFlow request failed.' });
    }
  });

  return router;
}
