import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { MerkletreeService } from '../services/merkletree.service';
import { FindElementsAndIndicesDto, MerkleTreeType } from '../dto/find-elements-and-indices.dto';
import { Public } from '@/core/decorators/public.decorator';

@Public()
@Controller('api/v1/merkletree')
export class MerkletreeController {
  constructor(private readonly merkletreeService: MerkletreeService) {}

  @Get('proof')
  async findElementsAndIndicesByLeaf(@Query() query: FindElementsAndIndicesDto) {
    const { electionId, leaf } = query;

    const leafValue = this.merkletreeService.stringToFieldElement(leaf);
    const data = await this.merkletreeService.findElementsAndIndicesByLeaf(
      new Types.ObjectId(electionId),
      leafValue,
    );

    return {
      success: true,
      data,
    };
  }
}
