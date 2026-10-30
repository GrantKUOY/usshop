import { logChange, one, query, tx } from '../../../../server/db';
import { api, HttpError, readJson, str } from '../../../../server/http';

export const GET = api('admin', async () => ({
  batches: await query(
    `select b.*, (select count(*) from order_item i where i.batch_id = b.id) as item_count from batch b order by id desc`,
  ),
}));

export const POST = api('admin', async (ctx, auth) => {
  const b = await readJson(ctx.request);
  const name = str(b.name, 'name', { max: 100 })!;
  const deadline = new Date(String(b.deadline_at));
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now())
    throw new HttpError(400, 'invalid_field', '截止時間需為未來時間（ISO 格式）', { field: 'deadline_at' });
  const created = await tx(async (c) => {
    const existing = await one(`select id from batch where status = 'open'`, [], c);
    if (existing) throw new HttpError(409, 'open_batch_exists', '已有開放中的批次，請先截止它');
    const row = await one('insert into batch (name, deadline_at) values ($1,$2) returning *', [name, deadline.toISOString()], c);
    await logChange(c, { type: 'batch', id: row!.id, field: 'status', newValue: 'open', operatorId: auth.person.id });
    return row;
  });
  return new Response(JSON.stringify(created), { status: 201, headers: { 'content-type': 'application/json; charset=utf-8' } });
});
