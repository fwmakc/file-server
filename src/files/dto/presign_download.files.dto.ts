export class PresignDownloadDto {
  // Storage key as returned by the upload response (`key` field / URL path
  // below UPLOADS_URL). Sanitized with the same rules as the download route.
  key: string;
}
