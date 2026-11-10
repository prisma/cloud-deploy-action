import { appRoot, resolve } from '@prisma/composer';
import { publicUrl } from '@prisma/composer-prisma-cloud';
import echoService from './src/service.ts';

export default appRoot('cloud-deploy-action-e2e', ({ environment, provision }) => {
  const echo = provision(echoService, {
    input: { environment: resolve([environment.name], ([name]) => name) },
  });
  provision(publicUrl({ id: 'site', url: publicUrl.prismaBuild(), target: echo.http }));
});
