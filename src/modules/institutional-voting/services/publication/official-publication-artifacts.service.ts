import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { Model, Types } from 'mongoose';
import { PreparedVotePublication } from '../core/vote-writter.service';
import {
  OfficialPublicationArtifact,
  OfficialPublicationArtifactDocument,
} from '../../schemas/official-publication-artifact.schema';

export type PreparedPublicationArtifactPayload = {
  voters: string[];
  dids: { dni: string; did: string }[];
  preparedVote: SerializedPreparedVotePublication;
  credentialData?: Record<string, { credentialData: string }>;
};

export type SerializedPreparedVotePublication = {
  secrets: string[];
  ciMerkleTree: { root: string; layers: string[][] };
  optionsWithBlank: string[];
  callData: {
    to: string;
    value: string;
    data: `0x${string}`;
  };
  createVoteArgs: unknown[];
  onChainElectionId: string;
};

@Injectable()
export class OfficialPublicationArtifactsService implements OnModuleInit {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyVersion = 'v1';

  constructor(
    @InjectModel(OfficialPublicationArtifact.name)
    private readonly artifactModel: Model<OfficialPublicationArtifactDocument>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.assertEncryptionKeyConfigured();
  }

  async saveArtifact(input: {
    requestId: string;
    eventId: Types.ObjectId | string;
    tenantId: Types.ObjectId | string;
    institutionId: string;
    snapshotHash: string;
    voters: string[];
    dids: { dni: string; did: string }[];
    preparedVote: PreparedVotePublication;
  }) {
    const payload: PreparedPublicationArtifactPayload = {
      voters: input.voters,
      dids: input.dids,
      preparedVote: this.serializePreparedVote(input.preparedVote),
    };
    const encryptedPayload = this.encrypt(payload);
    const payloadDigest = this.digest(JSON.stringify(payload));
    const votersDigest = this.digest(input.voters.join('|'));

    try {
      return await this.artifactModel.findOneAndUpdate(
        { requestId: input.requestId },
        {
          $setOnInsert: {
            requestId: input.requestId,
            eventId: this.toObjectId(input.eventId),
            tenantId: this.toObjectId(input.tenantId),
            institutionId: input.institutionId,
            snapshotHash: input.snapshotHash,
            votersCount: input.voters.length,
            votersDigest,
            encryptedPayload,
            payloadDigest,
          },
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const artifact = await this.artifactModel.findOne({ requestId: input.requestId });
        if (artifact) return artifact;
      }
      throw error;
    }
  }

  async loadArtifactPayload(requestId: string) {
    const artifact = await this.artifactModel.findOne({ requestId });
    if (!artifact) {
      throw new NotFoundException({
        code: 'OFFICIAL_PUBLICATION_ARTIFACT_NOT_FOUND',
        message: 'Artefactos preparados no encontrados para la solicitud',
      });
    }

    const payload = this.decrypt(artifact.encryptedPayload) as PreparedPublicationArtifactPayload;
    const payloadDigest = this.digest(JSON.stringify(payload));
    if (payloadDigest !== artifact.payloadDigest) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_ARTIFACT_DIGEST_MISMATCH',
        message: 'Los artefactos preparados no coinciden con la solicitud',
      });
    }
    return { artifact, payload };
  }

  async saveCredentialData(
    requestId: string,
    credentialData: Record<string, { credentialData: string }>,
  ) {
    const { payload } = await this.loadArtifactPayload(requestId);
    const nextPayload: PreparedPublicationArtifactPayload = {
      ...payload,
      credentialData,
    };
    const encryptedPayload = this.encrypt(nextPayload);
    const payloadDigest = this.digest(JSON.stringify(nextPayload));
    return this.artifactModel.findOneAndUpdate(
      { requestId },
      {
        $set: {
          encryptedPayload,
          payloadDigest,
        },
      },
      { new: true },
    );
  }

  deserializePreparedVote(
    preparedVote: SerializedPreparedVotePublication,
  ): PreparedVotePublication {
    return {
      secrets: [...preparedVote.secrets],
      ciMerkleTree: {
        root: BigInt(preparedVote.ciMerkleTree.root),
        layers: preparedVote.ciMerkleTree.layers.map((layer) =>
          layer.map((item) => BigInt(item)),
        ),
      },
      optionsWithBlank: [...preparedVote.optionsWithBlank],
      callData: {
        to: preparedVote.callData.to,
        value: BigInt(preparedVote.callData.value),
        data: preparedVote.callData.data,
      },
      createVoteArgs: preparedVote.createVoteArgs,
      onChainElectionId: BigInt(preparedVote.onChainElectionId),
    };
  }

  private serializePreparedVote(
    preparedVote: PreparedVotePublication,
  ): SerializedPreparedVotePublication {
    return {
      secrets: [...preparedVote.secrets],
      ciMerkleTree: {
        root: preparedVote.ciMerkleTree.root.toString(),
        layers: preparedVote.ciMerkleTree.layers.map((layer) =>
          layer.map((item) => item.toString()),
        ),
      },
      optionsWithBlank: [...preparedVote.optionsWithBlank],
      callData: {
        to: preparedVote.callData.to,
        value: preparedVote.callData.value.toString(),
        data: preparedVote.callData.data,
      },
      createVoteArgs: this.serializeUnknown(preparedVote.createVoteArgs) as unknown[],
      onChainElectionId: preparedVote.onChainElectionId.toString(),
    };
  }

  private serializeUnknown(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map((item) => this.serializeUnknown(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.serializeUnknown(item)]),
      );
    }
    return value;
  }

  private encrypt(payload: PreparedPublicationArtifactPayload) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.getKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      algorithm: this.algorithm,
      keyVersion: this.keyVersion,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(encryptedPayload: {
    algorithm: string;
    iv: string;
    authTag: string;
    ciphertext: string;
  }) {
    if (encryptedPayload.algorithm !== this.algorithm) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_ARTIFACT_ALGORITHM_UNSUPPORTED',
        message: 'El cifrado de artefactos preparados no es compatible',
      });
    }
    try {
      const decipher = createDecipheriv(
        this.algorithm,
        this.getKey(),
        Buffer.from(encryptedPayload.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(encryptedPayload.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encryptedPayload.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_ARTIFACT_DECRYPTION_FAILED',
        message: 'No se pudieron descifrar los artefactos preparados',
      });
    }
  }

  private getKey() {
    this.assertEncryptionKeyConfigured();
    const configured =
      this.configService.get<string>('app.officialPublicationArtifactEncryptionKey') ||
      process.env.OFFICIAL_PUBLICATION_ARTIFACT_ENCRYPTION_KEY;
    return createHash('sha256').update(configured!.trim()).digest();
  }

  private assertEncryptionKeyConfigured() {
    const configured =
      this.configService.get<string>('app.officialPublicationArtifactEncryptionKey') ||
      process.env.OFFICIAL_PUBLICATION_ARTIFACT_ENCRYPTION_KEY;
    if (configured?.trim()) return;
    const error = new Error('OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING');
    (error as any).code = 'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING';
    throw error;
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private toObjectId(value: Types.ObjectId | string) {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }

  private isDuplicateKeyError(error: any) {
    return error?.code === 11000 || error?.codeName === 'DuplicateKey';
  }
}
