-- 003：測試帳號旗標。is_test 為 true 的 person，其邀請連結可重複兌換（每次建立新 session，不撤銷既有 session）。
-- 一般家人維持單次兌換。預設 false，既有列不受影響。
alter table person add column is_test boolean not null default false;
