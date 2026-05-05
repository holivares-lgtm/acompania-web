import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  pricePerHour?: number;

  @IsInt()
  @IsOptional()
  priceMin?: number;

  @IsString()
  @IsOptional()
  location?: string;

  @IsArray()
  @IsOptional()
  zones?: string[];

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsArray()
  @IsOptional()
  services?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
