import { Router } from 'express';
import { getPublicKey, pushEnabled, saveSubscription, removeSubscription } from '../services/pushService';

const router = Router();

router.get('/public-key', (_req, res) => {
  res.json({ enabled: pushEnabled, publicKey: getPublicKey() });
});

router.post('/subscribe', async (req, res) => {
  const { userId, subscription } = req.body ?? {};
  if (!userId || !subscription) return res.status(400).json({ error: 'userId y subscription requeridos' });
  const error = await saveSubscription(userId, subscription, req.headers['user-agent']);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint requerido' });
  await removeSubscription(endpoint);
  res.json({ success: true });
});

export default router;
