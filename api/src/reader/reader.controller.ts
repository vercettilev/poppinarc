import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthedUser, CurrentUser, FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { PageReader } from './reader';

/**
 * POST /embed/asset/read  (signed in)  { items: [{ id, text }] }  ->  { items: [{ id, asset, reason }] }
 *
 * Signed in only: every read may cost a model call, so it is never open to
 * anyone who finds the address.
 */
@Controller('embed/asset')
export class ReaderController {
  constructor(private readonly reader: PageReader) {}

  @Post('read')
  @HttpCode(200)
  @UseGuards(FirebaseAuthGuard)
  read(@CurrentUser() user: AuthedUser, @Body() body: unknown) {
    return this.reader.read(user.uid, (body as { items?: unknown } | null)?.items);
  }
}
