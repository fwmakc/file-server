import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AccountInfo,
  rolesOf,
} from "api-server-toolkit";
import { AuthClientService } from "api-server-toolkit/auth-client";
import { sanitizeFolderPath } from "../storage/storage.utils";
import { sanitizeRequestPath } from "../storage/storage.utils";
import {
  AclGrantMode,
  AclVisibility,
  FileAclEntity,
  FileAclGrantEntity,
  grantSubject,
  roleSubject,
  subjectAccountId,
} from "./acl.entity";

/** Staff bypass: roles from the enriched account (auth internal info). */
export const STAFF_ROLES = ["admin", "editor"];

export const isStaff = (account?: AccountInfo | null): boolean => {
  if (!account) return false;
  if (account.isSuperuser) return true;
  const roles = rolesOf(account);
  return STAFF_ROLES.some((role) => roles.includes(role));
};

/** Own namespace: the key is the account root or lives under it. */
export const isOwnPath = (
  key: string,
  accountId: number | string | undefined,
): boolean =>
  accountId !== undefined &&
  accountId !== null &&
  String(accountId) !== "undefined" &&
  (key === String(accountId) || key.startsWith(`${accountId}/`));

/**
 * Canonical ACL path: folder rules share the alphabet of the keys actually
 * written (sanitizeFolderPath — write path, resolveWriteFolder); file rules
 * mirror the exact storage key. Folders keep a trailing slash so a folder
 * rule can never collide with a file of the same name.
 */
export const canonicalAclPath = (
  path: string,
  pathType: "file" | "folder",
): string => {
  const clean =
    pathType === "folder"
      ? sanitizeFolderPath(path)
      : sanitizeRequestPath(path);
  if (!clean) return "";
  return pathType === "folder" ? `${clean}/` : clean;
};

export interface AclGrantInput {
  accountId?: number;
  role?: string;
  mode: AclGrantMode;
}

export interface AclSetInput {
  path: string;
  pathType: "file" | "folder";
  visibility?: AclVisibility;
  grants?: AclGrantInput[];
}

export interface AclView {
  path: string;
  pathType: "file" | "folder";
  visibility: AclVisibility;
  accountId: string;
  grants: Array<{ accountId?: number; role?: string; mode: AclGrantMode }>;
}

/**
 * File-server owns its authorization: keys live under the uploader's
 * namespace by default, and sharing is expressed as ACL rules (visibility
 * + read/write grants per exact file or folder prefix) enforced at the
 * same edge that serves the bytes. Ownership/sharing is file-domain data —
 * no other service is consulted except auth-server for account existence
 * (grant validation) and roles (already part of the enriched account).
 */
@Injectable()
export class AclService {
  constructor(
    @InjectRepository(FileAclEntity)
    private readonly acls: Repository<FileAclEntity>,
    @InjectRepository(FileAclGrantEntity)
    private readonly grants: Repository<FileAclGrantEntity>,
    private readonly authClient: AuthClientService,
  ) {}

  /**
   * Longest-prefix resolution. A rule can only match at the exact file key
   * or at one of the key's ancestor folder prefixes, so a bounded IN query
   * over those candidates — served by the unique prefix index — answers in
   * O(key depth) index lookups regardless of the rule count (isPublic runs
   * on every anonymous download, so the hot path must not scan the table).
   */
  async resolveAcl(key: string): Promise<FileAclEntity | null> {
    const segments = key.split("/");
    const candidates = [key, `${key}/`];
    for (let i = 1; i < segments.length; i++) {
      candidates.push(`${segments.slice(0, i).join("/")}/`);
    }
    const rows = await this.acls
      .createQueryBuilder("acl")
      .where("acl.prefix IN (:...candidates)", { candidates })
      .orderBy("LENGTH(acl.prefix)", "DESC")
      .limit(1)
      .getMany();
    return rows[0] ?? null;
  }

  /** Anonymous read: no JWT required, served straight from the edge. */
  async isPublic(key: string): Promise<boolean> {
    const acl = await this.resolveAcl(key);
    return acl?.visibility === "public";
  }

  async canRead(key: string, account?: AccountInfo | null): Promise<boolean> {
    if (isStaff(account)) return true;
    if (isOwnPath(key, account?.id)) return true;
    const acl = await this.resolveAcl(key);
    if (!acl) return false;
    if (acl.visibility === "public") return true;
    return this.matchGrant(acl.id, account, "read");
  }

  async canWrite(key: string, account?: AccountInfo | null): Promise<boolean> {
    if (isStaff(account)) return true;
    if (isOwnPath(key, account?.id)) return true;
    const acl = await this.resolveAcl(key);
    if (!acl) return false;
    return this.matchGrant(acl.id, account, "write");
  }

  /**
   * Upload target folder: empty → the account's own root; a folder inside
   * the account's namespace passes as-is; anything else requires a write
   * grant on the (enclosing) folder rule or staff. The key stays under the
   * shared prefix — it is never re-rooted into the uploader's namespace.
   */
  async resolveWriteFolder(
    folder: string,
    account: AccountInfo,
  ): Promise<string> {
    const clean = sanitizeFolderPath(folder);
    if (!clean || isOwnPath(clean, account.id)) {
      return clean || String(account.id);
    }
    if (isStaff(account)) return clean;
    const acl = await this.resolveAcl(`${clean}/`);
    if (acl && (await this.matchGrant(acl.id, account, "write"))) {
      return clean;
    }
    throw new ForbiddenException();
  }

  /** Create or update a rule; grants are replaced wholesale when passed. */
  async setAcl(input: AclSetInput, account: AccountInfo): Promise<AclView> {
    const prefix = canonicalAclPath(input.path, input.pathType);
    if (!prefix) {
      throw new BadRequestException("path is required");
    }
    if (!isStaff(account) && !isOwnPath(prefix, account.id)) {
      throw new ForbiddenException();
    }

    const wanted = input.grants ?? [];
    for (const grant of wanted) {
      if (
        (grant.accountId === undefined) === (grant.role === undefined)
      ) {
        throw new BadRequestException(
          "grant needs exactly one of accountId or role",
        );
      }
    }
    // Grant targets must exist (auth internal info, 404-masked → null).
    const unknown: number[] = [];
    for (const grant of wanted) {
      if (grant.accountId !== undefined) {
        const info = await this.authClient.getAccountInfo(
          Number(grant.accountId),
        );
        if (!info) unknown.push(Number(grant.accountId));
      }
    }
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown accounts: ${unknown.join(", ")}`,
      );
    }

    const row = await this.upsert(prefix, input, account);
    return this.describe(row);
  }

  /** Longest-match rule with its grants, for rule inspection. */
  async describeMatch(key: string): Promise<AclView | null> {
    // A bare folder path must still surface its rule: the trailing-slash
    // form matches the folder rule, the bare form may only match an
    // ancestor — the longer prefix of the two is the rule in force.
    const candidates = await Promise.all([
      this.resolveAcl(key),
      this.resolveAcl(`${key}/`),
    ]);
    const acl = candidates
      .filter((row): row is FileAclEntity => row !== null)
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    return acl ? this.describe(acl) : null;
  }

  /** Remove grants issued to a deleted account (user.deleted from the bus). */
  async purgeAccount(accountId: number | string): Promise<void> {
    await this.grants.delete({ subject: grantSubject(accountId) });
  }

  /** Drop rules for a removed object and everything under it. */
  async removeTree(key: string): Promise<void> {
    const rows = await this.acls.find();
    const ids = rows
      .filter(
        (row) => row.prefix === key || row.prefix.startsWith(`${key}/`),
      )
      .map((row) => row.id);
    if (ids.length) {
      await this.acls.delete(ids);
    }
  }

  private async upsert(
    prefix: string,
    input: AclSetInput,
    account: AccountInfo,
  ): Promise<FileAclEntity> {
    let row = await this.acls.findOne({ where: { prefix } });
    if (!row) {
      row = await this.acls.save({
        prefix,
        visibility: input.visibility ?? "private",
        accountId: String(account.id),
      } as FileAclEntity);
    } else if (input.visibility && input.visibility !== row.visibility) {
      row.visibility = input.visibility;
      await this.acls.save(row);
    }
    if (input.grants) {
      await this.grants.delete({ aclId: row.id });
      const seen = new Set<string>();
      for (const grant of input.grants) {
        const subject =
          grant.accountId !== undefined
            ? grantSubject(grant.accountId)
            : roleSubject(grant.role as string);
        if (seen.has(subject)) continue;
        seen.add(subject);
        await this.grants.insert({
          aclId: row.id,
          subject,
          mode: grant.mode,
        });
      }
    }
    return row;
  }

  private async describe(row: FileAclEntity): Promise<AclView> {
    const grants = await this.grants.find({ where: { aclId: row.id } });
    return {
      path: row.prefix,
      pathType: row.prefix.endsWith("/") ? "folder" : "file",
      visibility: row.visibility,
      accountId: String(row.accountId),
      grants: grants.map((grant) => {
        const accountId = subjectAccountId(grant.subject);
        return accountId !== null
          ? { accountId, mode: grant.mode }
          : { role: grant.subject.slice(2), mode: grant.mode };
      }),
    };
  }

  /** write implies read; read requires read or write. */
  private async matchGrant(
    aclId: string,
    account?: AccountInfo | null,
    mode: AclGrantMode = "read",
  ): Promise<boolean> {
    if (!account) return false;
    const roles = rolesOf(account);
    const rows = await this.grants.find({ where: { aclId: String(aclId) } });
    return rows.some((grant) => {
      if (mode === "write" && grant.mode !== "write") return false;
      if (grant.subject.startsWith("u:")) {
        return account.id !== undefined && grant.subject === grantSubject(account.id);
      }
      if (grant.subject.startsWith("r:")) {
        return roles.includes(grant.subject.slice(2));
      }
      return false;
    });
  }
}
