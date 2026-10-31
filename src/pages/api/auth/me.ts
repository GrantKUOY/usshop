import { api } from '../../../server/http';
import { isPreview } from '../../../server/preview';

export const GET = api('any', async (ctx, auth) => ({
  person: auth.person,
  preview: auth.person.role === 'admin' && isPreview(ctx),
}));
