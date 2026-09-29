import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import sharp from 'sharp';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { APP_CONFIG } from '../config';
import { FilesStore, type StoredFile } from '../files/files.store';
import { FilesController, publicBase } from './files.controller';

/**
 * The photo route the identity screen needs (ClaimIdentityStep, edit-profile):
 * POST /upload takes base64 JSON and answers { url }, the url serves a JPEG
 * at the size the client asked for, and nothing about it can be abused into
 * storing an arbitrary file or a huge one.
 */

class FakeFiles {
  rows = new Map<string, StoredFile & { uid: string }>();
  async put(uid: string, contentType: string, bytes: Buffer) {
    const id = `${this.rows.size}`.padStart(32, 'a');
    this.rows.set(id, { uid, contentType, bytes });
    return id;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
}

let app: INestApplication;
let base: string;
let files: FakeFiles;

beforeEach(async () => {
  files = new FakeFiles();
  const mod = await Test.createTestingModule({
    controllers: [FilesController],
    providers: [{ provide: FilesStore, useValue: files }, { provide: APP_CONFIG, useValue: {} }, FirebaseAuthGuard],
  })
    .overrideGuard(FirebaseAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!token) throw new UnauthorizedException('Sign in to continue.');
        req.user = { uid: token, email: null, name: null, picture: null };
        return true;
      },
    })
    .compile();
  app = mod.createNestApplication({ logger: false, bodyParser: false });
  // The same parsing main.ts sets up.
  app.use('/api/v1/upload', json({ limit: '11mb' }));
  app.use(json({ limit: '256kb' }));
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterEach(async () => {
  await app.close();
});

async function upload(body: unknown, query = '', as: string | null = 'u1') {
  const res = await fetch(`${base}/upload${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { url?: string; message?: string } };
}

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#3366ff' } }).png().toBuffer();

describe('POST /upload', () => {
  it('stores a resized JPEG and answers the address that serves it', async () => {
    const pic = await png(900, 600);
    const r = await upload(
      { file: pic.toString('base64'), filename: 'me.png', contentType: 'image/png' },
      '?width=320&height=320&quality=85&crop=attention',
    );
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/files\/[0-9a-f]{32}\.jpg$/);

    const got = await fetch(r.body.url!);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(got.headers.get('cache-control')).toContain('immutable');
    const meta = await sharp(Buffer.from(await got.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 320, height: 320 });
    expect([...files.rows.values()][0]!.uid).toBe('u1');
  });

  it('takes a photo far larger than the default body limit', async () => {
    const noisy = await sharp(randomBytes(700 * 700 * 3), {
      raw: { width: 700, height: 700, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(256 * 1024);
    const r = await upload({ file: noisy.toString('base64'), filename: 'big.png', contentType: 'image/png' });
    expect(r.status).toBe(201);
  });

  it('clamps the size it is asked for', async () => {
    const r = await upload(
      { file: (await png(50, 50)).toString('base64'), filename: 'a.png', contentType: 'image/png' },
      '?width=99999&height=-4',
    );
    expect(r.status).toBe(201);
    const meta = await sharp([...files.rows.values()][0]!.bytes).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(16);
  });

  it('refuses what is not a picture, with a sentence the screen can show', async () => {
    const svg = await upload({ file: Buffer.from('<svg/>').toString('base64'), filename: 'x.svg', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(400);
    expect(svg.body.message).toBe('Choose a JPEG, PNG, WebP or GIF picture.');

    const junk = await upload({ file: Buffer.from('not an image').toString('base64'), filename: 'x.png', contentType: 'image/png' });
    expect(junk.status).toBe(400);
    expect(junk.body.message).toBe('That file could not be read as a picture. Choose another one.');

    const empty = await upload({ filename: 'x.png', contentType: 'image/png' });
    expect(empty.status).toBe(400);
    expect(files.rows.size).toBe(0);
  });

  it('needs a signed-in person', async () => {
    const r = await upload({ file: 'aGk=', filename: 'x.png', contentType: 'image/png' }, '', null);
    expect(r.status).toBe(401);
  });
});

describe('GET /files/:id', () => {
  it('is a 404 for anything that is not a stored id', async () => {
    expect((await fetch(`${base}/files/nope.jpg`)).status).toBe(404);
    expect((await fetch(`${base}/files/${'b'.repeat(32)}.jpg`)).status).toBe(404);
  });
});

describe('publicBase', () => {
  it('names the address the browser used, https behind a proxy', () => {
    expect(publicBase({ headers: { 'x-forwarded-proto': 'https', host: 'arc-api.up.railway.app' } })).toBe(
      'https://arc-api.up.railway.app',
    );
    expect(publicBase({ headers: { host: 'arc-api.up.railway.app' } })).toBe('https://arc-api.up.railway.app');
    expect(publicBase({ headers: { 'x-forwarded-proto': 'http', host: '127.0.0.1:3000' } })).toBe('http://127.0.0.1:3000');
  });
});
