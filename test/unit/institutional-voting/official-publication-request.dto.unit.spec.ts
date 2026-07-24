import { validate } from 'class-validator';
import {
  OfficialPublicationClaimDto,
  OfficialPublicationRejectDto,
  OfficialPublicationSubmissionDto,
} from '@/modules/institutional-voting/dto/official-publication-request.dto';

describe('Official publication request DTOs', () => {
  it('rechaza deviceId vacio o excesivo', async () => {
    const empty = Object.assign(new OfficialPublicationClaimDto(), {
      deviceId: '   ',
    });
    const tooLong = Object.assign(new OfficialPublicationClaimDto(), {
      deviceId: 'a'.repeat(129),
    });

    expect(await validate(empty)).not.toHaveLength(0);
    expect(await validate(tooLong)).not.toHaveLength(0);
  });

  it('valida hash de 32 bytes y txHash opcional en submission', async () => {
    const valid = Object.assign(new OfficialPublicationSubmissionDto(), {
      deviceId: 'device-1',
      userOpHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const invalid = Object.assign(new OfficialPublicationSubmissionDto(), {
      deviceId: 'device-1',
      userOpHash: '0xabc',
      txHash: '0x123',
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('rechaza reasonCode fuera del enum seguro', async () => {
    const dto = Object.assign(new OfficialPublicationRejectDto(), {
      deviceId: 'device-1',
      reasonCode: 'STACK_TRACE_FROM_CLIENT',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
