import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { buildPoseidon, Poseidon } from 'circomlibjs';
import { InjectModel } from '@nestjs/mongoose';
import { CiMerkleLeaf, CiMerkleLeafDocument } from '../schemas/ci-merkle-leaf.schema';
import { Model, Types } from 'mongoose';
import { CiMerkleNode, CiMerkleNodeDocument } from '../schemas/ci-merkle-node.schema';

@Injectable()
export class MerkletreeService implements OnModuleInit {
  private readonly levels = 20;
  private poseidon!: Poseidon;
  // zeroHashes[i] is the root of an all-zero subtree of depth i.
  private zeroHashes!: bigint[];

  constructor(
    @InjectModel(CiMerkleLeaf.name) private ciMerkleLeafModel: Model<CiMerkleLeafDocument>,
    @InjectModel(CiMerkleNode.name) private ciMerkleNodeModel: Model<CiMerkleNodeDocument>,
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

  hexToFieldElement(hex: string): bigint {
    return BigInt(hex);
  }

  async create(electionId: Types.ObjectId, layers: bigint[][]) {
    const [ leaves, ...nodes ] = layers;

    const leavesToSave = leaves.map((leaf, index) => ({
      electionId,
      index,
      value: this.fieldElementToHex(leaf)
    }));

    const nodesToSave = nodes.flatMap((nodesLevel, level) => {
      return nodesLevel.map((node, index) => ({
        electionId,
        level,
        index,
        hash: this.fieldElementToHex(node)
      }));
    });

    await this.ciMerkleLeafModel.insertMany(leavesToSave);
    await this.ciMerkleNodeModel.insertMany(nodesToSave);
  }

  async createIfMissing(electionId: Types.ObjectId, layers: bigint[][]) {
    if (await this.hasCompleteTree(electionId, layers)) {
      return { created: false };
    }

    try {
      await this.create(electionId, layers);
      return { created: true };
    } catch (error) {
      if (this.isDuplicateKeyError(error) && await this.hasCompleteTree(electionId, layers)) {
        return { created: false };
      }
      throw error;
    }
  }

  private async hasCompleteTree(
    electionId: Types.ObjectId,
    layers: bigint[][],
  ) {
    const expectedLeaves = layers[0]?.length ?? 0;
    const expectedNodes = layers.slice(1).reduce((total, layer) => total + layer.length, 0);
    const [leafCount, nodeCount] = await Promise.all([
      this.ciMerkleLeafModel.countDocuments({ electionId }),
      this.ciMerkleNodeModel.countDocuments({ electionId }),
    ]);
    return leafCount === expectedLeaves && nodeCount === expectedNodes;
  }

  private isDuplicateKeyError(error: any) {
    return error?.code === 11000 || error?.codeName === 'DuplicateKey';
  }

  findElementsAndIndices(leaf: bigint, layers: bigint[][]): { pathElements: bigint[]; pathIndices: number[] } {
    const leafIndex = layers[0].indexOf(leaf);
    if (leafIndex === -1) {
      throw new Error('leaf not found in tree');
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let index = leafIndex;
    for (let level = 0; level < this.levels; level++) {
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;
      const siblingLayer = layers[level];
      const sibling = siblingIndex < siblingLayer.length ? siblingLayer[siblingIndex] : this.zeroHashes[level];

      pathElements.push(sibling);
      pathIndices.push(isRight ? 1 : 0);

      index = Math.floor(index / 2);
    }

    return { pathElements, pathIndices };
  }

  async findElementsAndIndicesByLeaf(
    electionId: Types.ObjectId,
    leaf: bigint,
  ): Promise<{ pathElements: string[]; pathIndices: ('0' | '1')[] }> {
    const leafModel = this.ciMerkleLeafModel;
    const nodeModel = this.ciMerkleNodeModel;

    const leafDoc = await leafModel.findOne({ electionId, value: this.fieldElementToHex(leaf) }).lean();
    if (!leafDoc) {
      throw new NotFoundException('leaf not found in tree');
    }

    // Sibling index/side at each level only depends on the leaf's own index,
    // so the whole path can be computed up front and fetched in parallel
    // instead of awaiting one query per level.
    const steps: { level: number; isRight: boolean; siblingIndex: number }[] = [];
    let index = leafDoc.index;
    for (let level = 0; level < this.levels; level++) {
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;
      steps.push({ level, isRight, siblingIndex });
      index = Math.floor(index / 2);
    }

    const [leafSiblingDoc, nodeSiblingDocs] = await Promise.all([
      leafModel.findOne({ electionId, index: steps[0].siblingIndex }).lean(),
      Promise.all(
        steps
          .slice(1)
          .map(({ level, siblingIndex }) =>
            nodeModel.findOne({ electionId, level: level - 1, index: siblingIndex }).lean(),
          ),
      ),
    ]);

    const pathElements: string[] = [
      leafSiblingDoc ? this.hexToFieldElement(leafSiblingDoc.value) : this.zeroHashes[0],
      ...nodeSiblingDocs.map((doc, i) => (doc ? this.hexToFieldElement(doc.hash) : this.zeroHashes[i + 1])),
    ].map((value) => value.toString());
    const pathIndices: ('0' | '1')[] = steps.map(({ isRight }) => (isRight ? '1' : '0'));

    return { pathElements, pathIndices };
  }

  async isValueInTree(electionId: Types.ObjectId, value: string, root: bigint): Promise<boolean> {
    const leaf = this.stringToFieldElement(value);

    let pathElements: string[];
    let pathIndices: ('0' | '1')[];
    try {
      ({ pathElements, pathIndices } = await this.findElementsAndIndicesByLeaf(electionId, leaf));
    } catch (error) {
      if (error instanceof NotFoundException) {
        return false;
      }
      throw error;
    }

    let node = leaf;
    for (let i = 0; i < pathElements.length; i++) {
      const sibling = BigInt(pathElements[i]);
      node = pathIndices[i] === '1' ? this.hash2(sibling, node) : this.hash2(node, sibling);
    }

    return node === root;
  }
}
