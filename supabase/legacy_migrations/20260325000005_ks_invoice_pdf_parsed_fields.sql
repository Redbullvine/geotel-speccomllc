-- Add parsed PDF fields for K&S invoices.
alter table if exists public.ks_invoice_records
  add column if not exists invoice_key text not null default '',
  add column if not exists invoice_date text not null default '',
  add column if not exists week_ending text not null default '',
  add column if not exists project_name text not null default '',
  add column if not exists node_name text not null default '',
  add column if not exists bill_to_company text not null default '',
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists grand_total numeric(12,2) null,
  add column if not exists parse_status text not null default 'parsed',
  add column if not exists parse_error text not null default '';

update public.ks_invoice_records
set invoice_key = concat('SpecCom_', invoice_number)
where coalesce(invoice_key, '') = '' and coalesce(invoice_number, '') <> '';

create index if not exists idx_ks_invoice_records_org_invoice_key
  on public.ks_invoice_records(org_id, lower(invoice_key));
