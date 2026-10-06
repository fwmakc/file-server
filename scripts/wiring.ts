/**
 * Wiring check (Wave 6, stage 2): boots the REAL AppModule (full DI graph —
 * handler chain, storage driver binding, DataSource with boot migrations)
 * in local-storage mode and probes the critical subsystems: the file
 * pipeline end-to-end (multer-shaped file → allow-types → rename → save
 * handler → on-disk object), a storage round-trip, the traversal-
 * sanitization guarantee, and ACL edge enforcement (namespace stamping +
 * shared folder rules). Needs DB_* in the environment. Runs under ts-node —
 * the production module system.
 *
 * Usage: npm run test:wiring
 * Exit code 0 = all probes green.
 */
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const uploadsDir = mkdtempSync(join(tmpdir(), "file-wiring-"));
process.env.UPLOADS_PATH = uploadsDir;
process.env.UPLOADS_URL = "/uploads";
process.env.FILE_STORAGE = "local";
process.env.UPLOADS_ALLOW_TYPES = "text/plain,image/png,application/pdf";
process.env.INTERNAL_API_KEY = "wiring-internal-key";
// Boot applies migrations (DB_* from the environment) and the bus
// subscription is pointless in a probe process.
process.env.EVENT_SERVER_URL = "disabled";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("Wiring check — file-server real boot");

  const { AppModule } = await import("../src/app.module");
  const { NestFactory } = await import("@nestjs/core");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  console.log("  ✓ AppModule booted (handler chain + storage bound)");

  const { FilesService } = await import("../src/files/files.service");
  const filesService = app.get(FilesService);

  // ── Probe: full pipeline through FilesService.process (the controller path) ──
  console.log("probe: file pipeline");
  const multerFile = (name: string, mimetype: string, buffer: Buffer) =>
    ({
      originalname: name,
      mimetype,
      size: buffer.length,
      buffer,
      fieldname: "file",
      encoding: "7bit",
      stream: null,
      destination: "",
      filename: "",
      path: "",
    }) as any;

  const [stored] = (await filesService.process(
    [multerFile("probe.txt", "text/plain", Buffer.from("hello wiring"))],
    {} as any,
  )) as Array<{ url?: string; error?: string; originalname?: string }>;
  ok("process() returns an object URL", typeof stored?.url === "string" && stored.url.length > 0,
    JSON.stringify(stored)?.slice(0, 120));

  const storedKey = (stored?.url ?? "").split("/uploads/")[1] ?? "";
  const storedPath = join(uploadsDir, storedKey);
  ok("object landed inside UPLOADS_PATH", storedKey.length > 0 && existsSync(storedPath),
    storedPath);
  if (existsSync(storedPath)) {
    ok("stored bytes match the input", readFileSync(storedPath).toString() === "hello wiring");
  }

  // ── Probe: traversal-sanitization (Wave 6 fix) ──
  console.log("probe: traversal sanitization");
  const [traversal] = (await filesService.process(
    [multerFile("../../etc/evil.txt", "text/plain", Buffer.from("evil"))],
    {} as any,
  )) as Array<{ url?: string; error?: string }>;
  const traversalUrl = traversal?.url ?? "";
  ok("path traversal in originalname is neutralized",
    typeof traversal?.url === "string" && !traversalUrl.includes(".."),
    `url="${traversalUrl}" error="${traversal?.error}"`);

  // ── Probe: batch isolation (Wave 6 fix) — one bad file must not kill the batch ──
  console.log("probe: batch isolation");
  const batch = (await filesService.process(
    [
      multerFile("good.txt", "text/plain", Buffer.from("good")),
      multerFile("broken.png", "image/png", Buffer.from([0x00, 0x01, 0x02])),
    ],
    // resize forces sharp to actually decode the corrupted buffer — that is
    // the throw the batch-isolation try/catch exists for.
    { resize: { width: 16 } } as any,
  )) as Array<{ url?: string; error?: string; originalname?: string }>;
  ok("batch returns a status per file", batch.length === 2);
  ok("corrupted image gets a per-file error, not a thrown 500",
    !!batch[1]?.error && batch[1].originalname === "broken.png",
    JSON.stringify(batch[1])?.slice(0, 120));
  ok("the healthy neighbour still uploaded", !!batch[0]?.url,
    JSON.stringify(batch[0])?.slice(0, 120));

  // ── Probe: allow-types exact-token semantics (Wave 6 fix) ──
  console.log("probe: allow-types exact tokens");
  const [svg] = (await filesService.process(
    [multerFile("payload.svg", "image/svg+xml", Buffer.from("<svg xmlns='a'></svg>"))],
    {} as any,
  )) as Array<{ url?: string; error?: string }>;
  // image/svg+xml must NOT pass an allowlist of exact tokens (no svg/xml
  // token is configured above).
  ok("image/svg+xml rejected without a matching token",
    !svg?.url && !!svg?.error,
    JSON.stringify(svg)?.slice(0, 120));

  const [png] = (await filesService.process(
    [multerFile("tiny.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
    {} as any,
  )) as Array<{ url?: string; error?: string }>;
  ok("image/png accepted by exact-token allowlist", !!png?.url && !png?.error,
    JSON.stringify(png)?.slice(0, 120));

  // ── Probe: ACL edge enforcement (namespace stamping + shared folder) ──
  console.log("probe: acl");
  const { AclService } = await import("../src/files/acl/acl.service");
  const acl = app.get(AclService);
  const owner = { id: 4242, username: "wiring@example.com", roles: ["authenticated"] } as any;
  const ownFolder = await acl.resolveWriteFolder("", owner);
  ok("empty folder resolves to the account namespace", ownFolder === "4242", ownFolder);
  const view = await acl.setAcl(
    { path: "4242/shared", pathType: "folder", visibility: "public", grants: [{ role: "author", mode: "write" }] },
    owner,
  );
  ok("acl rule stored with its grant", view.visibility === "public" && view.grants.length === 1,
    JSON.stringify(view)?.slice(0, 120));
  ok("public prefix is anonymously readable", await acl.isPublic("4242/shared/pic.png"));
  const stranger = { id: 777, roles: ["authenticated"] } as any;
  const strangerWrite = await acl.canWrite("4242/private.bin", stranger);
  ok("stranger cannot write outside grants", !strangerWrite);
  const authorWrite = await acl
    .resolveWriteFolder("4242/shared", { id: 9, roles: ["author"] } as any)
    .then(() => true, () => false);
  ok("role grant opens the shared folder for writing", authorWrite);
  const ruleView = await acl.describeMatch("4242/shared");
  ok("rule resolution finds the longest match", ruleView?.path === "4242/shared/",
    JSON.stringify(ruleView)?.slice(0, 120));

  await app.close();
  rmSync(uploadsDir, { recursive: true, force: true });

  console.log(`\nWiring: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Wiring check crashed:", e);
  try { rmSync(uploadsDir, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
});
