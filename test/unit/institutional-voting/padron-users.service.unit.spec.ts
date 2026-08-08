import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { PadronVersion } from '@/modules/institutional-voting/schemas/padron-version.schema';
import { PadronEntry } from '@/modules/institutional-voting/schemas/padron-entry.schema';
import { ComparisonReport } from '@/modules/institutional-voting/schemas/comparison-report.schema';
import { User } from '@/modules/users/schemas/user.schema';

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | PadronUsersService', () => {
  it('PAD-ROW-P0-002 / PAD-SEC-P0-001 | resuelve solo votantes registrados sin crear usuarios por DNI del padrón', async () => {
    const eventId = new Types.ObjectId();
    const versionId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const userModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: userId, dni: '11111', active: true }]),
      }),
      bulkWrite: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PadronUsersService,
        {
          provide: getModelToken(PadronVersion.name),
          useValue: {
            findOne: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue({ _id: versionId }),
            }),
          },
        },
        {
          provide: getModelToken(PadronEntry.name),
          useValue: {
            find: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([
                { carnetNorm: '11111', enabled: true },
                { carnetNorm: '22222', enabled: true },
              ]),
            }),
          },
        },
        {
          provide: getModelToken(ComparisonReport.name),
          useValue: {
            exists: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: getModelToken(User.name),
          useValue: userModel,
        },
      ],
    }).compile();

    const service = moduleRef.get(PadronUsersService);

    const result = await service.getResolvedPadronUsersFomEvent({ _id: eventId } as any);

    expect(userModel.bulkWrite).not.toHaveBeenCalled();
    expect(userModel.find).toHaveBeenCalledWith(
      { dni: { $in: ['11111', '22222'] }, active: true },
      { _id: 1, dni: 1, active: 1 },
    );
    expect(result).toEqual([{ _id: userId, dni: '11111', active: true, enabled: true }]);
  });
});
