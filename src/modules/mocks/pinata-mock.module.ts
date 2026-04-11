import { Module } from '@nestjs/common';
import {
  PinataDataMockController,
  PinataMockController,
} from './controllers/pinata-mock.controller';

@Module({
  controllers: [PinataMockController, PinataDataMockController],
})
export class PinataMockModule {}
