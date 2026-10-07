import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { performance } from "node:perf_hooks";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Injectable } from "@nestjs/common";
import { AuthClientService } from "api-server-toolkit/auth-client";
import { AclService } from "./acl.service";
import { FileAclEntity, FileAclGrantEntity } from "./acl.entity";
import { AclModule } from "./acl.module";

const RULE_COUNT = 8000;
const PROBES = 200;

// Thresholds hold on CI runners with wide margin for the indexed candidate
// lookup (a handful of index seeks per call). The abandoned full-scan
// implementation pulled all RULE_COUNT rows on every call and lands far
// above them — this spec is the regression tripwire.
const MEAN_MS_LIMIT = 25;
const MAX_MS_LIMIT = 250;

@Injectable()
class PerfHarness {
  constructor(
    @InjectRepository(FileAclEntity)
    public readonly acls: Repository<FileAclEntity>,
    public readonly acl: AclService,
  ) {}
}

/**
 * resolveAcl is the hot path behind every download (isPublic) and every
 * write (canWrite/resolveWriteFolder). Seeds thousands of realistic rules
 * and asserts the candidate lookup stays flat — plus one correctness pass:
 * longest-prefix semantics must survive the optimization.
 */
describe("AclService resolution performance (db)", () => {
  let harness: PerfHarness;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT || 5432),
          username: process.env.DB_USER || "root",
          password: process.env.DB_PASSWORD || "",
          database: process.env.DB_NAME || "file_server_test",
          entities: [FileAclEntity, FileAclGrantEntity],
          synchronize: true,
          dropSchema: true,
        }),
        AclModule,
        TypeOrmModule.forFeature([FileAclEntity]),
      ],
      providers: [PerfHarness],
    })
      .overrideProvider(AuthClientService)
      .useValue({ getAccountInfo: async () => null })
      .compile();
    harness = moduleRef.get(PerfHarness);

    // Wide fan-out of folder rules across a three-level namespace plus
    // exact file rules — the shape a busy deployment grows into.
    const rows: Array<Partial<FileAclEntity>> = [];
    for (let i = 0; i < RULE_COUNT; i++) {
      rows.push({
        prefix: `t${i % 40}/tenant-${i}/folder-${i % 97}/`,
        visibility: "private",
        accountId: "42",
      });
      if (i % 5 === 0) {
        rows.push({
          prefix: `t${i % 40}/tenant-${i}/doc-${i}.pdf`,
          visibility: "private",
          accountId: "42",
        });
      }
    }
    await harness.acls.insert(rows);

    // Overlapping chain for the semantics check: file rule beats its
    // folder ancestors, longest folder beats the shorter one.
    await harness.acls.insert([
      { prefix: "deep/", visibility: "public", accountId: "1" },
      { prefix: "deep/a/", visibility: "private", accountId: "1" },
      { prefix: "deep/a/b/", visibility: "public", accountId: "1" },
      { prefix: "deep/a/b/c.txt", visibility: "private", accountId: "1" },
    ]);
  });

  it("longest-prefix semantics hold through the candidate lookup", async () => {
    const file = await harness.acl.resolveAcl("deep/a/b/c.txt");
    expect(file?.prefix).toBe("deep/a/b/c.txt");

    const folder = await harness.acl.resolveAcl("deep/a/b/other.png");
    expect(folder?.prefix).toBe("deep/a/b/");

    const shallow = await harness.acl.resolveAcl("deep/readme");
    expect(shallow?.prefix).toBe("deep/");

    expect(await harness.acl.resolveAcl("unrelated/ghost.bin")).toBeNull();
    expect(await harness.acl.isPublic("deep/a/b/other.png")).toBe(true);
    expect(await harness.acl.isPublic("deep/a/hidden.txt")).toBe(false);
  });

  it(`resolution stays flat under ${RULE_COUNT}+ rules (${PROBES} probes)`, async () => {
    const probeKeys: string[] = [];
    for (let i = 0; i < PROBES; i++) {
      // Half hit a rule (deep folder/file), half miss into empty space.
      probeKeys.push(
        i % 2 === 0
          ? `t${i % 40}/tenant-${i}/folder-${i % 97}/asset-${i}.png`
          : `t${i % 40}/tenant-${i}/empty-${i}/nothing.bin`,
      );
    }
    // Warm the driver cache so the numbers reflect steady state.
    await harness.acl.resolveAcl(probeKeys[0]);

    const samples: number[] = [];
    for (const key of probeKeys) {
      const start = performance.now();
      await harness.acl.resolveAcl(key);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const max = samples[samples.length - 1];
    // Metrics stay in the log for trend watching across releases.
    // eslint-disable-next-line no-console
    console.log(
      `[acl-perf] rules≈${RULE_COUNT} probes=${PROBES} mean=${mean.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`,
    );
    expect(mean).toBeLessThan(MEAN_MS_LIMIT);
    expect(max).toBeLessThan(MAX_MS_LIMIT);
  });
});
