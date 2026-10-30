-- 001_init：DEV_SPEC 第 3 章 14 張表 + 支援表（session、shipment_allocation）
-- 狀態欄位用英文代碼存放，對照見 PROGRESS_CLAUDE.md。
-- 角色權限（只增不改）由 db/migrate.ts 在遷移後依 DATABASE_URL 的使用者套用，不寫死角色名。

-- 3.1 Person
create table person (
  id                   bigint generated always as identity primary key,
  display_name         text not null,
  role                 text not null check (role in ('family', 'admin')),
  invite_token_hash    text unique,
  invite_expires_at    timestamptz,
  invite_redeemed_at   timestamptz,
  invite_revoked_at    timestamptz,
  disabled_at          timestamptz,
  is_default_recipient boolean not null default false,
  has_ezway            boolean,
  tech_assist_note     text,
  password_hash        text,                      -- 僅管理員
  mfa_secret           text,                      -- 預留（待確認：TOTP／通行密鑰）
  mfa_enabled          boolean not null default false,
  created_at           timestamptz not null default now()
);
create unique index person_display_name_uq on person (display_name);

-- 工作階段（家人與管理員共用；每次請求都查表，撤銷即時生效）
create table session (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique,
  person_id   bigint not null references person(id),
  kind        text not null check (kind in ('family', 'admin')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index session_person_idx on session (person_id);

-- 3.2 Batch
create table batch (
  id          bigint generated always as identity primary key,
  name        text not null,
  deadline_at timestamptz not null,
  status      text not null default 'open'
              check (status in ('open', 'closed', 'ordered', 'shipping', 'arrived', 'settled')),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
-- 同時僅一個開放中批次（資料層限制）
create unique index batch_single_open_uq on batch ((true)) where status = 'open';

-- 3.3 Product
create table product (
  id             bigint generated always as identity primary key,
  name_zh        text not null,
  declared_name  text,
  url            text,
  store          text,
  spec_options   jsonb not null default '[]',
  image_path     text,
  is_featured    boolean not null default false,
  featured_sort  integer not null default 0,
  online_at      timestamptz,
  offline_at     timestamptz,
  weight_lb      numeric(8,2),
  weight_source  text not null default 'none'
                 check (weight_source in ('merchant', 'measured', 'category_assumption', 'none')),
  restricted_flag boolean not null default false,
  created_at     timestamptz not null default now()
);

-- 3.4 Candidate（與正式商品／報價分離）
create table candidate (
  id                 bigint generated always as identity primary key,
  product_id         bigint references product(id),     -- 核准上架後關聯
  merchant           text not null,
  merchant_type      text not null
                     check (merchant_type in ('brand_official', 'costco', 'amazon_first_party',
                                              'brand_flagship', 'amazon_third_party', 'other')),
  source_url         text not null,
  name               text not null,
  spec_label         text not null default '',          -- 規格／包裝量（去重鍵之一）
  sizes_available    jsonb not null default '[]',
  image_path         text,
  currency           text not null default 'USD',
  list_price         numeric(12,2),
  sale_price         numeric(12,2),
  promo_conditions   text,
  stock_note         text,
  checked_at         timestamptz not null,
  expires_at         timestamptz,
  tw_ref_price       numeric(12,2),
  tw_ref_source      text,
  tw_ref_checked_at  timestamptz,
  same_spec_basis    text,                              -- 空＝無法確認同規格，不顯示價差
  whitelist_pass     boolean not null,
  restricted_hit     boolean not null default false,
  restricted_keywords jsonb not null default '[]',
  listing_status     text not null default 'pending_approval'
                     check (listing_status in ('pending_approval', 'listed', 'delisted', 'blocked')),
  delist_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index candidate_dedupe_uq on candidate (source_url, spec_label);

-- 3.5 OrderItem
create table order_item (
  id                      bigint generated always as identity primary key,
  batch_id                bigint references batch(id),  -- 草稿期可空，送出時綁定
  person_id               bigint not null references person(id),
  product_id              bigint references product(id),
  candidate_id            bigint references candidate(id),
  source                  text not null check (source in ('featured', 'custom')),
  status                  text not null default 'draft'
                          check (status in ('draft', 'pending_admin', 'confirmed', 'rejected',
                                            'pending_family', 'ordered', 'not_bought')),
  draft_data              jsonb not null default '{}',  -- 僅草稿／退回修改期使用（可變）
  current_revision_id     bigint,
  reject_reason           text,
  arrival_override        boolean not null default false,
  restricted_review_status text not null default 'none'
                          check (restricted_review_status in ('none', 'reminded', 'confirmed')),
  restricted_hit          boolean not null default false,
  confirmed_revision_id   bigint,
  confirmed_price_check_id bigint,
  confirmed_estimate_id   bigint,
  family_confirm_needed_reason text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index order_item_person_idx on order_item (person_id);
create index order_item_batch_idx on order_item (batch_id);

-- 3.6 OrderItemRevision（只增不改）
create table order_item_revision (
  id                 bigint generated always as identity primary key,
  order_item_id      bigint not null references order_item(id),
  version_no         integer not null,
  name               text not null,
  url                text,
  spec               text,
  spec_undecided     boolean not null default false,
  quantity           integer not null check (quantity > 0),
  note               text,
  family_ref_price   numeric(12,2),
  max_price          numeric(12,2),
  max_price_currency text,
  submitted_at       timestamptz not null default now(),
  submitted_by       bigint not null references person(id),
  idempotency_key    text not null,
  unique (order_item_id, version_no),
  unique (submitted_by, idempotency_key)
);
alter table order_item add constraint order_item_current_rev_fk
  foreign key (current_revision_id) references order_item_revision(id);
alter table order_item add constraint order_item_confirmed_rev_fk
  foreign key (confirmed_revision_id) references order_item_revision(id);

-- 3.7 PriceCheck（只增不改；正式報價僅能由 Grant 人工核准產生）
create table price_check (
  id                  bigint generated always as identity primary key,
  order_item_id       bigint references order_item(id),
  product_id          bigint references product(id),
  unit_price          numeric(12,2) not null check (unit_price > 0),
  currency            text not null,
  promo_condition     text,
  source_url          text,
  checked_at          timestamptz not null,
  operator_id         bigint not null references person(id),
  weight_lb           numeric(8,2),
  weight_source       text not null default 'none'
                      check (weight_source in ('merchant', 'measured', 'category_assumption', 'none')),
  category_key        text,
  domestic_shipping   numeric(12,2),                    -- 外幣；未知＝NULL，不寫 0
  estimate_params     jsonb not null default '{}',
  stock_note          text,
  source_candidate_id bigint references candidate(id),
  approved_by         bigint not null references person(id),
  approved_at         timestamptz not null default now(),
  check (order_item_id is not null or product_id is not null)
);
create index price_check_item_idx on price_check (order_item_id, id desc);
alter table order_item add constraint order_item_confirmed_pc_fk
  foreign key (confirmed_price_check_id) references price_check(id);

-- 3.8 Estimate（不可變）
create table estimate (
  id                    bigint generated always as identity primary key,
  revision_id           bigint not null references order_item_revision(id),
  price_check_id        bigint not null references price_check(id),
  calculated_at         timestamptz not null default now(),
  input                 jsonb not null,
  params_snapshot       jsonb not null,
  formula_version       text not null,
  result_kind           text not null check (result_kind in ('point', 'range', 'pending_check')),
  result                jsonb not null,
  scenarios             jsonb,
  created_by            bigint references person(id)
);
create index estimate_rev_idx on estimate (revision_id, price_check_id, id desc);
alter table order_item add constraint order_item_confirmed_est_fk
  foreign key (confirmed_estimate_id) references estimate(id);

-- 3.9 PurchaseOrder（下期邏輯，先建表）
create table purchase_order (
  id               bigint generated always as identity primary key,
  batch_id         bigint references batch(id),
  merchant         text not null,
  order_no         text,
  ordered_on       date,
  warehouse_label  text check (warehouse_label in ('main', 'amazon_ebay')),
  tracking_numbers jsonb not null default '[]',
  arrived_on       date,
  anomaly_note     text,
  created_at       timestamptz not null default now()
);

-- 3.11 Shipment（下期邏輯，先建表）
create table shipment (
  id                     bigint generated always as identity primary key,
  importer_person_id     bigint not null references person(id),
  package_refs           jsonb not null default '[]',
  forwarder_no           text,
  shipped_on             date,
  declared_at            timestamptz,
  declaration_status     text not null default 'not_declared',
  actual_weight_lb       numeric(8,2),
  actual_freight_twd     numeric(12,2),
  cif_estimate_twd       numeric(12,2),
  status                 text not null default 'planning',
  importer_external_dutyfree_count integer,
  has_plus_coverage      boolean not null default false,
  created_at             timestamptz not null default now()
);

-- 3.10 PurchaseResult（下期邏輯，先建表）
create table purchase_result (
  id               bigint generated always as identity primary key,
  order_item_id    bigint not null references order_item(id),
  revision_id      bigint not null references order_item_revision(id),
  qty_bought       integer not null check (qty_bought >= 0),
  paid_unit_price  numeric(12,2),
  currency         text,
  result           text not null check (result in ('bought', 'partial', 'not_bought')),
  reason           text,
  purchase_order_id bigint references purchase_order(id),
  shipment_id      bigint references shipment(id),
  recorded_at      timestamptz not null default now(),
  check (result = 'bought' or reason is not null)
);

-- 貨件品項分配（3.11「品項分配清單」；已分配量 ≤ 實購量由下期邏輯檢核）
create table shipment_allocation (
  id            bigint generated always as identity primary key,
  shipment_id   bigint not null references shipment(id),
  order_item_id bigint not null references order_item(id),
  revision_id   bigint not null references order_item_revision(id),
  qty           integer not null check (qty > 0)
);

-- 3.12 Settlement（下期邏輯，先建表；每次結算新增一版）
create table settlement (
  id               bigint generated always as identity primary key,
  version_no       integer not null,
  person_id        bigint not null references person(id),
  batch_id         bigint references batch(id),
  shipment_id      bigint references shipment(id),
  estimated_payable numeric(12,2),
  paid_amount      numeric(12,2),
  final_payable    numeric(12,2),
  adjustments      jsonb not null default '[]',
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  settled_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- 3.13 ChangeLog（只增不改）
create table change_log (
  id           bigint generated always as identity primary key,
  target_type  text not null,
  target_id    bigint not null,
  field        text,
  old_value    jsonb,
  new_value    jsonb,
  reason       text,
  operator_id  bigint references person(id),
  created_at   timestamptz not null default now()
);
create index change_log_target_idx on change_log (target_type, target_id);

-- 3.14 Setting（更動留版本，只增不改；現行值＝同 key 最大 version）
create table setting (
  id         bigint generated always as identity primary key,
  key        text not null,
  version    integer not null,
  value      jsonb not null,
  source_note text,                                    -- 例：匯率來源與日期
  created_by bigint references person(id),
  created_at timestamptz not null default now(),
  unique (key, version)
);
