import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ResolveInstitutionalWalletByDniDto {
  @ApiProperty({ example: '12345678' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @Length(5, 20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'dni debe ser alfanumerico' })
  dni!: string;
}
