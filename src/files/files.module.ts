import { Module } from "@nestjs/common";
import { AuthClientModule } from "api-server-toolkit/auth-client";
import { FilesController } from "@src/files/files.controller";
import { PresignController } from "@src/files/presign.controller";
import { StorageHealthController } from "@src/files/storage-health.controller";
import { FilesService } from "@src/files/files.service";
import { AclModule } from "./acl/acl.module";
import { StorageDownloadController } from "./storage/download.controller";
import { StorageModule } from "./storage/storage.module";
import { StorageBootCheck } from "./storage/storage.boot.check";

import { AllowTypesHandler } from "./handler/allow_types.handler";
import { DecodeHandler } from "./handler/decode.handler";
import { GetImageMetadataHandler } from "./handler/get_image_metadata.handler";
import { ImageConvertHandler } from "./handler/image_convert.handler";
import { ImageResizeHandler } from "./handler/image_resize.handler";
import { IsImageHandler } from "./handler/is_image.handler";
import { MaxSizeHandler } from "./handler/max_size.handler";
import { PdfGenerateHandler } from "./handler/pdf_generate.handler";
import { RenameHandler } from "./handler/rename.handler";
import { SaveHandler } from "./handler/save.handler";

@Module({
  // AuthClientModule: @Account() resolves the full account (roles, activation)
  // via auth internal info with an LRU cache — the same strategy the rest of
  // the fleet uses; file-server's own bare JwtStrategy is retired.
  imports: [AuthClientModule.forRoot(), StorageModule.register(), AclModule],
  // The download route is registered in BOTH storage modes: private-by-
  // default means serve-static can no longer bypass authorization.
  controllers: [
    FilesController,
    PresignController,
    StorageHealthController,
    StorageDownloadController,
  ],
  providers: [
    StorageBootCheck,
    FilesService,
    AllowTypesHandler,
    DecodeHandler,
    GetImageMetadataHandler,
    ImageConvertHandler,
    ImageResizeHandler,
    IsImageHandler,
    MaxSizeHandler,
    PdfGenerateHandler,
    RenameHandler,
    SaveHandler,
  ],
  exports: [FilesService, DecodeHandler],
})
export class FilesModule {}
