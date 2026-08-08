ALTER TABLE calendar_events ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_events ADD COLUMN is_teams INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_events ADD COLUMN transaction_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_transaction_id
ON calendar_events(transaction_id)
WHERE transaction_id IS NOT NULL AND transaction_id <> '';
