import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthClientModule } from "api-server-toolkit/auth-client";
import { FileAclEntity, FileAclGrantEntity } from "./acl.entity";
import { AclService } from "./acl.service";
import { AclController } from "./acl.controller";

@Module({
  // Same forRoot() call as FilesModule's — Nest dedupes identical dynamic
  // modules, so this is the single shared AuthClientService instance.
  imports: [
    AuthClientModule.forRoot(),
    TypeOrmModule.forFeature([FileAclEntity, FileAclGrantEntity]),
  ],
  controllers: [AclController],
  providers: [AclService],
  exports: [AclService],
})
export class AclModule {}
