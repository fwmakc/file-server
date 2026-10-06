import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource, DataSourceOptions } from "typeorm";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { runMigrationsUnderLock } from "api-server-toolkit";
import { FilesModule } from "@src/files/files.module";
import { WebhooksModule } from "@src/webhooks/webhooks.module";
import { HealthModule } from "api-server-toolkit/health";
import { MetricsModule } from "api-server-toolkit/metrics";
import { AuditModule } from "api-server-toolkit";
import { getDbConfig } from "./config/db.config";

// Отдача файлов — только через StorageDownloadController (ACL-гвард на
// каждый запрос): анонимного статического пути больше нет ни в одном режиме.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDbConfig,
      async dataSourceFactory(option) {
        if (!option) throw new Error('Invalid options passed');
        // Serialize boot migrations across replicas (TypeORM has no
        // built-in migration locking); the helper consumes `migrationsRun`.
        const { migrationsRun, ...dsOption } = option;
        if (migrationsRun) {
          await runMigrationsUnderLock(dsOption as DataSourceOptions);
        }
        return new DataSource(dsOption as DataSourceOptions);
      },
    }),
    FilesModule,
    WebhooksModule,
    HealthModule.forRoot("file-server"),
    MetricsModule.forRoot({ service: "file-server" }),
    AuditModule.forRoot(),
  ],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
