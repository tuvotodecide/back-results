import { Injectable, OnModuleInit } from '@nestjs/common';
import { UpdateMerkletreeDto } from '../dto/update-merkletree.dto';
import { buildPoseidon, Poseidon } from 'circomlibjs';
import { InjectModel } from '@nestjs/mongoose';
import { CiMerkleLeaf, CiMerkleLeafDocument } from '../schemas/ci-merkle-leaf.schema';
import { Model, Types } from 'mongoose';
import { CiMerkleNode, CiMerkleNodeDocument } from '../schemas/ci-merkle-node.schema';
import { VoteMerkleLeaf, VoteMerkleLeafDocument } from '../schemas/vote-merkle-leaf.schema';
import { VoteMerkleNode, VoteMerkleNodeDocument } from '../schemas/vote-merkle-node.schema';

@Injectable()
export class MerkletreeService implements OnModuleInit {
  private readonly levels = 20;
  private poseidon!: Poseidon;
  // zeroHashes[i] is the root of an all-zero subtree of depth i.
  private zeroHashes!: bigint[];

  constructor(
    @InjectModel(CiMerkleLeaf.name) private ciMerkleLeafModel: Model<CiMerkleLeafDocument>,
    @InjectModel(CiMerkleNode.name) private ciMerkleNodeModel: Model<CiMerkleNodeDocument>,
    @InjectModel(VoteMerkleLeaf.name) private voteMerkleLeafModel: Model<VoteMerkleLeafDocument>,
    @InjectModel(VoteMerkleNode.name) private voteMerkleNodeModel: Model<VoteMerkleNodeDocument>,
  ) {}

  async onModuleInit() {
    this.poseidon = await buildPoseidon();
    this.zeroHashes = this.computeZeroHashes();
  }

  private hash2(a: bigint, b: bigint): bigint {
    return this.poseidon.F.toObject(this.poseidon([a, b])) as bigint;
  }

  private computeZeroHashes(): bigint[] {
    const zeros: bigint[] = [0n];
    for (let level = 0; level < this.levels; level++) {
      zeros.push(this.hash2(zeros[level], zeros[level]));
    }
    return zeros;
  }

  async buildMerkleTree(leaves: bigint[]) {
    const capacity = 1 << this.levels;
    if (leaves.length > capacity) {
      throw new Error(`depth ${this.levels} supports at most ${capacity} leaves`);
    }

    const layer0 = leaves;

    // Only hash the real nodes at each level, using the precomputed zero
    // hash for a missing right sibling instead of materializing a padded,
    // full-width array of 2^levels leaves.
    const layers: bigint[][] = [layer0];
    for (let level = 0; level < this.levels; level++) {
      const cur = layers[level];
      const zero = this.zeroHashes[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const right = i + 1 < cur.length ? cur[i + 1] : zero;
        next.push(this.hash2(cur[i], right)); // hash(left, right)
      }
      layers.push(next);
    }

    const root = layers[this.levels][0];
    return { root, layers };
  }

  stringToFieldElement(value: string): bigint {
    return BigInt(`0x${Buffer.from(value, 'utf8').toString('hex')}`);
  }

  fieldElementToHex(value: bigint): string {
    return `0x${value.toString(16)}`;
  }

  async create(electionId: Types.ObjectId, type: 'ci' | 'vote', layers: bigint[][]) {
    const [ leaves, ...nodes ] = layers;

    const leavesToSave = leaves.map((leaf, index) => ({
      electionId,
      index,
      value: this.fieldElementToHex(leaf)
    }));

    const nodesToSave = nodes.map((nodesLevel, level) => {
      return nodesLevel.map((node, index) => ({
        electionId,
        level,
        index,
        hash: this.fieldElementToHex(node)
      }));
    });

    if (type === 'ci') {
      await this.ciMerkleLeafModel.insertMany(leavesToSave);
      await this.ciMerkleNodeModel.insertMany(nodesToSave);
    } else {
      await this.voteMerkleLeafModel.insertMany(leavesToSave);
      await this.voteMerkleNodeModel.insertMany(nodesToSave);
    }
  }

  findAll() {
    return `This action returns all merkletree`;
  }

  findOne(id: number) {
    return `This action returns a #${id} merkletree`;
  }

  update(id: number, updateMerkletreeDto: UpdateMerkletreeDto) {
    return `This action updates a #${id} merkletree`;
  }

  remove(id: number) {
    return `This action removes a #${id} merkletree`;
  }
}
