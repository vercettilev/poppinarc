import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

/**
 * Pictures people upload (today: profile photos), kept in Postgres.
 *
 * Postgres rather than a bucket because this service has no object storage
 * and the pictures are small: /upload stores them already resized (320 px
 * JPEG, a few tens of KB). Each person keeps their KEEP_PER_USER newest, so
 * a reader who tries ten photos on the identity screen does not leave ten
 * behind forever.
 *
 * The id is 128 random bits: the address is public (an avatar is shown to
 * other people), but it cannot be guessed or walked.
 */
export const KEEP_PER_USER = 10;

export interface StoredFile {
  contentType: string;
  bytes: Buffer;
}

@Injectable()
export class FilesStore {
  constructor(private readonly db: DbService) {}

  async put(uid: string, contentType: string, bytes: Buffer): Promise<string> {
    const id = randomBytes(16).toString('hex');
    await this.db.query('INSERT INTO files (id, uid, content_type, bytes) VALUES ($1, $2, $3, $4)', [
      id,
      uid,
      contentType,
      bytes,
    ]);
    await this.db.query(
      `DELETE FROM files WHERE uid = $1 AND id NOT IN (
         SELECT id FROM files WHERE uid = $1 ORDER BY created_at DESC, id DESC LIMIT $2
       )`,
      [uid, KEEP_PER_USER],
    );
    return id;
  }

  async get(id: string): Promise<StoredFile | null> {
    const rows = await this.db.query<{ content_type: string; bytes: Buffer }>(
      'SELECT content_type, bytes FROM files WHERE id = $1',
      [id],
    );
    const r = rows[0];
    return r ? { contentType: r.content_type, bytes: r.bytes } : null;
  }
}
