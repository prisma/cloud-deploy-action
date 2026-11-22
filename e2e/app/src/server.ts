import service from './service.ts';

const { environment } = service.input();

Bun.serve({
  port: service.port(),
  hostname: '0.0.0.0',
  fetch: () => Response.json({ environment }),
});
