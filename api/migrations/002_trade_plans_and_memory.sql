-- Trade Plans: add columns to positions table
ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_thesis TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS price_target NUMERIC;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS stop_loss NUMERIC;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trade_notes TEXT;

-- Agent Memory: persistent cross-session learning
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'insight',
  content TEXT NOT NULL,
  ticker TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_user ON agent_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(user_id, memory_type);
