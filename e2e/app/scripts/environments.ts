import { fileURLToPath } from 'node:url';
import { destroy } from '@prisma/composer/control';
import prismaConfig from '../prisma.config.ts';

export async function destroyEnvironment(environment: string): Promise<boolean> {
  if (!environment.startsWith('e2e-')) throw new Error(`refusing to destroy "${environment}": not an e2e environment`);
  const result = await destroy({
    environment,
    config: {
      value: prismaConfig.composer,
      file: fileURLToPath(new URL('../prisma.config.ts', import.meta.url)),
    },
  });
  if (!result.ok) {
    console.error(`::error::could not destroy environment ${environment}: ${result.failure.message}`);
    return false;
  }
  console.log(`destroyed environment ${environment}`);
  return true;
}
