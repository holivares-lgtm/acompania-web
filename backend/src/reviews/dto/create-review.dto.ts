import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  appointmentId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  text?: string;

  @IsArray()
  @IsOptional()
  aspects?: string[];
}
