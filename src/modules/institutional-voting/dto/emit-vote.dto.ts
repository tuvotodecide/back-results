import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsString,
  isNumberString,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

function IsNumericStringMatrix(
  outerSize: number,
  innerSize: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNumericStringMatrix',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            Array.isArray(value) &&
            value.length === outerSize &&
            value.every(
              (row) =>
                Array.isArray(row) &&
                row.length === innerSize &&
                row.every((v) => typeof v === 'string' && isNumberString(v)),
            )
          );
        },
        defaultMessage() {
          return `${propertyName} debe ser un arreglo de ${outerSize} sub-arreglos de ${innerSize} strings numéricos`;
        },
      },
    });
  };
}

export class EmitVoteDto {
  @ApiProperty({ example: 'blank', description: 'ID de la opción de votación (o "blank" para voto en blanco)' })
  @IsString()
  @IsNotEmpty()
  optionId!: string;

  @ApiProperty({ example: '12345678901234567890', description: 'Nullifier del voto (numérico en string)' })
  @IsNumberString()
  voteNullfier!: string;

  @ApiProperty({ example: '12345678901234567890', description: 'Hash de recompensa (numérico en string)' })
  @IsNumberString()
  rewardHash!: string;

  @ApiProperty({
    type: [String],
    example: ['12345678901234567890', '98765432109876543210'],
    description: 'Componente A de la prueba ZK: arreglo de 2 valores numéricos en string',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumberString({}, { each: true })
  pia!: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
    example: [
      ['12345678901234567890', '98765432109876543210'],
      ['11223344556677889900', '99887766554433221100'],
    ],
    description: 'Componente B de la prueba ZK: arreglo de 2 sub-arreglos de 2 valores numéricos en string ([2][2])',
  })
  @IsNumericStringMatrix(2, 2, {
    message: 'pib debe ser un arreglo [2][2] de strings numéricos',
  })
  pib!: string[][];

  @ApiProperty({
    type: [String],
    example: ['12345678901234567890', '98765432109876543210'],
    description: 'Componente C de la prueba ZK: arreglo de 2 valores numéricos en string',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumberString({}, { each: true })
  pic!: string[];
}
