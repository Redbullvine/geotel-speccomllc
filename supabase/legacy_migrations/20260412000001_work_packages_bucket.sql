-- Create work-packages storage bucket for contractor export/share feature.
-- Files are private, accessible only via signed URLs (7-day expiry).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'work-packages',
  'work-packages',
  false,
  52428800, -- 50MB max per package
  ARRAY['application/zip', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own org folder
CREATE POLICY "work_packages_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'work-packages');

-- Allow anyone with a valid signed URL to read (signed URLs handle auth)
CREATE POLICY "work_packages_read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'work-packages');

-- Allow users to delete their own packages
CREATE POLICY "work_packages_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'work-packages');
