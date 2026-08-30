import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { testCases } from "../fixtures/testCases";

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/labelary_images",
);

/** Bounds overlay only; zpl_input/image_ref live in testCases.ts. */
interface FixtureMapping {
  test_cases: {
    id: string;
    expected_bounds: { x: number; y: number; width: number; height: number };
  }[];
}

async function fetchLabelaryImage(zpl: string): Promise<Buffer> {
  // Use 8dpmm (203 dpi) and 4x4 inches as standard canvas dimensions
  const url = "http://api.labelary.com/v1/printers/8dpmm/labels/4x4/0/";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "image/png",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: zpl,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Labelary API error: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  console.log("Ensuring fixtures directory exists...");
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // Read-only here: seeding a placeholder would look Labelary-measured, so
  // bounds come from tests/scripts/measure_bbox.ts alone. A case without a row
  // fails the id-symmetry test with "case without bounds".
  const mappingFile = path.join(FIXTURES_DIR, "fixtures.json");
  const existing: FixtureMapping = fs.existsSync(mappingFile)
    ? JSON.parse(fs.readFileSync(mappingFile, "utf8"))
    : { test_cases: [] };
  const measured = new Set(existing.test_cases.map((c) => c.id));
  const unmeasured = testCases.filter((c) => !measured.has(c.id)).map((c) => c.id);
  if (unmeasured.length > 0) {
    console.log(`⚠️  No bounds yet (run measure_bbox.ts): ${unmeasured.join(", ")}`);
  }

  // zpl.hash.json binds each PNG to the zpl_input it was rendered from; the
  // labelarySync guard turns red when they diverge.
  const hashFile = path.join(FIXTURES_DIR, "zpl.hash.json");
  const hashes: Record<string, string> = fs.existsSync(hashFile)
    ? JSON.parse(fs.readFileSync(hashFile, "utf8"))
    : {};

  console.log("Fetching images from Labelary API...");
  for (const tc of testCases) {
    const imagePath = path.join(FIXTURES_DIR, tc.image_ref);
    const sha = createHash("sha1").update(tc.zpl_input).digest("hex");

    // Skip only when the image exists AND still matches its source ZPL.
    if (fs.existsSync(imagePath) && hashes[tc.id] === sha) {
      console.log(`⏩ Skipping ${tc.id} - Image already exists.`);
      continue;
    }

    console.log(`Fetching ${tc.id}...`);
    try {
      const imageBuffer = await fetchLabelaryImage(tc.zpl_input);
      fs.writeFileSync(imagePath, imageBuffer);
      hashes[tc.id] = sha;
      // Written per fetch, not once at the end: an interrupted run would
      // otherwise leave fresh PNGs paired with stale hashes.
      fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2) + "\n", "utf8");
      console.log(`✅ Saved ${tc.image_ref}`);
    } catch (error) {
      console.error(`❌ Failed to fetch ${tc.id}:`, error);
    }

    // Rate limiting: Labelary allows ~5 requests per second.
    // A 500ms delay ensures we stay well within the safe limits.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Prune keys for deleted cases; fixtures.json has its own id-symmetry guard.
  const live = new Set(testCases.map((c) => c.id));
  const pruned = Object.fromEntries(
    Object.entries(hashes).filter(([id]) => live.has(id)),
  );
  fs.writeFileSync(hashFile, JSON.stringify(pruned, null, 2) + "\n", "utf8");
  console.log("🎉 All fixtures fetched successfully!");
}

main().catch(console.error);
