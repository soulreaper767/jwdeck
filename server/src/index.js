import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import treeRoutes from './routes/tree.js';
import headRoutes from './routes/heads.js';
import formatRoutes from './routes/formats.js';
import entryRoutes from './routes/entry.js';
import consolRoutes from './routes/consol.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5050;

if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  console.log('No users found — run "npm run seed" in /server to load the starter data.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, treeRoutes, headRoutes, formatRoutes, entryRoutes, consolRoutes, adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`JW Dash API on http://localhost:${PORT}`));
