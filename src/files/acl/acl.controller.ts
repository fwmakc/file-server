import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Account, Self } from "api-server-toolkit";
import { AccountInfo } from "api-server-toolkit/auth-client";
import { AclService } from "./acl.service";
import { SetAclDto } from "./acl.dto";

/**
 * Sharing rules are a user action on their own files (owner-only) or a
 * staff operation on any path. The same edge that serves bytes resolves
 * these rules — no other service participates in file authorization.
 */
@ApiExcludeController()
@Controller("files")
export class AclController {
  constructor(private readonly acl: AclService) {}

  @Account()
  @Post("acl")
  async setAcl(@Body() dto: SetAclDto, @Self() account: AccountInfo) {
    return await this.acl.setAcl(dto, account);
  }

  @Account()
  @Get("acl/*splat")
  async getAcl(
    // Express 5 (path-to-regexp v8) hands the wildcard over as a
    // parameter array — reassemble the segments (same as the download
    // controller).
    @Param("splat") path: string | string[],
    @Self() account: AccountInfo,
  ) {
    const key = Array.isArray(path) ? path.join("/") : path;
    const view = await this.acl.describeMatch(key);
    // Inspecting a rule requires read access to the path itself — checked
    // against the matched rule's own prefix, so a longer private rule is
    // not unmasked through its public ancestor.
    if (!view || !(await this.acl.canRead(view.path, account))) {
      throw new NotFoundException();
    }
    return view;
  }
}
