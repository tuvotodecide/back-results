import { Module } from '@nestjs/common';
import { OracleListenerService } from './oracleListener.service';

@Module({
  providers: [OracleListenerService],
})
export class OracleModule {}
