-- The private file bucket was created by hand on the staging project, so a new project (production) would not have it.
-- This creates it if it is missing and changes nothing if it already exists (staging). The bucket is never public; files are
-- served only through short-lived links that the staff-workspace function issues after checking access.
-- Skipped where the storage schema does not exist (local test databases).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'staff-pilot-private', 'staff-pilot-private', false, 10485760,
      ARRAY['application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv',
            'application/zip',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/png',
            'image/jpeg']
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
