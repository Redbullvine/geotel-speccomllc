# GeoTel Starter (Netlify drop-in zip)

This is a *starter* static web app that demonstrates:

- Inventory checklist (with item photos)
- Node-by-node workflow (open a node by node number)
- Splice location documentation gate (GPS + photo + timestamp required before completion)
- Unit threshold alerts (90%+)
- Role-based invoice visibility concept (server-side via Supabase RLS)

## Quick run (Demo mode)
Just open `index.html` locally, click **Use demo**, pick a role, and play.

## Make it real (Supabase + Netlify)

### 1) Create tables + RLS
In Supabase SQL editor, paste and run: `supabase_schema.sql`

### 2) Storage for photos
Create a Storage bucket, suggested name: `job-photos`
- Make it **private**
- Later: add a policy to allow only job roles to upload/read.

### 3) Create users + assign roles
- Use the UI to **Create user**
- In Supabase Table Editor, set `public.profiles.role` for each user:
  - OWNER (Louis Garcia, Spec Communications, LLC)
  - TDS, PRIME, SUB, SPLICER

### 4) Netlify environment variables
Set these in Netlify site settings:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Netlify will write `env.generated.js` at deploy time.

### 5) Connect real data
This starter currently uses demo in-memory data.
Next step is wiring app.js to:
- `nodes`
- `splice_locations`
- `inventory_items`
- `node_inventory`
- invoice tables

(If you want, I can wire that in the next iteration, plus photo uploads to Storage.)

## Security notes
- Pricing is in separate tables with strict RLS.
- Splicers never touch price tables.
- All enforcement must live in Supabase RLS (never only in frontend).
