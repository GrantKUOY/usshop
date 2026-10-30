import type { APIContext, APIRoute } from 'astro';
import { authenticate, type AuthInfo } from './auth';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export async function readJson(request: Request): Promise<Record<string, any>> {
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', '請以 JSON 送出');
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'invalid_json', '內容格式不正確');
  }
}

export function idParam(ctx: APIContext, name = 'id'): number {
  const n = Number(ctx.params[name]);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'invalid_id', '編號不正確');
  return n;
}

export const str = (v: unknown, field: string, { max = 500, required = true } = {}): string | null => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, 'invalid_field', `${field} 為必填`, { field });
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_field', `${field} 格式不正確`, { field });
  const s = v.trim();
  if (!s && required) throw new HttpError(400, 'invalid_field', `${field} 為必填`, { field });
  if (s.length > max) throw new HttpError(400, 'invalid_field', `${field} 太長`, { field });
  return s || null;
};

export const num = (v: unknown, field: string, { required = true, min = 0, positive = false } = {}): number | null => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, 'invalid_field', `${field} 為必填`, { field });
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || (positive && n <= 0))
    throw new HttpError(400, 'invalid_field', `${field} 數字不正確`, { field });
  return n;
};

export const int = (v: unknown, field: string, opts: { required?: boolean; min?: number } = {}): number | null => {
  const n = num(v, field, { required: opts.required ?? true, min: opts.min ?? 0 });
  if (n !== null && !Number.isInteger(n)) throw new HttpError(400, 'invalid_field', `${field} 需為整數`, { field });
  return n;
};

type Role = 'family' | 'admin' | 'any' | 'public';

/** 包裝 API：Origin 檢查（CSRF）、驗證身分與角色、統一錯誤格式 */
export function api(role: Role, fn: (ctx: APIContext, auth: AuthInfo) => Promise<Response | unknown>): APIRoute {
  return async (ctx) => {
    try {
      const m = ctx.request.method;
      if (m !== 'GET' && m !== 'HEAD') {
        const origin = ctx.request.headers.get('origin');
        if (origin && new URL(origin).host !== new URL(ctx.request.url).host)
          throw new HttpError(403, 'bad_origin', '來源不被允許');
      }
      let auth: AuthInfo = undefined as any;
      if (role !== 'public') {
        const a = await authenticate(ctx);
        if (!a) throw new HttpError(401, 'unauthorized', '請重新用連結進站或重新登入');
        if (role !== 'any' && a.person.role !== role) throw new HttpError(403, 'forbidden', '沒有權限');
        auth = a;
      }
      const result = await fn(ctx, auth);
      return result instanceof Response ? result : json(result);
    } catch (e) {
      if (e instanceof HttpError)
        return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
      console.error(e);
      return json({ error: { code: 'internal_error', message: '系統忙碌，請稍後再試' } }, 500);
    }
  };
}
