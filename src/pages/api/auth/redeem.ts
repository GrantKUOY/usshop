import { redeemInvite, createSession } from '../../../server/auth';
import { api, HttpError, readJson, str } from '../../../server/http';
import { tx, logChange } from '../../../server/db';

// 家人兌換邀請連結：token 單次有效，成功後換發 HttpOnly cookie。
// 必須由前端頁面以 POST 呼叫（避免 LINE 連結預覽機器人誤用掉單次 token）。
export const POST = api('public', async (ctx) => {
  const body = await readJson(ctx.request);
  const token = str(body.token, 'token', { max: 200 })!;
  const person = await redeemInvite(token);
  if (!person) throw new HttpError(401, 'invalid_invite', '連結已失效或用過了，請請 Grant 重新傳一條給你');
  await tx(async (c) => {
    await createSession(ctx, person.id, 'family', c);
    await logChange(c, { type: 'person', id: person.id, field: 'invite', newValue: 'redeemed' });
  });
  return { ok: true, person: { id: person.id, display_name: person.display_name, role: 'family' } };
});
