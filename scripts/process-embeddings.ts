import "dotenv/config";
import { processEmbeddingQueue } from "../src/lib/rag/worker";

function printHelp() {
  console.log(
    "Usage: npx tsx scripts/process-embeddings.ts [--tenant-id <uuid>] [--batch-size <number>] [--help]"
  );
}

function parseArgs(argv: string[]) {
  let tenantId: string | undefined;
  let batchSize = 50;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--tenant-id") {
      tenantId = argv[++i];
      if (!tenantId) throw new Error("Missing value for --tenant-id");
      continue;
    }
    if (arg === "--batch-size") {
      const raw = argv[++i];
      if (!raw) throw new Error("Missing value for --batch-size");
      batchSize = parseInt(raw, 10);
      if (isNaN(batchSize) || batchSize <= 0)
        throw new Error("--batch-size must be a positive integer");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { tenantId, batchSize };
}

async function main() {
  const { tenantId, batchSize } = parseArgs(process.argv.slice(2));

  console.log(
    `[embeddings] Processing started (tenant: ${tenantId ?? "all"}, batch: ${batchSize})`
  );

  const result = await processEmbeddingQueue(tenantId, {
    maxDocs: batchSize,
  });

  console.log(
    `[embeddings] Done: ${result.processed} processed, ${result.failed} failed`
  );

  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(
    `[embeddings] Failed: ${err instanceof Error ? err.message : "Unknown error"}`
  );
  process.exit(1);
});
