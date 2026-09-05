import 'dotenv/config';
import { createServer } from './server.js';

const port = Number(process.env.PORT || 3077);
const host = process.env.HOST || "0.0.0.0";
const server = await createServer();
await server.listen({ port, host });
