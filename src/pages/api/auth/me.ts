import { api } from '../../../server/http';

export const GET = api('any', async (_ctx, auth) => ({ person: auth.person }));
