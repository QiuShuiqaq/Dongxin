CREATE INDEX device_commands_device_time_idx
  ON dongxin.device_commands (device_id, created_at DESC, id DESC);

CREATE INDEX device_commands_delivery_idx
  ON dongxin.device_commands (created_at ASC, id ASC)
  WHERE status = 'QUEUED' AND COALESCE(slots->>'delivery', '') <> 'direct-response';
