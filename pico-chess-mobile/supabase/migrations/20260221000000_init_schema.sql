CREATE TYPE match_status AS ENUM ('waiting', 'active', 'completed', 'aborted');

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    rating INTEGER DEFAULT 1200 NOT NULL
);

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_white UUID REFERENCES players(id),
    player_black UUID REFERENCES players(id),
    status match_status DEFAULT 'waiting' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE
);
