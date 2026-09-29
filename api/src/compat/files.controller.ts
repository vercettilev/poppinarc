import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, FirebaseAuthGuard, type AuthedUser } from '../auth/firebase-auth.guard';
import { FilesStore } from '../files/files.store';
import { decodeUpload, ImageRejected, toJpeg, type ResizeAsk } from '../files/image';

/**
 * POST /upload, the route the extension's UserService.uploadFile calls
 * (ClaimIdentityStep and edit-profile set a photo through it), answered with
 * the same `{ url }` api.poppin.so gives. The URL points back here, at
 * GET /files/:id, which serves the stored JPEG to anyone: an avatar is shown
 * to other people, so it is public by nature, and its id cannot be guessed.
 *
 * The body is JSON with the picture in base64 (main.ts raises the JSON limit
 * for this one path only). Thirty uploads an hour per person is far above
 * what the identity screen needs and far below what would fill the table.
 */
const UPLOADS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const ID = /^[0-9a-f]{32}$/;

/** The address this request reached us at, as the reader's browser sees it (Railway terminates TLS). */
export function publicBase(req: Pick<Request, 'headers'> & { protocol?: string }): string {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  const proto = first(req.headers['x-forwarded-proto']) || req.protocol || 'https';
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || '';
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

@Controller()
export class FilesController {
  private readonly logger = new Logger('compat/files');
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly files: FilesStore) {}

  @Post('upload')
  @UseGuards(FirebaseAuthGuard)
  async upload(
    @CurrentUser() user: AuthedUser,
    @Body() body: unknown,
    @Query() ask: ResizeAsk,
    @Req() req: Request,
  ): Promise<{ url: string }> {
    this.admit(user.uid);
    try {
      const jpeg = await toJpeg(decodeUpload(body), ask);
      const id = await this.files.put(user.uid, 'image/jpeg', jpeg);
      return { url: `${publicBase(req)}/api/v1/files/${id}.jpg` };
    } catch (e) {
      if (e instanceof ImageRejected) throw new BadRequestException(e.message);
      if (e instanceof HttpException) throw e;
      this.logger.warn(`upload for ${user.uid} failed: ${(e as Error)?.message ?? e}`);
      throw new HttpException('Your photo could not be saved. Try again in a moment.', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get('files/:name')
  async file(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const id = String(name ?? '').replace(/\.jpg$/i, '');
    if (!ID.test(id)) throw new NotFoundException('Not found');
    const f = await this.files.get(id);
    if (!f) throw new NotFoundException('Not found');
    // An id is never reused for different bytes, so the picture can be cached for good.
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.bytes);
  }

  private admit(uid: string): void {
    const now = Date.now();
    const times = (this.recent.get(uid) ?? []).filter((t) => now - t < HOUR_MS);
    if (times.length >= UPLOADS_PER_HOUR) {
      throw new HttpException('That is a lot of photos for one hour. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    times.push(now);
    this.recent.set(uid, times);
    if (this.recent.size > 5000) {
      for (const [k, v] of this.recent) if (v.every((t) => now - t >= HOUR_MS)) this.recent.delete(k);
    }
  }
}
