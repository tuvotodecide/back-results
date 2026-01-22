import { Public } from '@/core/decorators/public.decorator';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Pinning Mock')
@Controller('api/v1/pinning')
export class PinataMockController {
  @Post('pinFileToIPFS')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mock Pinata pinFileToIPFS response' })
  pinFileToIPFS() {
    return {
      IpfsHash: 'QmRyCiEE3d9CXdktBfPnXKSi48Bw8X8f5WTUJzx8h7VP43',
      PinSize: 123456,
      Timestamp: new Date().toISOString(),
      isDuplicate: false,
    };
  }

  @Post('pinJSONToIPFS')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mock Pinata pinJSONToIPFS response' })
  pinJSONToIPFS() {
    return {
      IpfsHash: 'QmdSRDscgSYaDCAeeCPMjLrfG15XdTKJC8MwioSq9t8f5B',
      PinSize: 9876,
      Timestamp: new Date().toISOString(),
      isDuplicate: false,
    };
  }
}

@ApiTags('Pinning Mock')
@Controller('api/v1/data')
export class PinataDataMockController {
  @Get('pinList')
  @Public()
  @ApiOperation({ summary: 'Mock Pinata pinList response' })
  pinList(@Query('hashContains') hashContains: string) {
    const ipfsPinHash = hashContains.trim();

    return {
      count: 1,
      rows: [
        {
          id: 'mock-pin-1',
          ipfs_pin_hash: ipfsPinHash,
          size: 123456,
          user_id: 'mock-user',
          date_pinned: new Date().toISOString(),
          date_unpinned: null,
          metadata: {
            name: 'mock.json',
            keyvalues: {},
          },
          regions: [],
        },
      ],
    };
  }
}
