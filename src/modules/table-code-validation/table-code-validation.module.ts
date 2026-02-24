import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TableCodeValidation,
  TableCodeValidationSchema,
} from './schemas/table-code-validation.schema';
import { TableCodeValidationService } from './services/table-code-validation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TableCodeValidation.name, schema: TableCodeValidationSchema },
    ]),
  ],
  providers: [TableCodeValidationService],
  exports: [TableCodeValidationService],
})
export class TableCodeValidationModule {}
