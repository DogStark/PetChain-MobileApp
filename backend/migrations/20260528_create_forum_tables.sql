-- Create forum tables: posts, answers, votes
CREATE TABLE IF NOT EXISTS forum_posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  species VARCHAR(50),
  breed VARCHAR(100),
  author_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_answers (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id UUID,
  verified BOOLEAN DEFAULT FALSE,
  votes INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_votes (
  id SERIAL PRIMARY KEY,
  answer_id INTEGER NOT NULL REFERENCES forum_answers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  delta SMALLINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (answer_id, user_id)
);
