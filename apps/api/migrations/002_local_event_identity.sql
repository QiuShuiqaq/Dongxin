ALTER TABLE dongxin.device_events
  ADD COLUMN event_id text CHECK (event_id IS NULL OR length(event_id) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX device_events_identity_idx
  ON dongxin.device_events (device_id, event_id)
  WHERE event_id IS NOT NULL;
