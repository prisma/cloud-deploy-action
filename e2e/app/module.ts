import { appRoot, resolve } from '@prisma/composer';
import { publicUrl } from '@prisma/composer-prisma-cloud';
import { APP_NAME } from './app-name.ts';
import echoService from './src/service.ts';

export default appRoot(APP_NAME, ({ environment, provision }) => {
  const echo = provision(echoService, {
    input: { environment: resolve([environment.name], ([name]) => name) },
  });
  provision(publicUrl({ id: 'site', url: publicUrl.prismaBuild(), target: echo.http }));
});
