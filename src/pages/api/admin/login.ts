import { createSession, loginFailed, loginOk, loginThrottled, verifyPassword } from '../../../server/auth';
import { one } from '../../../server/db';
import { api, HttpError, readJson, str } from '../../../server/http';

// 管理員獨立登入（與家人邀請連結機制分開）。MFA 欄位已預留，尚未啟用。
export const POST = api('public', async (ctx) => {
  const body = await readJson(ctx.request);
  const name = str(body.name, 'name', { max: 100 })!;
  const password = str(body.password, 'password', { max: 200 })!;
  if (loginThrottled(name)) throw new HttpError(429, 'too_many_attempts', '嘗試太多次，請 15 分鐘後再試');
  const p = await one(
    `select id, display_name, password_hash, mfa_enabled from person
      where display_name = $1 and role = 'admin' and disabled_at is null`,
    [name],
  );
  const ok = await verifyPassword(password, p?.password_hash ?? null);
  if (!p || !ok) {
    loginFailed(name);
    throw new HttpError(401, 'bad_credentials', '帳號或密碼不正確');
  }
  if (p.mfa_enabled) throw new HttpError(501, 'mfa_not_implemented', 'MFA 尚未實作（待確認形式）');
  loginOk(name);
  await createSession(ctx, p.id, 'admin');
  return { ok: true, person: { id: p.id, display_name: p.display_name, role: 'admin' } };
});
