import { Module, Global } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Global()
@Module({
  providers: [
    {
      provide: 'FIREBASE_ADMIN',
      useFactory: () => {
        const projectId = process.env.FB_PROJECT_ID;
        const clientEmail = process.env.FB_CLIENT_EMAIL;
        // Importante: reemplazar \n escapados
        const privateKey = (process.env.FB_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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
    },
  ],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
