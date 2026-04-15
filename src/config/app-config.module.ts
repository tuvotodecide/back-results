import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';

export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  load: [appConfig],
  envFilePath: '.env',
  validationOptions: {
    allowUnknown: true,
    abortEarly: true,
  },
});
