ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS support_console_active boolean NOT NULL DEFAULT false;
