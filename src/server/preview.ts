import type { APIContext } from 'astro';

/** 管理員預覽家人頁面的旗標 cookie：只是「顯示意圖」，不是 session，不授予任何寫入權限 */
export const PREVIEW_COOKIE = 'usshop_preview';

export const isPreview = (ctx: APIContext) => ctx.cookies.get(PREVIEW_COOKIE)?.value === '1';

export function setPreview(ctx: APIContext, on: boolean) {
  if (!on) {
    ctx.cookies.delete(PREVIEW_COOKIE, { path: '/' });
    return;
  }
  ctx.cookies.set(PREVIEW_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(ctx.request.url).protocol === 'https:',
    path: '/',
    maxAge: 12 * 3600, // 不超過管理員 session 預設效期
  });
}
