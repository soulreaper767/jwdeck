import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import treeRoutes from './routes/tree.js';
import setupRoutes from './routes/setup.js';
import reportRoutes from './routes/report.js';
import viewRoutes from './routes/views.js';
import monthRoutes from './routes/month.js';
import adminRoutes from './routes/admin.js';
import hubRoutes from './sync/hub.js';
import nodeRoutes, { start as startSync, schedule as scheduleSync } from './sync/node.js';
import { isNode } from './sync/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5050;

if (!isNode() && !db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  console.log('No users found. Run "npm run seed" first.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
// desktop installs: sync soon after any successful change
if (isNode()) app.use('/api', (req, res, next) => { res.on('finish', () => { if (req.method !== 'GET' && res.statusCode < 400 && !req.path.startsWith('/sync')) scheduleSync(); }); next(); });
app.use('/api', nodeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, hubRoutes, treeRoutes, setupRoutes, reportRoutes, monthRoutes, viewRoutes, adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

const dist = process.env.JW_DIST || path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

export const ready = new Promise((resolve) => {
  const srv = app.listen(PORT, '127.0.0.1' === process.env.JW_BIND ? '127.0.0.1' : undefined, () => {
    console.log(`JW Dash ${isNode() ? '(desktop)' : ''} on http://localhost:${PORT}`);
    startSync();
    resolve(srv);
  });
});
