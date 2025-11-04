import { IsArray, IsString, IsObject, ArrayNotEmpty } from 'class-validator';

export class DirectPushDto {
  @IsArray()
  @ArrayNotEmpty()
  tokens!: string[]; // tokens FCM específicos de esta app

  @IsObject()
  notification!: { title: string; body: string };

  @IsObject()
  data!: Record<string, string>;
}
