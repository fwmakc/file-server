import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * First schema for file-server: ACL rules (file ownership/sharing) and the
 * webhook dedupe ledger (user.deleted grant cleanup). Enum types are named
 * explicitly so the migration and `synchronize` (test DBs) agree.
 */
export class CreateFileAcl1794000000000 implements MigrationInterface {
    name = 'CreateFileAcl1794000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "file_acl_visibility" AS ENUM ('private', 'public')`);
        await queryRunner.query(`CREATE TYPE "file_acl_grant_mode" AS ENUM ('read', 'write')`);
        await queryRunner.query(`CREATE TABLE "file_acl" (
            "id" BIGSERIAL NOT NULL,
            "prefix" varchar(1024) NOT NULL,
            "visibility" "file_acl_visibility" NOT NULL DEFAULT 'private',
            "account_id" BIGINT NOT NULL,
            "created_at" timestamptz NOT NULL DEFAULT now(),
            "updated_at" timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT "PK_file_acl_id" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_file_acl_prefix" ON "file_acl" ("prefix")`);
        await queryRunner.query(`CREATE TABLE "file_acl_grants" (
            "id" BIGSERIAL NOT NULL,
            "acl_id" BIGINT NOT NULL,
            "subject" varchar NOT NULL,
            "mode" "file_acl_grant_mode" NOT NULL,
            "created_at" timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT "PK_file_acl_grants_id" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_file_acl_grants_subject" ON "file_acl_grants" ("acl_id", "subject")`);
        await queryRunner.query(`CREATE TABLE "webhook_processed_events" (
            "id" SERIAL NOT NULL,
            "event_id" varchar NOT NULL,
            "created_at" timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT "PK_webhook_processed_events_id" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_webhook_processed_events_event_id" ON "webhook_processed_events" ("event_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_webhook_processed_events_event_id"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "webhook_processed_events"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "uq_file_acl_grants_subject"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "file_acl_grants"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "uq_file_acl_prefix"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "file_acl"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "file_acl_grant_mode"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "file_acl_visibility"`);
    }
}
