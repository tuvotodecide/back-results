import { PartialType } from '@nestjs/mapped-types';
import { CreateMerkletreeDto } from './create-merkletree.dto';

export class UpdateMerkletreeDto extends PartialType(CreateMerkletreeDto) {
  id: number;
}
