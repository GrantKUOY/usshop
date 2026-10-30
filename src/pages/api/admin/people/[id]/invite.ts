import { issueInvite, revokeInvite } from '../../../../../server/auth';
import { one } from '../../../../../server/db';
import { api, HttpError, idParam } from '../../../../../server/http';
import { inviteText } from '../../../../../server/messages';

// 重發：同時撤銷舊邀請與其既有工作階段（舊連結與舊工作階段即刻回 401）
export const POST = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  const p = await one(`select display_name, invite_token_hash from person where id = $1 and role = 'family'`, [id]);
  if (!p) throw new HttpError(404, 'not_found', '找不到這位家人');
  const inv = await issueInvite(id, auth.person.id);
  if (!inv) throw new HttpError(409, 'person_disabled', '這位家人已停用');
  const url = `${process.env.PUBLIC_BASE_URL ?? ''}/invite?t=${inv.token}`;
  return {
    invite_url: url,
    expires_at: inv.expires_at,
    line_text: inviteText(p.display_name, url, !!p.invite_token_hash),
  };
});

export const DELETE = api('admin', async (ctx, auth) => {
  const id = idParam(ctx);
  if (!(await revokeInvite(id, auth.person.id))) throw new HttpError(404, 'not_found', '找不到這位家人');
  return { ok: true };
});
