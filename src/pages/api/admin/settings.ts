import { api, HttpError, readJson, str } from '../../../server/http';
import { currentSettings, DEFAULTS, setSetting } from '../../../server/settings';

export const GET = api('admin', async () => ({ settings: await currentSettings() }));

// 更動留版本：{ key, value, source_note }（匯率須附來源與日期說明）
export const PUT = api('admin', async (ctx, auth) => {
  const b = await readJson(ctx.request);
  const key = str(b.key, 'key')!;
  if (!(key in DEFAULTS)) throw new HttpError(400, 'unknown_setting', '沒有這個參數');
  if (key === 'fx_rate' && !(typeof b.value === 'number' && b.value > 0))
    throw new HttpError(400, 'invalid_field', '匯率需為正數', { field: 'value' });
  if (key === 'fx_rate') str(b.source_note, 'source_note'); // 匯率必附來源與日期
  const version = await setSetting(key, b.value, str(b.source_note, 'source_note', { required: false }), auth.person.id);
  return { key, version };
});
