import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum RegisterRole {
  CLIENTE = 'CLIENTE',
  ACOMPANANTE = 'ACOMPANANTE',
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(RegisterRole)
  @IsOptional()
  role?: RegisterRole;
}
