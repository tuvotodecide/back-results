import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Pando', description: 'Nombre del departamento' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDepartmentDto {
  @ApiProperty({
    example: 'Pando',
    description: 'Nombre del departamento',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
