import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Dedupe ledger for webhook deliveries. `eventId` comes from the
 * event-server envelope; the unique index turns a duplicate delivery
 * into a no-op. Rows are written in the same transaction as the ACL
 * mutation they gate, so a crash can neither lose nor double-apply it.
 *
 * Direct TypeORM decorators (not the toolkit column set): the key column
 * must be NOT NULL and the index explicitly named so the migration and
 * the entity agree byte-for-byte (same pattern as message-server).
 */
@Entity("webhook_processed_events")
@Index("idx_webhook_processed_events_event_id", ["eventId"], { unique: true })
export class ProcessedEventEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "event_id", type: "varchar" })
  eventId: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
