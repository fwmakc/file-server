import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { AuthModule } from "@src/auth/auth.module";
import { FilesModule } from "@src/files/files.module";

@Module({
  imports: [
    ConfigModule.forRoot(),
    AuthModule,
    ServeStaticModule.forRoot({
      rootPath: process.env.UPLOADS_PATH || "./public/uploads",
      serveRoot: process.env.UPLOADS_URL || "/uploads",
    }),
    FilesModule,
  ],
})
export class AppModule {}
