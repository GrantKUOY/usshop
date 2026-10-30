import { api } from '../../server/http';
import { batchAcceptsSubmit, openBatch } from '../../server/items';

// 當期開放批次與截止時間（沒有開放批次時 batch 為 null，家人只能存草稿）
export const GET = api('family', async () => {
  const b = await openBatch();
  return {
    server_time: new Date().toISOString(),
    batch: b ? { id: b.id, name: b.name, deadline_at: b.deadline_at, status: b.status } : null,
    can_submit: batchAcceptsSubmit(b),
  };
});
