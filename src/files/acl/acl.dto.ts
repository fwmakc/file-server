import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class AclGrantDto {
  // Exactly one of accountId | role — enforced in the service (XOR).
  @IsOptional()
  @IsNumber()
  accountId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  role?: string;

  @IsEnum(["read", "write"])
  mode: "read" | "write";
}

// ValidationPipe runs with whitelist + forbidNonWhitelisted: fields without
// decorators are rejected as "should not exist" — every field needs them.
export class SetAclDto {
  // File key or folder path, as returned by the upload response.
  @IsString()
  @MaxLength(1024)
  path: string;

  @IsEnum(["file", "folder"])
  pathType: "file" | "folder";

  @IsOptional()
  @IsEnum(["private", "public"])
  visibility?: "private" | "public";

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AclGrantDto)
  grants?: AclGrantDto[];
}
