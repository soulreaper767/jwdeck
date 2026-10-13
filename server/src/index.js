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
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5050;

if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  console.log('No users found. Run "npm run seed" first.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, treeRoutes, setupRoutes, reportRoutes, viewRoutes, adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`JW Dash on http://localhost:${PORT}`));
