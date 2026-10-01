export class PresignUploadDto {
  // Original file name — sanitized server-side; the object key itself is
  // server-generated (uuid prefix), the client never picks the key.
  filename: string;

  folder?: string;
}
