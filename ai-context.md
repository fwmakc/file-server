# AI Context — file-server

> Auto-generated. Run `npm run ai-context` to regenerate.
> Generated: 2026-10-06T16:15:04.282Z

---

## Controllers

### WebhooksController

Base path: `/webhooks`

| Method | Path |
|--------|------|
| `POST` | `/webhooks/events` |

---

## Services

### AclService

- `sanitizeFolderPath(path): sanitizeRequestPath(path)`
- `resolveAcl(key: string): Promise<FileAclEntity | null>`
- `isPublic(key: string): Promise<boolean>`
- `canRead(key: string, account?: AccountInfo | null): Promise<boolean>`
- `canWrite(key: string, account?: AccountInfo | null): Promise<boolean>`
- `resolveWriteFolder(folder: string,
    account: AccountInfo,): Promise<string>`
- `setAcl(input: AclSetInput, account: AccountInfo): Promise<AclView>`
- `describeMatch(key: string): Promise<AclView | null>`
- `filter((row): row is FileAclEntity => row !== null)
      .sort((a, b) => b.prefix.length - a.prefix.length)[0]`
- `describe(acl): null`
- `purgeAccount(accountId: number | string): Promise<void>`
- `removeTree(key: string): Promise<void>`
- `upsert(prefix: string,
    input: AclSetInput,
    account: AccountInfo,): Promise<FileAclEntity>`
- `grantSubject(grant.accountId): roleSubject(grant.role as string)`
- `describe(row: FileAclEntity): Promise<AclView>`
- `matchGrant(aclId: string,
    account?: AccountInfo | null,
    mode: AclGrantMode = "read",): Promise<boolean>`

### FilesService

- `wire(POST /files/upload without a body): // every switch below must treat that as "no transformations"
    const`
- `pdfGenerate(template: string,
    data: object = {},
    options: object = {},): Promise<any>`

### SubscriberService

- `onApplicationBootstrap(): Promise<void>`
- `register(retry = 0): Promise<void>`
- `httpPost(`${this.eventServerUrl}/subscribe`,
        {
          service: "file-server",
          url: this.webhookUrl,
          patterns: this.patterns,
          active: true,
          // Registration is idempotent (same service+url merges): a fresh
          // secret here re-provisions the stored one, e.g. after rotation.
          ...(this.webhookSecret ?`
- `booting(compose race): retry with
      // exponential backoff instead of dying silently.
      if (retry < 5)`

### WebhooksService

- `handleEvent(event: WebhookEnvelopeDto): Promise<void>`
- `onUserDeleted(em: EntityManager,
    payload: UserDeletedDto,): Promise<void>`

---

## Entities

### FileAclEntity (table: `file_acl`)


### ProcessedEventEntity (table: `webhook_processed_events`)


---

## DTOs

### AclGrantDto

| Field | Type | Optional |
|-------|------|----------|
| `accountId` | `number` | yes |
| `role` | `string` | yes |
| `path` | `string` | no |
| `grants` | `AclGrantDto[]` | yes |

### OptionsFilesDto

| Field | Type | Optional |
|-------|------|----------|
| `convert` | `boolean` | yes |
| `folder` | `string` | yes |
| `rename` | `boolean` | yes |
| `replace` | `boolean` | yes |
| `resize` | `boolean` | yes |

### PresignDownloadDto

| Field | Type | Optional |
|-------|------|----------|
| `key` | `string` | no |

### PresignUploadDto

| Field | Type | Optional |
|-------|------|----------|
| `filename` | `string` | no |
| `folder` | `string` | yes |
