import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

type AssetKind = 'texture' | 'model';
interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  mime: string;
  filename: string;
  createdAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), '.asset-backend');
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_FILE = path.join(DATA_DIR, 'assets.json');

function ensureDb() {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');
}

function readDb(): AssetRecord[] {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDb(items: AssetRecord[]) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, '_');
}

function extFromName(name: string): string {
  const e = path.extname(name);
  return e || '';
}

function withAssetBackend() {
  return {
    name: 'asset-backend',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/assets')) return next();

        ensureDb();

        if (req.method === 'GET' && req.url === '/api/assets') {
          const items = readDb();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(items));
          return;
        }

        if (req.method === 'POST' && req.url === '/api/assets') {
          try {
            const body = await readJsonBody(req);
            const name = String(body?.name ?? '').trim();
            const kind = body?.kind === 'model' ? 'model' : 'texture';
            const dataUrl = String(body?.dataUrl ?? '');
            if (!name || !dataUrl.startsWith('data:') || !dataUrl.includes(',')) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid payload' }));
              return;
            }
            const [header, b64] = dataUrl.split(',', 2);
            const mime = (header.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream').toLowerCase();
            const id = randomUUID();
            const filename = `${id}-${sanitizeFilename(path.basename(name, extFromName(name)))}${extFromName(name)}`;
            fs.writeFileSync(path.join(FILES_DIR, filename), Buffer.from(b64, 'base64'));

            const items = readDb();
            const record: AssetRecord = {
              id,
              name,
              kind,
              mime,
              filename,
              createdAt: new Date().toISOString(),
            };
            items.push(record);
            writeDb(items);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(record));
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to save asset' }));
          }
          return;
        }

        const fileMatch = req.url.match(/^\/api\/assets\/([^/]+)\/content$/);
        if (req.method === 'GET' && fileMatch) {
          const id = fileMatch[1];
          const item = readDb().find((a) => a.id === id);
          if (!item) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          const full = path.join(FILES_DIR, item.filename);
          if (!fs.existsSync(full)) {
            res.statusCode = 404;
            res.end('Missing file');
            return;
          }
          res.setHeader('Content-Type', item.mime || 'application/octet-stream');
          fs.createReadStream(full).pipe(res);
          return;
        }

        const deleteMatch = req.url.match(/^\/api\/assets\/([^/]+)$/);
        if (req.method === 'DELETE' && deleteMatch) {
          const id = deleteMatch[1];
          const items = readDb();
          const idx = items.findIndex((a) => a.id === id);
          if (idx === -1) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }
          const [removed] = items.splice(idx, 1);
          writeDb(items);
          const full = path.join(FILES_DIR, removed.filename);
          if (fs.existsSync(full)) fs.unlinkSync(full);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), withAssetBackend()],
  optimizeDeps: { exclude: ['engine-core'] },
  server: { fs: { allow: ['..'] } },
});
