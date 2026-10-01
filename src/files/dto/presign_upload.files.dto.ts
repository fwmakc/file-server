import { IsOptional, IsString, MaxLength } from "class-validator";

// ValidationPipe runs with whitelist + forbidNonWhitelisted: fields without
// decorators are rejected as "should not exist" — every field needs them.
export class PresignUploadDto {
  // Original file name — sanitized server-side; the object key itself is
  // server-generated (uuid prefix), the client never picks the key.
  @IsString()
  @MaxLength(255)
  filename: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  folder?: string;
}
