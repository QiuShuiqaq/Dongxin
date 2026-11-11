export function limitSetting(name: string, fallback: number, min = 1, max = 1_000_000): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected integer ${min}..${max}`);
  return value;
}

export function decimalSetting(name: string, fallback = 0): number {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}: expected a non-negative number`);
  return value;
}
