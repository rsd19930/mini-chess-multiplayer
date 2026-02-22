-- First, we safely drop if exists to ensure portability
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Create a function to automatically insert a new player when a user signs up (e.g., via Google Auth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.players (id, username, rating)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Player_' || substr(NEW.id::text, 1, 6)),
    1200
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function every time a user is created
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Insert the bot ('Picobot') into the players table with a deterministic system UUID
-- This UUID will be used by our Edge Function to assign the bot.
INSERT INTO public.players (id, username, rating)
VALUES ('00000000-0000-0000-0000-000000000000', 'Picobot', 1500)
ON CONFLICT (id) DO UPDATE SET username = 'Picobot';
