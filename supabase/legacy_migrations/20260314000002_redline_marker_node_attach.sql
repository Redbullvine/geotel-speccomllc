alter table public.redline_markers
  add column if not exists attached_node_id text,
  add column if not exists node_name text;

create index if not exists redline_markers_attached_node_id_idx
  on public.redline_markers(attached_node_id);

notify pgrst, 'reload schema';