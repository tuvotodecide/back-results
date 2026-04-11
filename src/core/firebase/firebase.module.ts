import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'FIREBASE_ADMIN',
      useFactory: (configService: ConfigService) => {
        const projectId = configService.get<string>('app.firebase.projectId');
        const clientEmail = configService.get<string>('app.firebase.clientEmail');
        const privateKey = configService.get<string>('app.firebase.privateKey');

        if (!projectId || !clientEmail || !privateKey) {
          throw new Error('Firebase Admin env vars missing (FB_PROJECT_ID/FB_CLIENT_EMAIL/FB_PRIVATE_KEY)');
        }

        if (admin.apps.length === 0) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });
        }
        return admin;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
