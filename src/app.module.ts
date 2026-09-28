import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { ServeStaticModule } from "@nestjs/serve-static";
import { AuthModule } from "@src/auth/auth.module";
import { FilesModule } from "@src/files/files.module";
import { HealthModule } from "api-server-toolkit/health";
import { MetricsModule } from "api-server-toolkit/metrics";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ServeStaticModule.forRoot({
      rootPath: process.env.UPLOADS_PATH || "./public/uploads",
      serveRoot: process.env.UPLOADS_URL || "/uploads",
    }),
    FilesModule,
    HealthModule.forRoot("file-server"),
    MetricsModule.forRoot({ service: "file-server" }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
