import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class AddCurrentPadronVoterDto {
  @ApiProperty({
    description: 'Carnet del nuevo votante que se agregará habilitado durante la votación.',
    example: '1234567LP',
  })
  @IsString()
  @IsNotEmpty()
  @Length(5, 20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'carnet debe ser alfanumerico' })
  carnet!: string;

  @ApiProperty({
    description: 'Debe ser true. Durante votación solo se permite agregar nuevos usuarios habilitados.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
