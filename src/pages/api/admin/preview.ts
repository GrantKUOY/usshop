import { api, readJson } from '../../../server/http';
import { setPreview } from '../../../server/preview';

// 啟用／退出「家人頁面預覽」：只設定旗標 cookie，不建立 session、不寫資料庫
export const POST = api('admin', async (ctx) => {
  const on = (await readJson(ctx.request)).on === true;
  setPreview(ctx, on);
  return { ok: true, preview: on };
});
