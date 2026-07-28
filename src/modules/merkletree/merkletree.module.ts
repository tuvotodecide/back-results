import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MerkletreeService } from './services/merkletree.service';
import { MerkletreeController } from './controllers/merkletree.controller';
import { CiMerkleLeaf, CiMerkleLeafSchema } from './schemas/ci-merkle-leaf.schema';
import { CiMerkleNode, CiMerkleNodeSchema } from './schemas/ci-merkle-node.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CiMerkleLeaf.name, schema: CiMerkleLeafSchema },
      { name: CiMerkleNode.name, schema: CiMerkleNodeSchema },
    ]),
  ],
  controllers: [MerkletreeController],
  providers: [MerkletreeService],
  exports: [MerkletreeService],
})
export class MerkletreeModule {}
