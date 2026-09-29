import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "path";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { ServeStaticModule } from "@nestjs/serve-static";
import { AuthModule } from "@src/auth/auth.module";
import { FilesModule } from "@src/files/files.module";
import { HealthModule } from "api-server-toolkit/health";
import { MetricsModule } from "api-server-toolkit/metrics";
import { isS3Storage } from "./files/storage/storage.module";

// В s3-режиме локальный диск пуст — отдачу делает StorageDownloadController
const serveStatic = isS3Storage()
  ? []
  : [
      ServeStaticModule.forRoot({
        // Абсолютный путь: с относительным res.sendFile падает на
        // отсутствующих файлах (500 вместо 404)
        rootPath: resolve(process.env.UPLOADS_PATH || "./public/uploads"),
        serveRoot: process.env.UPLOADS_URL || "/uploads",
      }),
    ];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ...serveStatic,
    FilesModule,
    HealthModule.forRoot("file-server"),
    MetricsModule.forRoot({ service: "file-server" }),
  ],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
