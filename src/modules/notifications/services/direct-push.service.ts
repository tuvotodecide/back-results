
import { Inject, Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class DirectPushService {
  constructor(
    @Inject('FIREBASE_ADMIN') private readonly fb: typeof admin,
  ) {}

  async sendToTokens(
    tokens: string[],
    notification: { title: string; body: string },
    data: Record<string, string>,
  ) {
    if (!tokens.length) return;

    const base: Omit<admin.messaging.TokenMessage, 'token'> = {
      notification,
      data,
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10' },
      },
    };

    for (const token of tokens) {
      const msg: admin.messaging.TokenMessage = {
        ...base,
        token,
      };
      try {
        await this.fb.messaging().send(msg);
      } catch (e) {
        console.error('FCM error (direct push)', e);
      }
    }
  }
}
