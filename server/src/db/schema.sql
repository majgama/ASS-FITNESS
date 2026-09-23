CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  date_of_birth DATE,
  profile_photo_path TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'personal', 'student')),
  password_hash TEXT NOT NULL,
  cref TEXT,
  password_changed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_data BYTEA;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_mime TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS personal_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty TEXT,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS personal_profiles_set_updated_at ON personal_profiles;
CREATE TRIGGER personal_profiles_set_updated_at
BEFORE UPDATE ON personal_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  objective TEXT,
  start_date DATE,
  restrictions TEXT,
  next_assessment_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  inactive_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS student_profiles_set_updated_at ON student_profiles;
CREATE TRIGGER student_profiles_set_updated_at
BEFORE UPDATE ON student_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_valid_idx ON sessions(token_hash, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_trainer_idx ON invitations(trainer_id);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations(lower(email));

CREATE TABLE IF NOT EXISTS trainer_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'primary' CHECK (relationship_type IN ('primary', 'secondary')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, student_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS trainer_students_one_primary_idx
ON trainer_students(student_id)
WHERE relationship_type = 'primary';

CREATE INDEX IF NOT EXISTS trainer_students_trainer_idx ON trainer_students(trainer_id);
CREATE INDEX IF NOT EXISTS trainer_students_student_idx ON trainer_students(student_id);

CREATE TABLE IF NOT EXISTS trainer_billing (
  trainer_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_student_limit INTEGER NOT NULL DEFAULT 3,
  paid_student_limit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'active', 'canceled', 'refunded', 'chargeback', 'expired')),
  access_until TIMESTAMPTZ,
  hotmart_subscription_code TEXT,
  hotmart_buyer_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trainer_billing_set_updated_at ON trainer_billing;
CREATE TRIGGER trainer_billing_set_updated_at
BEFORE UPDATE ON trainer_billing
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'hotmart',
  provider_event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  buyer_email TEXT,
  status TEXT,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  muscle_group TEXT,
  default_sets TEXT,
  default_repetitions TEXT,
  default_load TEXT,
  default_rest_seconds INTEGER,
  observations TEXT,
  youtube_url TEXT,
  video_path TEXT,
  video_mime TEXT,
  video_size_bytes INTEGER,
  video_duration_seconds NUMERIC,
  gif_path TEXT,
  gif_mime TEXT,
  gif_size_bytes INTEGER,
  audio_path TEXT,
  audio_mime TEXT,
  audio_size_bytes INTEGER,
  audio_duration_seconds NUMERIC,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((visibility = 'public' AND owner_id IS NULL) OR (visibility = 'private' AND owner_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS exercises_visibility_idx ON exercises(visibility);
CREATE INDEX IF NOT EXISTS exercises_owner_idx ON exercises(owner_id);

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS gif_library_path TEXT;

DROP TRIGGER IF EXISTS exercises_set_updated_at ON exercises;
CREATE TRIGGER exercises_set_updated_at
BEFORE UPDATE ON exercises
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS gif_library_favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gif_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gif_id)
);

CREATE TABLE IF NOT EXISTS gif_library_overrides (
  gif_id TEXT PRIMARY KEY,
  name_pt TEXT,
  muscle_group_pt TEXT,
  hidden BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((visibility = 'public' AND owner_id IS NULL) OR (visibility = 'private' AND owner_id IS NOT NULL))
);

DROP TRIGGER IF EXISTS daily_workouts_set_updated_at ON daily_workouts;
CREATE TRIGGER daily_workouts_set_updated_at
BEFORE UPDATE ON daily_workouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS daily_workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_workout_id UUID NOT NULL REFERENCES daily_workouts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0,
  sets TEXT,
  repetitions TEXT,
  load TEXT,
  rest_seconds INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_workout_exercises_workout_idx ON daily_workout_exercises(daily_workout_id);

CREATE TABLE IF NOT EXISTS weekly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((visibility = 'public' AND owner_id IS NULL) OR (visibility = 'private' AND owner_id IS NOT NULL))
);

DROP TRIGGER IF EXISTS weekly_plans_set_updated_at ON weekly_plans;
CREATE TRIGGER weekly_plans_set_updated_at
BEFORE UPDATE ON weekly_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS weekly_plan_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_rest BOOLEAN NOT NULL DEFAULT false,
  daily_workout_id UUID REFERENCES daily_workouts(id) ON DELETE SET NULL,
  instructions TEXT,
  UNIQUE(weekly_plan_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS student_weekly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekly_plan_id UUID REFERENCES weekly_plans(id) ON DELETE SET NULL,
  plan_snapshot JSONB NOT NULL,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  start_date DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_weekly_plans_student_idx ON student_weekly_plans(student_id, status);

CREATE TABLE IF NOT EXISTS workout_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_weekly_plan_id UUID NOT NULL REFERENCES student_weekly_plans(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  message TEXT,
  difficulty TEXT,
  is_plan_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assessment_date DATE NOT NULL DEFAULT current_date,
  weight_kg NUMERIC,
  height_cm NUMERIC,
  chest_cm NUMERIC,
  waist_cm NUMERIC,
  abdomen_cm NUMERIC,
  hip_cm NUMERIC,
  right_arm_cm NUMERIC,
  left_arm_cm NUMERIC,
  right_thigh_cm NUMERIC,
  left_thigh_cm NUMERIC,
  right_calf_cm NUMERIC,
  left_calf_cm NUMERIC,
  body_goal TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessments_student_idx ON assessments(student_id, assessment_date DESC);

CREATE TABLE IF NOT EXISTS student_billing (
  student_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  due_date DATE,
  monthly_amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC,
  due_date DATE,
  paid_at DATE,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'overdue')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_payment_history_student_idx
ON student_payment_history(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assessment_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  angle TEXT NOT NULL CHECK (angle IN ('front', 'side', 'back')),
  file_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  file_data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(assessment_id, angle)
);

ALTER TABLE assessment_photos ADD COLUMN IF NOT EXISTS file_data BYTEA;

CREATE TABLE IF NOT EXISTS diet_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan_date DATE NOT NULL DEFAULT current_date,
  general_guidelines TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS diet_plans_set_updated_at ON diet_plans;
CREATE TRIGGER diet_plans_set_updated_at
BEFORE UPDATE ON diet_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS student_diet_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diet_plan_id UUID REFERENCES diet_plans(id) ON DELETE SET NULL,
  diet_snapshot JSONB NOT NULL,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_diet_plans_student_idx ON student_diet_plans(student_id, applied_at DESC);
