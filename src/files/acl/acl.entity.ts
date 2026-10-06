import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type AclVisibility = "private" | "public";
export type AclGrantMode = "read" | "write";

/**
 * Shared-path rule: an exact file key or a folder prefix (trailing slash).
 * A folder rule covers every key under it; the longest matching rule wins.
 * Direct TypeORM decorators (not the toolkit column set): the key columns
 * must be NOT NULL and the indexes explicitly named so the migration and
 * the entity agree byte-for-byte (same pattern as event-server audit and
 * the webhook ledger).
 */
@Entity("file_acl")
@Index("uq_file_acl_prefix", ["prefix"], { unique: true })
export class FileAclEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id: string;

  @Column({ name: "prefix", type: "varchar", length: 1024 })
  prefix: string;

  @Column({
    name: "visibility",
    type: "enum",
    enum: ["private", "public"],
    enumName: "file_acl_visibility",
    default: "private",
  })
  visibility: AclVisibility;

  // Creator — a non-staff account may edit only rules on its own namespace.
  @Column({ name: "account_id", type: "bigint" })
  accountId: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

/** "u:<accountId>" for an account grant, "r:<role>" for a role grant. */
export const grantSubject = (accountId: number | string): string =>
  `u:${accountId}`;

export const roleSubject = (role: string): string => `r:${role}`;

export const subjectAccountId = (subject: string): number | null =>
  subject.startsWith("u:") ? Number(subject.slice(2)) : null;

@Entity("file_acl_grants")
@Index("uq_file_acl_grants_subject", ["aclId", "subject"], { unique: true })
export class FileAclGrantEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id: string;

  @Column({ name: "acl_id", type: "bigint" })
  aclId: string;

  @Column({ name: "subject", type: "varchar", length: 255 })
  subject: string;

  @Column({
    name: "mode",
    type: "enum",
    enum: ["read", "write"],
    enumName: "file_acl_grant_mode",
  })
  mode: AclGrantMode;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
