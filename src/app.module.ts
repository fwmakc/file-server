import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { PassportModule } from "@nestjs/passport";
import { FilesModule } from "@src/files/files.module";

@Module({
  imports: [
    ConfigModule.forRoot(),
    PassportModule,
    ServeStaticModule.forRoot({
      rootPath: process.env.UPLOADS_PATH || "./public/uploads",
      serveRoot: process.env.UPLOADS_URL || "/uploads",
    }),
    FilesModule,
  ],
})
export class AppModule {}
