import { COOKIE } from '../../../server/auth';
import { query } from '../../../server/db';
import { api } from '../../../server/http';
import { setPreview } from '../../../server/preview';

export const POST = api('any', async (ctx, auth) => {
  await query('update session set revoked_at = now() where id = $1', [auth.sessionId]);
  ctx.cookies.delete(COOKIE, { path: '/' });
  setPreview(ctx, false);
  return { ok: true };
});
