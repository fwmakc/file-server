import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

const ENTITIES = [join(__dirname, '../**/*.entity{.ts,.js}')];
const MIGRATIONS = [join(__dirname, '../typeorm/migrations/*{.ts,.js}')];

export const getDbConfig = async (
  config: ConfigService,
): Promise<TypeOrmModuleOptions> => ({
  type: 'postgres',
  host: config.get<string>('DB_HOST'),
  database: config.get<string>('DB_NAME'),
  schema: config.get<string>('DB_SCHEMA'),
  username: config.get<string>('DB_USER'),
  password: config.get<string>('DB_PASSWORD'),
  port: config.get<number>('DB_PORT'),

  // Schema is owned by migrations only (src/typeorm/migrations) — pending
  // migrations are applied on every boot; never enable synchronize.
  migrationsRun: true,
  autoLoadEntities: true,
  logging: config.get<string>('DB_LOG') === 'true',

  entities: ENTITIES,
  migrations: MIGRATIONS,
  migrationsTableName: 'migrations_typeorm',
});
