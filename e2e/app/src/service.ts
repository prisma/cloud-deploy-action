import { rawHttpContract } from '@prisma/composer/http';
import node from '@prisma/composer/node';
import { compute } from '@prisma/composer-prisma-cloud';
import { type } from 'arktype';

export default compute({
  name: 'echo',
  deps: {},
  expose: { http: rawHttpContract },
  input: type({ environment: 'string' }),
  build: node({ module: import.meta.url, dir: '../dist/server', entry: 'server.js' }),
});
