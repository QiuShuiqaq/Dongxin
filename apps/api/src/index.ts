import 'dotenv/config';
import { createServer } from './server.js';

const port = Number(process.env.PORT || 3077);
const host = process.env.HOST || "0.0.0.0";
const server = await createServer();
await server.listen({ port, host });

let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    server.log.info({ signal }, 'Stopping API; waiting for active requests');
    const deadline = setTimeout(() => process.exit(1), 25_000);
    deadline.unref();
    try {
      await server.close();
      clearTimeout(deadline);
      process.exit(0);
    } catch (error) {
      server.log.error(error, 'API shutdown failed');
      process.exit(1);
    }
  });
}
