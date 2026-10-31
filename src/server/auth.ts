import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { APIContext } from 'astro';
import { logChange, one, query, tx, type Db } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const COOKIE = 'usshop_session';

export type AuthInfo = {
  person: { id: number; display_name: string; role: 'family' | 'admin' };
  sessionId: number;
};

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // 無此帳號時也做一次 scrypt，避免以時間差判斷帳號存在
  const [scheme, saltB64, hashB64] = (stored ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AA==').split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

const hours = (name: string, def: number) => Number(process.env[name] ?? def) || def;

export async function createSession(
  ctx: APIContext,
  personId: number,
  kind: 'family' | 'admin',
  db?: Db,
): Promise<void> {
  const token = newToken();
  const ttl = kind === 'admin' ? hours('ADMIN_SESSION_HOURS', 12) : hours('FAMILY_SESSION_HOURS', 4320);
  await query(
    `insert into session (token_hash, person_id, kind, expires_at)
     values ($1,$2,$3, now() + make_interval(hours => $4))`,
    [sha256(token), personId, kind, ttl],
    db,
  );
  ctx.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(ctx.request.url).protocol === 'https:',
    path: '/',
    maxAge: ttl * 3600,
  });
}

/** 每次請求都查資料庫：撤銷／停用即時生效（不靠 cookie 自帶效期） */
export async function authenticate(ctx: APIContext): Promise<AuthInfo | null> {
  const token = ctx.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const row = await one(
    `select s.id as session_id, p.id, p.display_name, p.role
       from session s join person p on p.id = s.person_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
        and p.disabled_at is null
        and (p.role = 'admin' or p.invite_revoked_at is null)
        and s.kind = p.role`,
    [sha256(token)],
  );
  if (!row) return null;
  return { person: { id: row.id, display_name: row.display_name, role: row.role }, sessionId: row.session_id };
}

export async function revokePersonSessions(db: Db, personId: number) {
  await query('update session set revoked_at = now() where person_id = $1 and revoked_at is null', [personId], db);
}

/** 發行（或重發）邀請：同時撤銷舊邀請與其既有工作階段；回傳明文 token（僅此一次） */
export async function issueInvite(
  personId: number,
  operatorId: number,
): Promise<{ token: string; expires_at: string } | null> {
  const token = newToken();
  const ttl = hours('INVITE_TTL_HOURS', 336);
  return tx(async (c) => {
    const p = await one(
      `update person set invite_token_hash = $2,
              invite_expires_at = now() + make_interval(hours => $3),
              invite_redeemed_at = null, invite_revoked_at = null
        where id = $1 and role = 'family' and disabled_at is null
        returning invite_expires_at`,
      [personId, sha256(token), ttl],
      c,
    );
    if (!p) return null;
    await revokePersonSessions(c, personId);
    await logChange(c, { type: 'person', id: personId, field: 'invite', newValue: 'issued', operatorId });
    return { token, expires_at: p.invite_expires_at };
  });
}

export async function revokeInvite(personId: number, operatorId: number): Promise<boolean> {
  return tx(async (c) => {
    const p = await one(
      `update person set invite_revoked_at = now() where id = $1 and role = 'family' returning id`,
      [personId],
      c,
    );
    if (!p) return false;
    await revokePersonSessions(c, personId);
    await logChange(c, { type: 'person', id: personId, field: 'invite', newValue: 'revoked', operatorId });
    return true;
  });
}

/** 單次兌換：原子條件更新，同一 token 第二次必失敗。測試帳號（is_test）可重複兌換，其餘條件（效期、撤銷、停用）不變 */
export async function redeemInvite(token: string): Promise<{ id: number; display_name: string } | null> {
  const row = await one(
    `update person set invite_redeemed_at = now()
      where invite_token_hash = $1 and (invite_redeemed_at is null or is_test) and invite_revoked_at is null
        and disabled_at is null and invite_expires_at > now() and role = 'family'
      returning id, display_name`,
    [sha256(token)],
  );
  return row ?? null;
}

// 管理員登入失敗節流（單機記憶體；Vercel 多實例下僅為輔助，待確認是否需資料庫計數）
const fails = new Map<string, { n: number; until: number }>();
export function loginThrottled(key: string): boolean {
  const f = fails.get(key);
  return !!f && f.n >= 5 && f.until > Date.now();
}
export function loginFailed(key: string) {
  const f = fails.get(key);
  fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
}
export const loginOk = (key: string) => fails.delete(key);
