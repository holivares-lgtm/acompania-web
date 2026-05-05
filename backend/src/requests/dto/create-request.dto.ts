import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsDateString()
  date: string;

  @IsInt()
  @Min(1)
  duration: number;

  @IsInt()
  @Min(1)
  priceOffer: number;

  @IsString()
  @IsOptional()
  coupon?: string;
}
