// Read-only pilot probe through the local SSH tunnel. It does not test AI capacity.
const target = new URL(process.argv[2] ?? 'http://127.0.0.1:8080/api/health');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.pathname !== '/api/health') {
  throw new Error('Probe only the loopback /api/health endpoint');
}

const count = 10;
const samples = await Promise.all(Array.from({ length: count }, async () => {
  const started = performance.now();
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return { status: response.status, ok: response.ok && body.ok === true,
      elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { status: null, ok: false, elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error) };
  }
}));
const times = samples.map((item) => item.elapsedMs).sort((a, b) => a - b);
console.log(JSON.stringify({
  observedAt: new Date().toISOString(), target: target.toString(),
  requestCount: count, succeeded: samples.filter((item) => item.ok).length,
  minMs: times[0], medianMs: times[Math.floor(count / 2)],
  p95Ms: times[Math.ceil(count * 0.95) - 1], maxMs: times[count - 1],
  samples,
}, null, 2));
if (samples.some((item) => !item.ok)) process.exitCode = 1;
