import { destroyEnvironment } from './environments.ts';

if (!(await destroyEnvironment(process.env.ENVIRONMENT ?? ''))) process.exit(1);
