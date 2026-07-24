import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OfficialPublicationArtifactsService } from '@/modules/institutional-voting/services/publication/official-publication-artifacts.service';

class InMemoryArtifactModel {
  docs: any[] = [];

  async findOne(filter: any) {
    return this.docs.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) ?? null;
  }

  async findOneAndUpdate(filter: any, update: any, options?: any) {
    let doc = await this.findOne(filter);
    if (!doc && options?.upsert) {
      doc = { ...filter, ...(update.$setOnInsert ?? {}) };
      this.docs.push(doc);
      return doc;
    }
    if (!doc) return null;
    Object.assign(doc, update.$set ?? {});
    return doc;
  }
}

describe('OfficialPublicationArtifactsService', () => {
  const eventId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const preparedVote = {
    secrets: ['0x01'],
    ciMerkleTree: { root: 1n, layers: [[1n]] },
    voteMerkleTree: { root: 2n, layers: [[2n]] },
    optionsWithBlank: ['A', 'BLANK'],
    callData: { to: '0x7B57eE9103fc46eD6794329C36D2919293F0Fabb', value: 0n, data: '0x1234' },
    createVoteArgs: [1n, 'institution'],
    onChainElectionId: 123n,
  };

  function service(model: InMemoryArtifactModel, key?: string) {
    return new OfficialPublicationArtifactsService(
      model as any,
      { get: jest.fn(() => key) } as any,
    );
  }

  async function createArtifact(model = new InMemoryArtifactModel()) {
    const sut = service(model, 'checkpoint-secret');
    await sut.saveArtifact({
      requestId: 'request-1',
      eventId,
      tenantId,
      institutionId: 'institution-1',
      snapshotHash: 'snapshot-1',
      voters: ['1001'],
      dids: [{ dni: '1001', did: 'did:1' }],
      preparedVote: preparedVote as any,
    });
    return { model, sut };
  }

  it('cifra, persiste y una nueva instancia descifra tras reinicio', async () => {
    const { model } = await createArtifact();
    const restarted = service(model, 'checkpoint-secret');

    const { payload } = await restarted.loadArtifactPayload('request-1');

    expect(payload.voters).toEqual(['1001']);
    expect(payload.dids).toEqual([{ dni: '1001', did: 'did:1' }]);
    expect(payload.preparedVote.secrets).toEqual(['0x01']);
    expect(model.docs[0].encryptedPayload.algorithm).toBe('aes-256-gcm');
    expect(model.docs[0].encryptedPayload.iv).toEqual(expect.any(String));
    expect(model.docs[0].encryptedPayload.authTag).toEqual(expect.any(String));
    expect(model.docs[0].encryptedPayload.ciphertext).not.toContain('1001');
  });

  it('falla con clave incorrecta o configuracion ausente', async () => {
    const { model } = await createArtifact();

    await expect(
      service(model, 'wrong-secret').loadArtifactPayload('request-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service(model, '').loadArtifactPayload('request-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('falla si authTag, ciphertext o iv son alterados', async () => {
    for (const field of ['authTag', 'ciphertext', 'iv']) {
      const { model } = await createArtifact();
      model.docs[0].encryptedPayload[field] = Buffer.from(`tampered-${field}`).toString('base64');

      await expect(
        service(model, 'checkpoint-secret').loadArtifactPayload('request-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    }
  });
});
