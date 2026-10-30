import { issueInvite } from '../../../../server/auth';
import { query, one } from '../../../../server/db';
import { api, HttpError, readJson, str } from '../../../../server/http';
import { inviteText } from '../../../../server/messages';

export const GET = api('admin', async () => ({
  people: await query(
    `select id, display_name, role, is_default_recipient, has_ezway, tech_assist_note, disabled_at,
            invite_expires_at, invite_redeemed_at, invite_revoked_at,
            (invite_token_hash is not null) as has_invite,
            (select count(*) from session s where s.person_id = person.id and s.revoked_at is null and s.expires_at > now()) as active_sessions
       from person order by id`,
  ),
}));

// 新增家人（代號即可）並同時產生第一條邀請連結
export const POST = api('admin', async (ctx, auth) => {
  const b = await readJson(ctx.request);
  const name = str(b.display_name, 'display_name', { max: 50 })!;
  const p = await one(
    `insert into person (display_name, role, is_default_recipient, has_ezway, tech_assist_note)
     values ($1,'family',$2,$3,$4) returning id`,
    [name, !!b.is_default_recipient, b.has_ezway ?? null, str(b.tech_assist_note, 'tech_assist_note', { required: false })],
  ).catch((e) => {
    if (e.code === '23505') throw new HttpError(409, 'duplicate_name', '這個代號已經有人用了');
    throw e;
  });
  const inv = (await issueInvite(p!.id, auth.person.id))!;
  const url = `${process.env.PUBLIC_BASE_URL ?? ''}/invite?t=${inv.token}`;
  return new Response(
    JSON.stringify({ id: p!.id, display_name: name, invite_url: url, expires_at: inv.expires_at, line_text: inviteText(name, url, false) }),
    { status: 201, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
  );
});
