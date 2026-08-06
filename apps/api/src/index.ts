import 'dotenv/config';
import { createServer } from './server.js';

const port = Number(process.env.PORT || 3001);
const server = await createServer();
await server.listen({ port, host: '127.0.0.1' });
