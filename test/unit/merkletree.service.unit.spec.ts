import { Types } from 'mongoose';
import { MerkletreeService } from '@/modules/merkletree/services/merkletree.service';

class MemoryMerkleModel {
  docs: any[] = [];
  failDuplicate = false;

  async countDocuments(filter: any) {
    return this.docs.filter((doc) => String(doc.electionId) === String(filter.electionId)).length;
  }

  async insertMany(docs: any[]) {
    if (this.failDuplicate) {
      this.failDuplicate = false;
      throw { code: 11000 };
    }
    this.docs.push(...docs);
  }
}

describe('MerkletreeService createIfMissing', () => {
  let ciLeaf: MemoryMerkleModel;
  let ciNode: MemoryMerkleModel;
  let service: MerkletreeService;
  const electionId = new Types.ObjectId();
  const layers = [[1n, 2n], [3n]];

  beforeEach(() => {
    ciLeaf = new MemoryMerkleModel();
    ciNode = new MemoryMerkleModel();
    service = new MerkletreeService(
      ciLeaf as any,
      ciNode as any,
      new MemoryMerkleModel() as any,
      new MemoryMerkleModel() as any,
    );
  });

  it('no reinserta un arbol completo ya persistido', async () => {
    ciLeaf.docs = [{ electionId }, { electionId }];
    ciNode.docs = [{ electionId }];

    await expect(service.createIfMissing(electionId, 'ci', layers)).resolves.toEqual({
      created: false,
    });
    expect(ciLeaf.docs).toHaveLength(2);
    expect(ciNode.docs).toHaveLength(1);
  });

  it('trata E11000 como idempotente cuando el arbol quedo completo', async () => {
    ciLeaf.failDuplicate = true;
    ciLeaf.docs = [{ electionId }, { electionId }];
    ciNode.docs = [{ electionId }];

    await expect(service.createIfMissing(electionId, 'ci', layers)).resolves.toEqual({
      created: false,
    });
  });
});
