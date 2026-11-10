import { fileURLToPath } from 'node:url';
import { destroy } from '@prisma/composer/control';
import prismaConfig from '../prisma.config.ts';

const environment = process.env.ENVIRONMENT;
if (!environment || environment === 'production') {
  console.error('ENVIRONMENT must name a preview environment');
  process.exit(1);
}

const result = await destroy({
  environment,
  config: {
    value: prismaConfig.composer,
    file: fileURLToPath(new URL('../prisma.config.ts', import.meta.url)),
  },
});
if (!result.ok) {
  console.error(result.failure.message);
  process.exit(1);
}
console.log(`destroyed environment ${environment}`);
